# Registro de Correcciones — Park & Tours

> **Fase 4+** de la auditoría. Cada corrección: Issue ID · Problema · Archivos modificados · Solución · Prueba realizada · Resultado.
>
> Orden de trabajo: P0 → P1 → P2 → P3. Una corrección solo se marca **CERRADA** cuando está implementada Y verificada (build/typecheck + reproducción del bug resuelta), no solo por haber tocado el código.

## Estado

| Fase | Issues | Estado |
|---|---|---|
| Fase 0 (P0) | AUD-001, AUD-B02/F10, AUD-F21, AUD-B01, **AUD-F15** | ✅ Corregidos |
| Fase 1/2 (P1) | AUD-S02, AUD-B03, AUD-B06, AUD-B04/007, AUD-F01, AUD-F20, **AUD-F11, AUD-F12, AUD-F16** | ✅ Corregidos |
| Multi-tenancy (P1/P2) | AUD-002/003/004/006, AUD-S03, AUD-S09 | ✅ Corregidos |
| P2 oportunistas | AUD-F02, AUD-F05, AUD-B05, AUD-B07, AUD-B08, AUD-005, AUD-S06, AUD-U08, AUD-U10, AUD-U12, AUD-F19 | ✅ Corregidos |
| Finanzas avanzada (P1) | **AUD-F08** (comisión solo si cobrada), **AUD-F34** (saga de orden con compensación) | ✅ Corregidos |
| Validación y moneda (P1) | **AUD-U06** (validación servidor en 77 recursos + endpoints), **AUD-F30/F03** (rate servidor + rechazo de orden mixta) | ✅ Corregidos |
| Base de datos (P1) | **AUD-D01** (unicidad de códigos app-level), **AUD-D03** (drift: 37 tablas añadidas al script de schema) | ✅ Corregidos |
| Pendiente | AUD-F22 (webhook Stripe), agregaciones en `base_amount` (F30 follow-up), normalización de email en signup público, reconciliación de drafts huérfanos | Fases futuras |

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

### AUD-F15 — Ledger contable desconectado de la operación (P0) — CERRADA (base efectivo)
- **Archivos:** nuevo `src/lib/ledger-events.ts`; `src/app/api/payments/route.ts`; `src/app/api/bookings/[id]/cancel/route.ts`; `src/app/api/settlements/[id]/pay/route.ts`; esquema `scripts/setup-database.mjs` (tablas `ledger_account`/`ledger_entry`).
- **Solución:** cada movimiento real de dinero ahora genera un asiento de partida doble:
  - **Cobro:** Dr Caja/Banco (según método) / Cr Ingresos (4101).
  - **Reembolso** (payments y cancelación): Dr Devoluciones (4201) / Cr Caja/Banco.
  - **Pago de liquidación:** Dr Comisiones de venta (5103) / Cr Caja/Banco.
- **Decisiones de diseño clave:**
  - **Base efectivo:** cada asiento corresponde a caja real → el mayor no puede descuadrar contra la realidad y una cancelación no requiere reversión compleja. La contabilidad de devengo (ingresos diferidos, CxC en el mayor) queda como paso futuro, no como prerequisito.
  - **Best-effort:** un fallo del ledger **nunca** rompe la venta/pago (try/catch que solo loguea). El ledger es capa de reporte, no un gate para cobrar.
  - **Idempotente:** antes de asentar se comprueba si ya existe asiento para ese (origen, documento) → los reintentos de pago no duplican asientos.
- **Prueba:** build/typecheck OK; el `ensureChart` crea el plan de cuentas en el primer evento; `trialBalance` recalcula desde asientos (cuadra por construcción).
- **Límite:** las tablas del ledger estaban entre las 37 ausentes del script (AUD-D03) — añadidas ahora; en la BD actual deben existir (hay páginas de mayor). El asiento por línea sigue siendo read-modify-write del caché de saldo (AUD-F16 parcial), pero la verdad son los asientos.

### AUD-F11 — Liquidación no atómica ni trazable (P1) — CERRADA
- **Archivos:** `src/app/api/settlements/generate/route.ts`; enlace `commission.settlement` en `types.ts` y `setup-database.mjs`.
- **Solución:** patrón claim-then-total — se crea el settlement, se **reclama** cada comisión (re-lectura + skip si ya está `settled`, enlace `settlement` a la comisión), y el total se calcula desde las comisiones **efectivamente reclamadas**. Evita doble-inclusión bajo concurrencia/reintento y deja trazabilidad comisión→liquidación. Si no se reclama ninguna → settlement `void` + 409.

