# BUSINESS_LOGIC_AUDIT.md — Park & Tours

> Auditoría de corrección de la lógica de negocio, concurrencia, idempotencia y fiabilidad.
> Fecha: 2026-08-20 · Método: lectura de los motores canónicos y de las 48 rutas + ejecución de la suite (63 tests ✅).

## Veredicto

La lógica de dominio de este proyecto es **inusualmente buena para código generado por IA**: existe un write-path único para ventas, los precios y comisiones se resuelven en motores canónicos con snapshots inmutables, el tipo de cambio se resuelve en servidor y las correcciones de PR #1 se sostienen bajo re-lectura.

Los problemas que quedan **no son bugs de cálculo**: son **garantías estructurales que el motor de datos no puede dar** — atomicidad, unicidad y ejecución diferida. Se han mitigado en aplicación tan lejos como es posible, y las mitigaciones han llegado a su techo.

| Severidad | Nº |
|---|---:|
| P0 | 0 |
| P1 | 5 |
| P2 | 4 |

---

## P1

### BIZ-001 — Carrera de cupo: mitigada, no resuelta, y con auto-cancelación mutua
- **Ficheros:** `src/lib/availability.ts:113-155`, `src/lib/booking-service.ts:246-262`
- **Flujo actual:** `assertCapacity` (leer → comprobar) → escribir booking → `recalculateDeparture` → si hay sobreventa, cancelar **este** booking.
- **Defecto 1 (sobreventa residual):** entre la lectura y la escritura no hay lock. Con lecturas obsoletas dos ventas pueden pasar ambas.
- **Defecto 2 (nuevo, no documentado en PR #1) — auto-cancelación mutua:** si A y B escriben sus bookings y **ambos** recalculan después, ambos observan el estado sobrevendido y **ambos se cancelan**. Resultado:
  ```
  Capacidad = 1 · A pide 1 · B pide 1
  Esperado:  A = éxito, B = "agotado"
  Posible:   A = error, B = error, plaza = SIN VENDER
  ```
  El sistema se degrada del lado seguro (nunca `stock = -1`), pero **rechaza ventas legítimas y pierde ingresos** justo cuando hay demanda.
- **Causa raíz:** compensación simétrica sin desempate. No hay forma de resolverlo correctamente sin un lock o una constraint.
- **Solución:** `reserve_departure_capacity` (ya escrita, `DB-003`) invocada dentro de la misma transacción que la inserción del booking. Alternativa complementaria: constraint de exclusión o `check (booked_pax + pending_pax <= capacity)` que haga imposible el estado inválido.
- **Validación:** test de concurrencia (10 y 100 clientes) sobre la última plaza → exactamente 1 éxito y N−1 rechazos limpios, cero auto-cancelaciones.
- **Tests actuales: ninguno.** `availability.ts` y `booking-service.ts` no tienen cobertura.

### BIZ-002 — La barredora de la saga no se ejecuta nunca
- **Ficheros:** `src/lib/booking-service.ts:396-420` (`reconcileStaleDrafts`), `src/app/api/maintenance/reconcile-drafts/route.ts`, `wrangler.jsonc`
- **Problema:** la saga de creación de orden depende de un barrido periódico para limpiar órdenes `draft` huérfanas dejadas por un **crash duro** (no excepción — ésas sí se compensan en el `catch`). El código lo dice explícitamente: *"Meant to be run periodically (cron) or on demand by an admin."*
  **`wrangler.jsonc` no tiene `triggers`. No hay cron. No hay scheduler. En ninguna parte del repositorio.**
- **Impacto:** tras un crash del worker a mitad de venta, la orden queda `draft` con reservas vivas que **retienen plazas** y cuentan como ventas en los KPIs, **indefinidamente**, hasta que un admin recuerde pulsar un botón que probablemente no sabe que existe.
- **Solución (inmediata, barata):** añadir `triggers.crons` en `wrangler.jsonc` + un handler `scheduled`, o un GitHub Action programado que llame al endpoint. La lógica ya está escrita y probada — sólo falta ejecutarla.
- **Nota:** la barredora es además **por tenant** (`reconcileStaleDrafts(companyId)`), así que el cron debe iterar tenants.

### BIZ-003 — El asiento contable es "best-effort": los libros pueden no cuadrar en silencio
- **Ficheros:** `src/app/api/payments/route.ts:198-207`, `src/lib/ledger-events.ts`
- **Problema:** `postPayment` está envuelto de forma que *"un fallo de contabilidad nunca bloquea el pago"*. Es una decisión razonable para disponibilidad, pero **no hay cola de reintento ni reconciliación**: si el asiento falla, el pago existe y el asiento no, para siempre, y sólo queda una línea en `console.error`.
- **Impacto:** el balance de comprobación (`/api/ledger/trial-balance`) deja de reflejar la caja real y **nadie se entera** hasta un cierre contable.
- **Solución:** cola de reintento (outbox) + un chequeo de reconciliación que compare la suma de `payment` con la de `ledger_entry` por periodo y alerte ante divergencia. Cuando exista transacción, el asiento va **dentro** de la misma transacción del pago.

### BIZ-004 — Idempotencia de pagos sin constraint: el doble clic real sigue abierto
- **Fichero:** `src/app/api/payments/route.ts:44-58` (el propio comentario lo admite)
- **Problema:** ante `Idempotency-Key` se consulta si existe un pago con esa `reference` y, si no, se crea. **Check-then-act sin unicidad en base de datos.** Dos peticiones concurrentes con la misma clave (doble clic, reintento de red, dos pestañas) pueden **ambas** ver "no existe" y **ambas** crear el pago.
- **Impacto:** doble cobro al cliente, doble movimiento de caja, doble asiento, receivable liquidada dos veces.
- **Solución:** índice único `(organization_id, reference)` en Postgres y capturar la violación como "ya procesado". Es una línea de SQL — y es **imposible en Totalum**.
- **Mismo patrón, mismo defecto:** `uniqueCode()` (`src/lib/unique.ts`) para números de orden/reserva/voucher, y `alreadyProcessed()` del webhook de Stripe.

### BIZ-005 — Sin timeouts en ninguna llamada externa
- **Evidencia:** `grep 'AbortSignal|AbortController|signal:' src/` → **0 resultados**.
- **Problema:** cada operación del ERP hace entre 1 y 60 llamadas HTTP a Totalum sin timeout. Si el proveedor se degrada (no cae: se ralentiza), las peticiones se acumulan hasta agotar el límite de CPU del Worker y **toda la aplicación deja de responder**, no sólo la función afectada.
- **Ausentes también:** reintentos con backoff donde son seguros (`GET`), circuit breaker sobre el SPOF (Totalum), y degradación controlada.
- **Solución:** `AbortSignal.timeout()` en el cliente de Totalum/Supabase, reintento sólo en lecturas idempotentes, circuit breaker sobre Totalum, y mensaje de degradación en UI.

---

## P2

| ID | Hallazgo | Fichero | Detalle |
|---|---|---|---|
| **BIZ-006** | Deriva de redondeo al prorratear pagos | `booking-service.ts:syncOrderTotals` | `bookingPaid = round2(paid * share)` por reserva. La suma de los prorrateos redondeados no siempre iguala `paid` (céntimo perdido/sobrante). En un orden con muchas líneas se acumula. Asignar el residuo a la última línea. |
| **BIZ-007** | `syncOrderTotals` sin control de concurrencia | `booking-service.ts` | Dos pagos simultáneos sobre la misma orden leen la misma lista de pagos y ambos escriben totales calculados de una foto obsoleta → último escritor gana, saldo incorrecto. Necesita lock de fila o recálculo atómico. |
| **BIZ-008** | Comisiones generadas antes de confirmar el ítem | `booking-service.ts` | Las comisiones se crean **antes** del chequeo de sobreventa del ítem. Si el booking se auto-cancela, la compensación las anula — pero sólo hasta 50 (`_limit: 50`). Una orden grande podría dejar comisiones huérfanas. |
| **BIZ-009** | Límites de compensación fijos | `booking-service.ts:compensateOrder` | `_limit: 50` para vouchers y comisiones, `_limit: 20` para receivables. Una orden mayor deja residuos sin anular tras un fallo. |

---

## Idempotencia — estado por operación

| Operación | Repetible por accidente | Protección | Suficiente |
|---|---|---|---|
| Pago / reembolso | Doble clic, reintento | `Idempotency-Key` → `reference` | ⚠️ Sin constraint (`BIZ-004`) |
| Webhook Stripe | Reintentos de Stripe | Tabla `stripe_event` | ⚠️ Check-then-act, falla abierto |
| Crear orden | Doble submit | ❌ **Ninguna** | ❌ Dos órdenes idénticas |
| Liquidación | Doble ejecución | Re-lectura + estado | ✅ |
| Check-in | Doble escaneo | Comprobación de estado | ✅ |
| Asiento contable | Reintento | `alreadyPosted(source, ref)` | ⚠️ Check-then-act |
| Seed demo | Doble clic | `tenantCount(product) > 0` | ✅ |
| Onboarding | Doble submit | `company_id` existente | ✅ |

**Hueco más visible:** `POST /api/orders` no acepta clave de idempotencia. Es la operación más cara y la más expuesta al doble clic.

---

## Datos inesperados — cobertura de validación

| Entrada | Tratamiento | Veredicto |
|---|---|---|
| `null` / `undefined` / `""` | `sanitizePayload` → `null` | ✅ |
| Números negativos | Rechazados salvo allowlist `ALLOW_NEGATIVE` | ✅ |
| No enteros donde procede | `INTEGER_FIELDS` | ✅ |
| Porcentajes > 100 | Rechazados | ✅ |
| Pax ≤ 0 o fraccionario | `toCount()` + `paxTotal < 1` → 400 | ✅ |
| Importe ≤ 0 en pago | Rechazado | ✅ |
| Fechas inválidas | `new Date()` → `NaN` → `null` | ⚠️ **Se silencia**: una fecha inválida se guarda como `null` sin avisar |
| Fechas pasadas / futuras extremas | Cutoff evaluado en `assertCapacity` | ⚠️ Parcial |
| Enum inválido | ❌ **No se valida** — `sanitizePayload` no comprueba enums | ⚠️ |
| Cadenas muy largas | ❌ Sin límite de longitud en aplicación | ⚠️ CHECK existe sólo en Postgres |
| JSON malformado | `readJson` → `{}` | ⚠️ Se silencia; debería ser 400 |
| Unicode / HTML / SQL-like | Escapado en regex; React escapa por defecto | ✅ |
| Fichero inesperado | Tamaño y MIME **declarado por el cliente** | ⚠️ (`SEC-015`) |
| Número muy grande | ❌ Sin cota superior salvo porcentajes | ⚠️ |

**Patrón sistémico:** la validación es una **allowlist con coerción**, no un **esquema**. `zod` está instalado y se usa en formularios de frontend, pero **ninguna ruta API valida su cuerpo con un esquema zod**. Entradas inválidas se convierten en `null` en lugar de rechazarse — un fallo silencioso, no una frontera.

**Las tres capas de validación:**
```
Cliente (UX)      ✅ react-hook-form + zod
Servidor (seguridad) ⚠️ allowlist + coerción, sin esquema
Base de datos     ❌ Totalum: nada · Postgres: 266 CHECK sin usar
```

---

## Comprensibilidad (Fase 4)

**Flujo crítico: venta.** ¿Puede seguirlo un desarrollador que no lo escribió?

```
POST /api/orders
  ↓ requireTenant() + requireAtLeast("seller")
  ↓ createOrderWithBookings()                    ← punto de entrada único, bien
      ↓ agregación de pax por salida             ← AUD-B01
      ↓ assertCapacity() por salida              ← guardia
      ↓ crea order status="draft"                ← inicio de saga
      ↓ por ítem: departure → resolvePrice → resolveCost →
        booking → participantes → voucher → pickup → comisiones →
        recalculateDeparture → posible auto-cancelación
      ↓ receivable B2B
      ↓ promociona a "pending_payment"            ← commit de la saga
      ↓ catch → compensateOrder()
```

**Veredicto: SÍ, es seguible** — con una salvedad importante. El código está bien comentado, cada corrección lleva su identificador (`AUD-F34`, `AUD-B01`) y el flujo es lineal. Pero **entenderlo exige leer los informes de auditoría previos**: los comentarios explican el *porqué* en términos de bugs históricos, no del dominio. Un desarrollador nuevo entiende *qué* hace el código, no *qué garantías da*.

**"Si algo se rompe, ¿sabemos dónde mirar?"** → **NO.** El código es legible, pero en producción no hay Sentry, ni logs estructurados, ni trazas, ni `request_id`. La respuesta hoy es *"buscar en los logs de Cloudflare por texto"*. Ver `SEC-009` y `PRODUCTION_READINESS.md` gate I.

## Las 10 preguntas, aplicadas a los módulos críticos

| Pregunta | Venta | Pago | Comisión | Cupo |
|---|:--:|:--:|:--:|:--:|
| 1. ¿Dato inesperado? | ✅ | ✅ | ✅ | ✅ |
| 2. ¿Compromete seguridad? | ✅ No | ✅ No | ✅ No | ⚠️ `SEC-002` |
| 3. ¿Otro dev lo entiende? | ✅ | ✅ | ✅ | ⚠️ |
| 4. ¿Dos usuarios a la vez? | ❌ `BIZ-001` | ❌ `BIZ-007` | ✅ | ❌ `BIZ-001` |
| 5. ¿Dependencia externa cae? | ❌ `BIZ-005` | ❌ `BIZ-005` | ❌ | ❌ |
| 6. ¿Se ejecuta dos veces? | ❌ Sin clave | ⚠️ `BIZ-004` | ✅ | n/a |
| 7. ¿100× datos? | ⚠️ N+1 | ⚠️ | ⚠️ | ❌ `DB-005` |
| 8. ¿Cómo sabemos que falló? | ❌ | ❌ | ❌ | ❌ |
| 9. ¿Cómo recuperamos? | ⚠️ Saga sin cron | ❌ | ❌ | ⚠️ |
| 10. ¿Hay tests? | ❌ | ❌ | ✅ 10 | ❌ |

**Lectura:** las filas 4, 5, 8 y 9 son casi enteramente rojas. Éste es el perfil característico de software que **funciona con un usuario y falla con carga real**: la corrección funcional está resuelta, la corrección operacional no se ha abordado.
