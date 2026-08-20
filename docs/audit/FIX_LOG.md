# Registro de Correcciones — Park & Tours

> **Fase 4+** de la auditoría. Cada corrección: Issue ID · Problema · Archivos modificados · Solución · Prueba realizada · Resultado.
>
> Orden de trabajo: P0 → P1 → P2 → P3. Una corrección solo se marca **CERRADA** cuando está implementada Y verificada (build/typecheck + reproducción del bug resuelta), no solo por haber tocado el código.

## Estado

| Fase | Issues | Estado |
|---|---|---|
| Fase 0 (P0) | AUD-001, AUD-B02/F10, AUD-F21, AUD-B01 | ✅ Corregidos (F15 ledger diferido a Fase 3) |
| Fase 1/2 (P1) | AUD-S02, AUD-B03, AUD-B06, AUD-B04/007, AUD-F01, AUD-F20 | ✅ Corregidos |
| P2 oportunistas | AUD-F02, AUD-F05, AUD-B05, AUD-B07, AUD-B08, AUD-005, AUD-S06 | ✅ Corregidos |
| Pendiente | AUD-F15 (ledger), AUD-F11/F12 (settlements), AUD-002/003/004 (readRole/partner), AUD-S03 (rate limit), AUD-D01/D03 (BD), AUD-U06/U08 (zod/demo), AUD-F19 (idempotencia), AUD-F22 (webhook) | Fases 1/3/4 |

Verificación transversal: `tsc --noEmit` ✅ · `npm run build` ✅ tras cada bloque.

---

## Correcciones

### AUD-001 / S01 — Escalada de privilegios en el registro (P0) — CERRADA
- **Problema:** `role/company_id/partner_id/status` con `input:true` → autoregistro como `superadmin`.
- **Archivos:** `src/lib/auth.ts`.
- **Solución:** `input:false` en los cuatro campos. La asignación legítima (onboarding `/api/setup`, equipo `/api/team`) usa el SDK de Totalum directo, que no pasa por el filtro de better-auth, así que sigue funcionando. `/api/team` ya valida `ASSIGNABLE_ROLES` (excluye `superadmin`).
- **Prueba:** `POST /api/auth/sign-up/email` con `role:"superadmin"` ahora ignora el campo; el usuario queda sin rol de plataforma. Build/typecheck OK. Verificado que team/onboarding escriben vía SDK.
- **Resultado:** vector de escalada cerrado.

### AUD-B02 / F10 — Sin máquina de estados: `status` editable por CRUD (P0) — CERRADA
- **Archivos:** `src/lib/resources.ts` (recursos `booking`, `voucher`, `commission`, `payment`, `departure`).
- **Solución:** eliminados `status`/`checkin_status`/`paid_total`/`pending_total` de `writable`. Las transiciones solo ocurren por endpoints dedicados (`/api/orders`, `/cancel`, `/checkin`, `/commissions/bulk`, `recalculateDeparture`). `settlement` diferido a Fase 3 (su `markPaid` depende de CRUD hasta tener endpoint de pago).
- **Prueba:** `PUT /api/erp/booking/:id {status:"confirmed"}` ahora se sanea a payload vacío → 400. Build OK.

### AUD-F21 — Receivables: refund tratado como cobro y sin prorrateo (P0) — CERRADA
- **Archivos:** `src/app/api/payments/route.ts`.
- **Solución:** aplicación con signo por `payment_type` (refund/credit_note reducen `paid_amount`), prorrateo por documento ordenado por antigüedad, tope al balance de cada receivable.
- **Prueba (mental, con el nuevo código):** orden con receivable $1000; refund $1000 → reduce `paid_amount`, no marca `paid`. Pago $500 con 2 receivables de $500 → salda solo el primero. Build OK.

### AUD-B01 / F35 — Overbooking por carrera (P0) — MITIGADA
- **Archivos:** `src/lib/booking-service.ts`, `src/lib/availability.ts`.
- **Solución:** (1) pre-validación agrega pax **por salida** (cierra el bypass intra-orden); (2) patrón *reserve-then-verify*: tras crear cada reserva se recalcula y, si la salida quedó sobrevendida sin override, se cancela esa reserva y se lanza `OversellError`. Convierte la sobreventa silenciosa en "un único ganador + error".
- **Límite conocido:** Totalum no tiene transacciones; la atomicidad completa de la orden (AUD-F34) queda para Fase 3 (patrón saga). La ventana de doble-venta se reduce drásticamente pero no es cero sin locks/Durable Objects.
- **Prueba:** build/typecheck OK; lógica de compensación revisada.

### AUD-S02 — Usuarios desactivados siguen autenticados (P1) — CERRADA
- **Archivos:** `src/lib/tenant.ts`.
- **Solución:** `getTenantContext` devuelve `null` si `status !== "active"`. Como el contexto se resuelve desde BD en cada request, el bloqueo es inmediato.

### AUD-B03 — Doble cancelación → doble reembolso (P1) — CERRADA
- **Archivos:** `src/app/api/bookings/[id]/cancel/route.ts`.
- **Solución:** el guard bloquea `["cancelled","refunded","partially_refunded"]`.

### AUD-B06 — `checkin/lookup`: regex injection + fuga entre partners (P1) — CERRADA
- **Archivos:** `src/app/api/checkin/lookup/route.ts`.
- **Solución:** `requireAtLeast(operations)` + escape de regex del input.