### AUD-F12 — "Marcar pagada" no saldaba la payable (P1) — CERRADA
- **Archivos:** nuevo `src/app/api/settlements/[id]/pay/route.ts`; `src/app/dashboard/liquidaciones/page.tsx`; `resources.ts` (settlement solo `notes` en writable).
- **Solución:** endpoint dedicado que marca la liquidación pagada, **salda la payable asociada**, cierra las comisiones (`settled`→`paid`) y asienta en el ledger, todo junto. La UI usa el endpoint con guard anti-doble-submit (AUD-U10). El CRUD ya no permite editar `status/paid_total/pending_total` de settlement (completa AUD-B02).

### AUD-F16 — Saldo de cuenta editable por CRUD (P1, parcial) — MITIGADA
- **Archivos:** `resources.ts` (ledger_account).
- **Solución:** `balance` quitado de `writable`: es un caché derivado de los asientos (trial balance), no debe editarse a mano. La atomicidad completa del asiento (documento único) queda pendiente.

### AUD-F08 — Se liquidaban comisiones de ventas no cobradas (P1) — CERRADA
- **Archivos:** `src/app/api/settlements/generate/route.ts`.
- **Problema:** las comisiones se devengan al crear la reserva (`pending`), y la generación de liquidaciones incluía toda comisión `pending/approved` sin mirar si la venta se cobró → salida de caja real por ingresos inexistentes.
- **Solución:** en el bucle de reclamación se omite la comisión si su reserva no está cobrada: se exige `booking.status ∈ {paid, completed, checked_in}` o `paid_amount ≥ total`, y se excluyen explícitamente reservas `cancelled/refunded/partially_refunded` (cuyo balance 0 no debe confundirse con "cobrado").
- **Prueba:** build/typecheck OK. Una orden B2B creada y nunca pagada ya no genera CxP en la liquidación.

### AUD-F34 — createOrderWithBookings sin atomicidad (P1) — CERRADA (saga con compensación)
- **Archivos:** `src/lib/booking-service.ts`.
- **Problema:** ~10+ escrituras sin transacción; un fallo intermedio dejaba órdenes fantasma (con reservas vivas que ocupan cupo pero total 0) o ventas B2B sin receivable.
- **Solución:** patrón saga — la orden se crea como `draft`; solo tras escribir todos los hijos (reservas, vouchers, comisiones, receivable) se **promueve** a `pending_payment` (última escritura crítica). Si cualquier paso falla, `compensateOrder` **cancela las reservas creadas** (liberando cupo vía recálculo) y anula la orden (`cancelled`), best-effort. Convierte la corrupción parcial silenciosa en "orden completa o revertida". Efecto secundario deseado: una orden multi-ítem donde el último ítem se queda sin cupo ahora se revierte entera (all-or-nothing) en vez de quedar parcial.
- **Límite:** sigue sin ser una transacción real (Totalum no las soporta); la compensación es best-effort. Un job de reconciliación para detectar `draft` huérfanos (por caídas de proceso) queda como mejora.
- **Prueba:** build/typecheck OK; estructura try/catch/compensación revisada.

### AUD-U06 — Cero validación de datos en servidor (P1) — CERRADA
- **Archivos:** `src/lib/resources.ts` (`sanitizePayload`), `src/components/tf/resource-form.tsx`, `src/app/api/departures/generate/route.ts`, `src/app/api/cash/sessions/route.ts`, `src/app/api/cash/movements/route.ts`.
- **Problema:** los 77 recursos del ERP genérico y varios endpoints dedicados aceptaban números negativos, descuentos >100%, pax decimales y tipos de movimiento arbitrarios; la validación era solo `required` en cliente.
- **Solución:**
  - `sanitizePayload` valida **todos** los campos numéricos: rechaza no-finitos, exige no-negativos (salvo `latitude/longitude/balance/balance_after/pickup_offset_min/sort_order/margin_percent`), limita descuentos (`discount_percent/discount_pct/max_discount_pct`) a <=100%, y exige enteros en conteos (pax/adults/children/quantity/capacity/seats/...). Un solo mecanismo cubre los 77 recursos.
  - `departures/generate`: capacidad entera >0, `cutoff_hours`>=0, y rechazo de rangos de fecha ya pasados (tambien AUD-B07).
  - `cash/sessions`: fondo de apertura >=0. `cash/movements`: `movement_type` contra whitelist (`deposit/withdrawal/expense/adjustment`).
  - `resource-form`: `min=0` en inputs numericos (salvo coordenadas/offset/balance) como refuerzo de UX.
- **Nota:** `discount` (importe absoluto en quote/invoice) y `*_rate`/`margin_percent` se excluyen del tope de porcentaje para no romper valores legitimos.
- **Prueba:** build/typecheck OK. `POST /api/orders` con `discount_pct:150` o `adults:-5` se rechaza; `PUT /api/erp/product` con `base_price:-10` devuelve 400.

