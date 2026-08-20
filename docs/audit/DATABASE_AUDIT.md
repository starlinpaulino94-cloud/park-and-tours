# DATABASE_AUDIT.md — Park & Tours

> Fecha: 2026-08-20 · Método: lectura de las 16 migraciones (2 520 líneas) + conteo mecánico + análisis de patrones de consulta en `src/`.
> **No se pudo ejecutar `EXPLAIN` / `EXPLAIN ANALYZE`**: no hay base de datos accesible desde este entorno y Totalum no expone plan de consulta. Todo lo referente a rendimiento real está marcado **UNVERIFIED**.

## Situación: dos bases de datos, ninguna correcta

| | **Totalum (producción hoy)** | **Postgres/Supabase (migración)** |
|---|---|---|
| Fuente de verdad | ✅ Sí | ❌ No |
| Esquema versionado | ❌ **No existe** | ✅ 16 migraciones en Git |
| Transacciones | ❌ | ✅ |
| Locks de fila | ❌ | ✅ |
| Foreign keys | ❌ | ✅ 326 |
| UNIQUE | ❌ | ✅ 40 |
| CHECK | ❌ | ✅ 266 |
| Índices | ❌ no controlables | ✅ 159 |
| NOT NULL | ❌ | ✅ 556 |
| RLS | ❌ imposible | ❌ **definida pero no activada** |
| Backups verificables | ❌ opacos al equipo | ⚠️ disponibles, sin probar |

**La base de datos que está en producción no tiene esquema como código.** No hay ningún fichero en el repositorio que describa las tablas de Totalum: el esquema vive en la interfaz web del proveedor. `src/lib/types.ts` (583 líneas de interfaces TypeScript) es la única descripción, y **no es ejecutable ni verificable** — nada impide que el esquema real haya derivado. Esto invalida el requisito de la Fase 30 (*"toda modificación estructural debe tener migración reproducible"*): hoy es literalmente *"alguien cambió esa tabla a mano"*.

---

## P0

### DB-001 — RLS nunca activada en 77 de 82 tablas
Ver `SECURITY_AUDIT.md` `SEC-001`. Es simultáneamente el hallazgo de base de datos y de seguridad más grave, y **bloquea el cutover**.

```
Tablas creadas ............................ 83
Tablas con organization_id ................ 82
Invocaciones de app.enable_tenant_rls() ....  0
alter table … enable row level security ....  5
```

Tablas **sin RLS** (extracto): `booking`, `payment`, `customer`, `participant`, `commission`, `settlement`, `receivable`, `payable`, `ledger_entry`, `ledger_account`, `cash_session`, `cash_movement`, `invoice`, `expense`, `product_cost`, `price_rule`, `waiver`, `document`, `staff`, `audit_log`, y 57 más.

### DB-002 — Funciones `security definer` ejecutables por `anon`
Ver `SEC-002`.

---

## P1

### DB-003 — La RPC atómica de capacidad existe pero **nunca se llama**
- **Ficheros:** `src/lib/supabase/data-provider.ts:118-127` (define `spReserveCapacity`), `supabase/migrations/0008_capacity_txn.sql`
- **Evidencia:**
  ```
  $ grep -rn 'spReserveCapacity' src/ | grep -v 'data-provider.ts'
  (sin resultados)
  ```
- **Problema:** `reserve_departure_capacity` es la solución correcta al problema de sobreventa — hace `select … for update` y serializa a los llamantes concurrentes. `booking-service.ts` **no la usa nunca**: sigue llamando a `assertCapacity()` (que a su vez usa el SDK de Totalum directamente, ni siquiera pasa por `tenant.ts`). La migración 0008 se escribió, se documentó como "cierra AUD-B01" y quedó desconectada.
- **Impacto:** aunque se ejecute el cutover a Postgres **mañana**, la sobreventa seguiría exactamente igual de posible, porque el camino de código no cambia.
- **Solución:** cablear `booking-service.ts` a `spReserveCapacity` bajo el flag `isSupabase()`, y hacer que la reserva de cupo y la inserción del booking ocurran en la **misma transacción**.
- **Validación:** test de concurrencia con N clientes simultáneos sobre la última plaza → exactamente 1 éxito.

### DB-004 — Cascadas de borrado sobre datos financieros
- **Evidencia:** 39 `on delete cascade` frente a 287 `on delete restrict / set null`.
- **Problema:** la proporción general es sana (predomina `restrict`), pero hay que verificar que ninguna cascada alcance `payment`, `ledger_entry`, `commission`, `receivable` o `audit_log`. Un `delete` sobre `organizations` o `order` no debe poder borrar historia financiera.
- **Estado: UNVERIFIED** — requiere revisión tabla a tabla contra el grafo de FK, pendiente en el plan de remediación.
- **Solución:** ninguna tabla financiera ni de auditoría debe ser destino de `cascade`; usar borrado lógico (`deleted_at`) para entidades de negocio.

### DB-005 — Recálculo de ocupación con techo de 1 000 reservas
- **Fichero:** `src/lib/availability.ts:56-64`
- **Problema:** `recalculateDeparture` recupera las reservas activas con `_limit: 1000` y suma los `pax` en JavaScript. Una salida con más de 1 000 reservas activas (evento grande, parque con entrada diaria) **cuenta de menos en silencio** → `bookedPax` demasiado bajo → `availablePax` demasiado alto → **sobreventa masiva sin ningún error visible**.
- **Impacto de negocio:** el fallo aparece precisamente cuando el negocio funciona bien, y se manifiesta como clientes con voucher válido y sin plaza.
- **Solución:** agregar en base de datos (`select sum(pax_total) … group by status`), no en memoria. En Postgres es trivial; en Totalum requiere `_aggregate`.