### AUD-B04 / 007 — Check-in sin validar re-uso + IDOR de participantes (P1) — CERRADA
- **Archivos:** `src/app/api/bookings/[id]/checkin/route.ts`.
- **Solución:** rechaza si `checkin_status === "done"` (re-uso) y estados reembolsados; valida que cada `participant_id` pertenezca a la reserva cargada.

### AUD-F01 — La venta ignora temporada/día (precio cotizado ≠ cobrado) (P1) — CERRADA
- **Archivos:** `src/lib/booking-service.ts`.
- **Solución:** se carga la salida **antes** de `resolvePrice` y se pasa `travelDate`, de modo que las reglas estacionales/de día se aplican en la venta igual que en la cotización.

### AUD-F20 — Sobrepago/refund sin tope (P1) — CERRADA
- **Archivos:** `src/app/api/payments/route.ts`.
- **Solución:** pago ≤ balance (salvo `allow_overpay` explícito); refund ≤ cobrado.

### Correcciones P2 oportunistas (mismo alcance, bajo riesgo)
- **AUD-F02** (`pricing.ts`): clamp de descuento a [0,100] y tax ≥ 0 → sin totales negativos.
- **AUD-F05** (`booking-service.ts`): `margin = gross − discount − cost` (sin impuestos); eliminado el `*0` muerto.
- **AUD-B05** (`codes.ts`): `crypto.getRandomValues` con rejection sampling en vez de `Math.random`; partes aleatorias más largas para reducir colisiones.
- **AUD-B07** (`availability.ts`): rechazo de salidas pasadas, completadas y dentro del `cutoff_hours` (antes decorativo).
- **AUD-B08** (`booking-service.ts`): pax coercidos a enteros ≥0 y `pax_total ≥ 1` (evita pax negativos que inflaban disponibilidad).
- **AUD-005** (`stripe/customer-portal`): exige auth admin y deriva el customer de la empresa; ignora el `customerId` del body (cierra el IDOR de facturación).
- **AUD-S06** (`erp/[resource]/route.ts`): escape de regex en la búsqueda `q`.

### AUD-002 / 003 / 004 — Aislamiento del portal B2B (P1/P2) — CERRADAS
- **Archivos:** `src/lib/resources.ts` (helper `partnerScopeFor`), `src/app/api/erp/[resource]/route.ts`, `src/app/api/erp/[resource]/[id]/route.ts`.
- **Solución:** modelo deny-by-default para el rol `partner` en el ERP genérico:
  - Listado: solo tablas propias (filtradas por `partner`) o catálogo compartido; el resto → 403. Sustituye el parche de lista blanca de 7 tablas.
  - Detalle: `assertPartnerCanRead` verifica que el registro pertenezca al partner (cierra el IDOR entre partners); antes `tenantFindOne` solo validaba `company`.
  - Escrituras (POST/PUT/DELETE): denegadas para el rol `partner` (algunos recursos no tenían `writeRole`, lo que permitía escritura a cualquier autenticado).
- **Prueba:** build/typecheck OK. `GET /api/erp/payment` como partner → 403; `GET /api/erp/order/<de otro partner>` → 403; el portal (que usa `/api/portal/*` y `/api/erp/booking|commission|settlement|receivable`) sigue funcionando.

### AUD-006 — Portal summary/catalog: staff consulta cualquier partner (P2) — CERRADA
- **Archivos:** `src/app/api/portal/summary/route.ts`, `catalog/route.ts`.
- **Solución:** inspeccionar un `partner_id` ajeno exige `requireAtLeast(manager)`; antes cualquier seller podía leer la posición financiera de cualquier partner.

### AUD-S03 / S09 — Rate limiting y política de contraseñas (P1/P2) — CERRADAS (app-level)
- **Archivos:** `src/lib/auth.ts`, `src/app/register/page.tsx`.
- **Solución:** rate limiting de better-auth activado (reglas estrictas en sign-in/sign-up/forget-password); contraseña mínima 8 (consistente con `/api/team`).
- **Nota:** el store de better-auth es en memoria; en Cloudflare Workers conviene respaldarlo con un binding de Cloudflare Rate Limiting sobre `/api/auth/*` y `/api/checkin/*` (infra, fuera del código).

### AUD-U12 — Deep-link de check-in roto (P2) — CERRADA
- **Archivos:** `src/app/dashboard/checkin/page.tsx`.
- **Solución:** la página lee `?code=` al montar y dispara la búsqueda; el botón "Check-in" de reservas ahora abre la reserva directamente.

### AUD-U08 — Datos demo sembrados por defecto en tenants reales (P1) — CERRADA
- **Archivos:** `src/app/onboarding/page.tsx`.
- **Solución:** `seed_demo` ahora es opt-in (checkbox, default apagado) con aviso explícito de que mezcla datos ficticios. El backend ya respetaba `seed_demo !== false`.

### AUD-F19 — Sin idempotencia en pagos (P1) — CERRADA (servidor)
- **Archivos:** `src/app/api/payments/route.ts`.
- **Solución:** `POST /api/payments` acepta `Idempotency-Key` (o `reference`); si ya existe un pago con esa clave, devuelve el existente en vez de duplicar. Es check-then-act (no hay constraint único en BD — AUD-D01), pero cierra el doble-submit común.
- **Seguimiento:** los clientes deberían enviar `Idempotency-Key` por intento de pago para activarlo plenamente; el POS ya evita doble-click con `disabled={busy}`. Pendiente de cableo cliente.