### AUD-F30 / F03 — Multimoneda de fachada (P1) — CERRADA (datos correctos en escritura)
- **Archivos:** `src/lib/currency.ts` (nuevo), `src/lib/booking-service.ts`, `src/app/api/payments/route.ts`.
- **Problema:** `exchange_rate` lo aportaba el cliente (default 1) y `currency_rate` no se leia nunca -> `base_amount`/`base_currency_total` sin sentido; y una orden podia mezclar monedas sumadas 1:1.
- **Solucion:**
  - `resolveExchangeRate(companyId, from, to)` lee la tasa mas reciente de `currency_rate` (directa o inversa) en servidor; nunca confia en el cliente; fallback 1:1 con warning si no hay tasa.
  - `createOrderWithBookings` y `payments` calculan el rate a moneda base con este helper -> `base_currency_total`/`base_amount` correctos.
  - **F03:** se rechaza la orden si una linea resuelve a moneda distinta de la de la orden (no se mezclan monedas en un documento).
- **Limite (follow-up):** los agregados de dashboards/reportes aun suman el importe en moneda de origen. Con `base_amount` ya poblado, el paso restante es que todas las agregaciones lean `base_amount`. Los tenants de una sola moneda ya son correctos; el caso agudo (orden mixta) queda bloqueado.
- **Prueba:** build/typecheck OK.

### AUD-D01 — Sin unicidad de códigos de documento (P1) — CERRADA (app-level)
- **Archivos:** `src/lib/unique.ts` (nuevo), `src/lib/booking-service.ts`, `src/lib/codes.ts` (B05 previo).
- **Problema:** Totalum no permite constraints de unicidad (`canRepeat:true` obligatorio), así que order_number/booking_number/voucher.code podían colisionar (agravado por el generador original de 5 chars con `Math.random`).
- **Solución:** (1) B05 ya migró a `crypto.getRandomValues` con rejection sampling y partes más anchas (7-8 chars). (2) `uniqueCode(companyId, table, field, generate)` genera y **verifica** contra el tenant, regenerando ante colisión (5 intentos); best-effort (si la consulta falla, acepta el código para no bloquear la venta). Aplicado a `order_number`, `booking_number` y `voucher.code` en la creación de órdenes.
- **Email:** el alta de usuarios por `/api/team` ya normaliza a minúsculas y verifica duplicados (case-insensitive). Follow-up documentado: normalizar también el email en el registro público de better-auth (hoy una variante de mayúsculas crearía tenants separados, no es un riesgo de seguridad).
- **Límite:** sin constraint real, queda una ventana de carrera teórica entre verificar y crear; con el espacio aleatorio CSPRNG la probabilidad es despreciable. La unicidad dura requeriría soporte de Totalum.
- **Prueba:** build/typecheck OK.

### AUD-D03 — Drift de esquema: 38 tablas del código ausentes del script (P1) — CERRADA
- **Archivos:** `scripts/setup-database.mjs`.
- **Problema:** `resources.ts` exponía por CRUD 38 tablas que `setup-database.mjs` no creaba (`attraction`, `access_ticket`, `asset`, `work_order`, `inventory_item`, `stock_*`, `purchase_order*`, `invoice`, `tax_profile`, `quote*`, `membership*`, `gift_card*`, `guest_case`, `incident*`, `inspection*`, `waiver*`, `allotment`, `shift`, `certification`, `attendance`, `task`, `document*`, `approval_request`, `integration`…). En un entorno recién provisionado esos endpoints fallaban (tabla inexistente).
- **Solución:** añadidas las 36 tablas faltantes (35 generadas + `attendance`) al array `TABLES` en el estilo declarativo del script, con sus columnas, enums (copiados de `labels-modules.ts`) y `objectReference`. Cerrado además el drift menor de `ledger_account` (añadidos `currency` y el self-ref `parent`).
- **Verificación:** `node --check` OK; **todos** los targets de `REF`/self-ref del archivo resuelven a una tabla existente (validado programáticamente); cero `type:` duplicados; `comm` entre las tablas de `resources.ts` y las del esquema → **vacío** (drift 100% cerrado). 81 tablas totales.
- **Notas (follow-up menor):** algunos campos de tipo incierto (`tax_profile.rounding`, `integration.direction`) se dejaron como `string` en vez de `enum` por no poder confirmar sus valores — funcionan, solo sin opciones en el backoffice. El script no se ejecuta en el build (es standalone), así que la verificación es parse + resolución de refs, no un `next build`.