### DB-006 — Consultas sin paginación por cursor
- **Evidencia:** límites fijos altos repartidos por el código — `_limit: 1000` ×17, `_limit: 500` ×9, `_limit: 300` ×7, `_limit: 5000` ×1. `/api/erp` acepta `?limit=` hasta **1 000** por petición.
- **Problema:** offset-pagination sobre colecciones que crecen sin límite (`booking`, `payment`, `audit_log`, `ledger_entry`). Con 100× datos, `offset=50000` degrada linealmente y los límites fijos empiezan a truncar resultados **sin avisar**.
- **Solución:** cursor por `(created_at, id)` en las colecciones grandes; que el truncamiento sea explícito (`hasMore`) en lugar de silencioso.

### DB-007 — N+1 en 20 ficheros
- **Evidencia:** 20 ficheros contienen `await` a la capa de datos dentro de un bucle `for`.
- **Casos peores:**
  - `booking-service.ts`: por cada ítem de la orden ejecuta ~8 operaciones secuenciales (departure, price, product, cost, uniqueCode ×2, booking, voucher, participantes, comisiones, recálculo). Una orden de 5 ítems ≈ **40–60 round-trips HTTP** contra Totalum.
  - `syncOrderTotals`: un `editRecordById` **por reserva**, en serie.
  - `settlements/generate` y `commissions/bulk`: iteran sobre conjuntos potencialmente grandes.
- **Impacto:** en un BaaS por HTTP, cada round-trip son decenas de milisegundos. Una venta puede tardar segundos y es susceptible al límite de CPU/subrequest de Cloudflare Workers.
- **Solución:** operaciones por lote (`insert … values` múltiples) y una transacción por venta en Postgres.

---

## P2

| ID | Hallazgo | Detalle |
|---|---|---|
| **DB-008** | Sin herramienta de migración | `supabase/migrations/*.sql` son ficheros sueltos aplicados a mano (`supabase/README.md`). No hay Supabase CLI ni tabla de versiones ni orden garantizado. CI no aplica migraciones. |
| **DB-009** | Sin rollback de migración | Ninguna migración tiene script `down`, ni la estrategia expand/contract está documentada para cambios con datos en vivo. |
| **DB-010** | Índices no justificados por evidencia | 159 índices creados a priori. Sin `EXPLAIN` ni patrones de consulta medidos, algunos serán inútiles (coste de escritura) y faltarán otros. **UNVERIFIED** hasta tener datos reales. |
| **DB-011** | Deriva potencial Totalum ↔ TypeScript | `src/lib/types.ts` no está verificado contra el esquema real de Totalum por ningún test. Un campo renombrado en el panel del proveedor rompe en tiempo de ejecución, no en compilación. |
| **DB-012** | Snapshots históricos: parcial | ✅ Bien: `booking.price_snapshot`, `commission.snapshot`, `exchange_rate` y `base_amount` guardados por fila. ⚠️ Falta: `product_cost` no se congela más allá de `cost_amount`; no hay snapshot de la política de cancelación aplicada ni del perfil fiscal en el momento de la venta. Si cambian, la historia se reinterpreta. |

---

## Integridad referencial

- **Postgres:** 326 FK, 266 CHECK, 40 UNIQUE, 556 NOT NULL. Es un esquema **bien modelado** — el trabajo de diseño es sólido.
- **Totalum (producción):** **ninguna** de esas garantías existe. La unicidad de códigos de documento se resuelve en aplicación (`src/lib/unique.ts`, `uniqueCode()`), que es check-then-act: bajo concurrencia puede generar duplicados.
- **Registros huérfanos:** no verificable sin acceso a la base. La saga de `booking-service` y `reconcileStaleDrafts` existen precisamente para limitarlos, pero la barredora **no se ejecuta automáticamente** (`BIZ-002`).

## Transacciones

| Operación compuesta | Pasos | Atomicidad hoy |
|---|---|---|
| Crear orden | order → booking → participantes → voucher → pickup → comisiones → recálculo → receivable → promoción | ❌ Saga con compensación manual |
| Registrar pago | payment → cash_movement → recalc caja → sync orden → sync reservas → receivables → asiento | ❌ Secuencial, sin compensación |
| Liquidar partner | settlement → comisiones → payable → asiento | ⚠️ Con re-lectura ("atómico" según PR #1, sigue sin ser transacción) |
| Check-in | booking → participantes → voucher | ❌ |

En Postgres, **todas** deben ser una transacción. Es el argumento central de la Opción A.

## Backups y recuperación

| Pregunta | Respuesta |
|---|---|
| ¿Frecuencia de backup? | **Desconocida** — la gestiona Totalum, no está documentada ni es verificable por el equipo |
| ¿Retención? | Desconocida |
| ¿Proceso de restore? | **No documentado** |
| ¿Restore probado alguna vez? | **No** |
| RPO objetivo | **No definido** |
| RTO objetivo | **No definido** |

> **Un backup que nunca se ha restaurado no es un backup.** Hoy la respuesta a *"¿qué pasa si mañana desaparece la base de datos?"* es: **no lo sabemos**. Éste es, junto con `DB-001`, el motivo por el que el gate C no puede pasar.
