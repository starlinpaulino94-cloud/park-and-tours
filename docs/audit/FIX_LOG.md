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
| Base de datos (P1) | **AUD-D01** (unicidad de códigos app-level), **AUD-D03** (drift cerrado: 36 tablas añadidas al script de schema, 81 totales) | ✅ Corregidos |
| Integraciones (P1) | **AUD-F22/S07** (webhook Stripe: firma en prod, idempotencia, persistencia real) | ✅ Corregidos |
| Validación final (Fase 6) | 9 defectos de la re-auditoría adversarial | ✅ Corregidos |
| Follow-ups (Fase 6+) | **readRole** por recurso, **allowlist de filtros**, **reconciliación de drafts** (endpoint) | ✅ Corregidos |
| Camino del dinero (Ola 10) | **AUD-M01** (cupo del socio mal atribuido), **AUD-M02** (cancelación con penalización reclamaba el saldo), **AUD-M03** (cancelar dos veces reembolsaba dos veces), **AUD-M04** (la reserva cancelada seguía viva en 11 sitios más) | ✅ Corregidos |
| Deferidos con fundamento | agregación en `base_amount` (necesita backfill), email en signup (riesgo de login), features nuevas (redención de tickets, billing checkout, reset de contraseña) | Trabajo de producto |

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

### AUD-F22 / S07 — Webhook de Stripe: handlers vacíos, firma opcional, sin idempotencia (P1) — CERRADA
- **Archivos:** `src/app/api/stripe/webhook/route.ts` (reescrito), `src/lib/types.ts` (Company), `scripts/setup-database.mjs` (company + tabla `stripe_event`).
- **Problema:** los 10 handlers eran `console.log` + TODO (nada persistía); sin `STRIPE_WEBHOOK_SECRET` se procesaban eventos **sin firma** (solo warning); Stripe reintenta y no había idempotencia.
- **Solución:**
  - **Seguridad:** en producción, un evento sin firma verificada se **rechaza** (500); la omisión de firma solo se permite fuera de producción.
  - **Idempotencia:** cada evento se deduplica por `event.id` contra la nueva tabla `stripe_event`; se registra **tras** procesar con éxito (un handler que lance deja el evento sin registrar para que Stripe reintente). Fail-open si la tabla no existe (nuestras actualizaciones son idempotentes).
  - **Persistencia real:** `customer.subscription.{created,updated,deleted}` e `invoice.{paid,payment_failed}` actualizan `company.subscription_status`/`next_billing_at`/`stripe_*`, resolviendo el tenant por `stripe_customer_id` o `metadata.company_id`; `checkout.session.completed` vincula la empresa con su customer/subscription. Si no resuelve empresa, loguea y no-op (nunca crashea).
  - Nuevos campos `stripe_customer_id`/`stripe_subscription_id` en `company` (types + schema).
- **Límite (follow-up):** no existe aún un flujo de compra de suscripción autenticado en la app (`create-checkout-session` solo lo usa la demo), así que hoy los handlers no-op por falta de vínculo; el webhook queda listo y activa el ciclo en cuanto un checkout pase `company_id` en metadata y guarde el customer. Autenticar/derivar el checkout de billing por tenant queda pendiente.
- **Prueba:** build/typecheck OK; schema parsea; refs resuelven; `stripe_event` añadida.

## Follow-ups no bloqueantes (Fase 6+)

### readRole por recurso (P2 — lecturas financieras sin gate) — CERRADO
- **Archivos:** `src/lib/resources.ts` (`readRoleFor`), `src/app/api/erp/[resource]/route.ts`, `[id]/route.ts`.
- **Problema:** el GET genérico del ERP no tenía control de rol → seller/cashier/operations podían leer comisiones, liquidaciones, pagos, costes, márgenes, plan contable, etc.
- **Solución:** mapa `READ_ROLE` por tabla (payment/caja → cashier; comisiones/settlements/receivable/costes/precios/ledger/invoice/gastos/compras → manager) aplicado en list y detalle **solo a roles no-partner** (el partner se rige por `partnerScopeFor`). Verificado: todos los `minRole` del nav de las páginas que leen esos recursos son ≥ el `readRole`, así que ninguna UI se rompe; el portal (partner) queda exento y sigue leyendo lo suyo.

### Allowlist de `filter.<campo>` en ERP (S06 follow-up) — CERRADO
- **Archivos:** `src/lib/resources.ts` (`allowedFilterFields`), `erp/[resource]/route.ts`.
- **Solución:** los filtros `?filter.<x>=` se restringen a search∪writable∪numeric∪dates∪relaciones∪set global seguro (`status`, `severity`, `payment_type`, …); los campos desconocidos se **ignoran** (no 400), así la UI no se rompe. Cierra la consulta de columnas internas arbitrarias.

### Reconciliación de drafts huérfanos (F34 follow-up) — CERRADO
- **Archivos:** `src/lib/booking-service.ts` (`reconcileStaleDrafts`), `src/app/api/maintenance/reconcile-drafts/route.ts`.
- **Solución:** `reconcileStaleDrafts(companyId, olderThanMinutes=30)` busca órdenes `draft` más antiguas que la ventana de seguridad y las compensa (libera cupo, anula hijos). Endpoint `POST /api/maintenance/reconcile-drafts` (rol admin, auditado), apto para cron. Maneja el único caso residual de la saga: un crash duro de proceso que deje un draft huérfano.

### Deferidos con fundamento (requieren migración/feature nueva, no cambio a ciegas)
- **Agregación en `base_amount`:** `base_amount` ya se puebla correctamente en bookings nuevos (rate resuelto por F30). Cambiar los `_sum` del dashboard/reportes a `base_amount` exige **backfill** de registros existentes (datos demo/históricos podrían tener el campo nulo → mostraría ceros). Es una migración de datos deliberada con acceso a BD, fuera del alcance de un cambio de código seguro. Los tenants de una sola moneda ya son correctos.
- **Normalización de email en signup público:** better-auth 1.3.26 no normaliza el email en el lookup de login; bajar el email solo en el alta rompería el login con variantes de mayúsculas. Requiere soporte de `normalizeEmail` en ambos lados. El alta por `/api/team` ya es case-insensitive segura.
- **Endpoints de ciclo de vida de `access_ticket`/`membership`/`gift_card`; checkout de billing autenticado por tenant; páginas de reset/verificación de email:** son **features nuevas** con decisiones de producto (motor de redención, mapeo plan↔precio de Stripe, envío de correos), no endurecimiento de código existente. Se dejan como trabajo de producto, no de auditoría.

---

## Ola 10 — Los tres que encontró la red sobre el camino del dinero

Estos no salieron de una auditoría por lectura: salieron de escribir las
primeras pruebas de `createOrderWithBookings` y `cancelBookingFully`, que hasta
entonces no tenían ninguna. Los tres llevaban tiempo en producción y ninguno
daba error: los tres producían números equivocados en silencio.

### AUD-M01 — El cupo del socio se cargaba al contrato equivocado (P1) — CERRADA
- **Problema:** en un carrito con dos productos, uno con contrato de cupo y otro
  sin él, la reserva del producto SIN cupo se quedaba apuntando al contrato del
  otro. El consumo era correcto; lo que estaba mal era el enlace que guarda la
  reserva. Venía de un respaldo que, al no encontrar el cupo de su producto,
  cogía el primero de la lista — un respaldo puesto para los contratos sin
  producto («plazas en lo que sea»), que atrapaba también a quien no tenía
  ninguno.
- **Efecto:** al cancelar, se le devolvían al contrato del otro producto plazas
  que nunca se le habían quitado. El socio acababa con más cupo del que compró.
  Sin negativo que lo delatara, porque la devolución se topa en cero.
- **Archivos:** `src/lib/booking-service.ts`, `src/lib/ui-contracts.test.ts`.
- **Solución:** el bucle que resuelve el cupo guarda el que aplica a CADA línea
  (`allotmentOfItem`) en vez de reconstruirlo después adivinando. El respaldo
  legítimo sigue funcionando y tiene prueba propia.
- **Prueba:** `booking-service.test.ts`, «un producto SIN cupo no se apunta al
  contrato de otro producto» — roja antes del arreglo, verde después.
- **Nota:** una guarda de `ui-contracts` exigía el texto literal de la línea
  defectuosa. Vigilaba la implementación, no la regla, y **protegía el error**.
  Reescrita para exigir la regla.

### AUD-M02 — Una cancelación con penalización le reclamaba el saldo al cliente (P0) — CERRADA
- **Problema:** `syncOrderTotals` tenía dos listas de estados terminales y a las
  dos les faltaba `partially_refunded` — el estado de una cancelación con
  penalización, o sea la más normal. Una decidía qué reservas cuentan en el
  total de la orden; la otra, a cuáles pisarles el estado y el saldo.
- **Efecto:** un cliente que cancelaba con diez horas de margen recibía su 50 %
  y la reserva quedaba en `partially_paid` con saldo positivo. El sistema creía
  que debía dinero de una excursión cancelada y el cron de cobranza se lo
  reclamaba. La orden seguía valiendo su importe entero: una venta deshecha
  contando como venta en todos los informes.
- **Archivos:** `src/lib/booking-service.ts`.
- **Solución:** una reserva muerta vale lo que el cliente pagó y no se le
  devolvió. Con esa regla los cuatro casos —sin pagar, reembolso total,
  reembolso parcial, sin derecho a reembolso— cuadran y ninguno deja saldo. Lo
  retenido por una cancelada no se reparte entre las reservas vivas.
- **Prueba:** `booking-cancel-service.test.ts`, «una cancelación no deja saldo,
  cobre lo que cobre» (los cuatro casos) y «lo retenido no se le regala a la
  reserva viva de al lado».

### AUD-M03 — Cancelar dos veces devolvía el dinero dos veces (P1) — CERRADA
- **Problema:** `TERMINAL_STATES` declara la regla en `booking-cancel-service`,
  pero la comprobación vivía en cada llamador. Los dos de entonces la hacían.
  Dentro de la propia función, los componentes de un paquete sí estaban
  protegidos; la cabecera no.
- **Efecto:** comprobado antes de arreglarlo — la segunda cancelación pasaba y
  salía un segundo pago de reembolso por el importe completo. Además, las plazas
  volvían al cupo del socio por partida doble.
- **Archivos:** `src/lib/booking-cancel-service.ts`.
- **Solución:** la guarda vive donde está escrita la regla. 409 `ALREADY_CANCELLED`.
- **Prueba:** `booking-cancel-service.test.ts`, «cancelar dos veces».

### AUD-M04 — La reserva reembolsada a medias seguía viva en once sitios más (P1) — CERRADA
- **Cómo apareció:** al arreglar AUD-M02 se escribió una guarda que exigía que
  la lista de estados terminales se escribiera una sola vez. La guarda encontró
  **quince archivos** que la escribían a mano, y a la mitad le faltaba
  `partially_refunded`. No era un error: era una clase.
- **Dónde dolía de verdad:**
  - `invoice-service.ts` — la **factura fiscal** incluía la reserva cancelada
    por su importe entero. Con NCF emitido.
  - `dispatch-service.ts` (dos sitios) — el manifiesto del guía y las rutas de
    recogida llevaban a un pasajero que había cancelado. *Este lo introduje yo
    en la ola 9, copiando el filtro corto que ya estaba en la ruta vieja.*
  - `settlements/generate` — se le liquidaba al vendedor una venta caída.
  - `checkin/page.tsx` — el pasajero cancelado aparecía en la lista de embarque
    del día.
  - `reports/profitability` — el informe contaba su ingreso y su costo.
  - `membego-redemption-service` — un beneficio podía aplicarse sobre una línea
    cancelada.
  - `superadmin/stats`, `portal/summary`, `portal/reservas` y cuatro puntos de
    `dashboard/reservas` — recuentos e interfaz.
- **Archivos:** los once anteriores, más `src/lib/types.ts` (donde ahora vive la
  única lista) y `src/lib/ui-contracts.test.ts` (la guarda).
- **Solución:** `BOOKING_TERMINAL_STATES` / `isTerminalBookingStatus` en
  `types.ts`, que no depende de nada y pueden importar los dos lados. La guarda
  exige que ninguna lista de estados de RESERVA se escriba a mano; las tres que
  quedan son de estados de ORDEN —otro enum, sin `partially_refunded`— y están
  apuntadas con su motivo, con una segunda guarda que comprueba que ese motivo
  es cierto.
- **Falsas alarmas descartadas por el camino, y conviene que consten:**
  `dashboard-metrics.ts` y la vista de 0023 **sí** incluyen `partially_refunded`
  como venta válida, pero las dos restan el reembolso (`netBookingAmount`,
  `base_refund_amount`): cuentan lo retenido, que es la misma regla que ahora
  aplica `syncOrderTotals`. Eran el precedente correcto, no un defecto.
- **Retirado:** `INVALID_SALE_STATUSES`, que no usaba nadie y prometía en su
  nombre ser el complemento de `VALID_SALE_STATUSES` sin serlo —le faltaban
  `partially_refunded`, `no_show` y `confirmed`—. El primero que lo hubiera
  usado habría contado mal sin enterarse.

### AUD-M05 — El conector de OTAs se tragaba el error de la base (P0) — CERRADA
- **Cómo apareció:** al escribir las primeras pruebas de `octo-service.ts` —mil
  líneas por las que entran reservas de terceros, sin una sola prueba— hubo que
  construir un doble del cliente de Supabase capaz de **rechazar escrituras**.
  Con él, dos pruebas fallaron a la primera.
- **La raíz:** `supabaseService()` no lanza cuando la base dice no; devuelve el
  error DENTRO del resultado. `const { data } = await consulta` compila, pasa la
  revisión, y se lleva el error al suelo. En este archivo había **nueve
  escrituras y catorce lecturas** así.
- **Efecto, por orden de gravedad:**
  - El plazo de la retención (`hold_until`) se escribía DESPUÉS de crear la
    venta y sin comprobar nada. Si falla, se queda nulo — y el barrido que
    libera plazas filtra por `hold_until < ahora`, que un nulo **no cumple
    jamás**, ni en Postgres ni en PostgREST. La plaza quedaba retenida para
    siempre, el revendedor recibía una reserva de aspecto correcto, y la
    excursión salía con asientos vacíos que el sistema daba por vendidos.
  - Una lectura fallida de la reserva por su uuid parece «no existe»: el
    reintento del revendedor —que reintenta siempre— apartaba OTRAS plazas para
    el mismo pasajero.
  - Una lectura fallida de las salidas parece «este producto no se vende por
    fecha»: la reserva entraba sin cupo comprobado y sin manifiesto.
- **Archivos:** `src/lib/octo-service.ts`, `src/lib/booking-service.ts`
  (`compensateOrder` exportada).
- **Solución:** `mustRead`/`mustWrite` — toda lectura o escritura que decida
  plazas o dinero comprueba su error y contesta 500. Si falla una de las dos
  escrituras posteriores a crear la venta, se deshace con la MISMA compensación
  de la saga del mostrador: la plaza vuelve a la salida. Dos excepciones, con el
  motivo escrito donde viven: las marcas de `octo_status: CANCELLED`, porque la
  cancelación ya ocurrió y el estado se deduce del estado interno.
- **De propina, el orden de dos escrituras:** confirmar paraba el plazo DESPUÉS
  de marcar la reserva. Si lo segundo fallaba quedaba una reserva confirmada
  bajo una venta con la retención viva — y el barrido la cancelaba sola. Ahora
  se para el plazo primero: el peor caso es una reserva aún retenida que el
  reintento termina. Confirmar es además reparador.
- **Y el barrido:** si no se puede marcar EXPIRED, ya no suelta la plaza. Al
  revés, el revendedor leía CANCELLED —incidencia con reembolso que decidir— en
  vez de un vencimiento que es suyo por no pagar a tiempo.
- **Pruebas:** `octo-service.test.ts` (28), con `breakWrites`/`breakReads`.

### AUD-M06 — El prorrateo del cobro borraba las ventas de OTA (P1) — CERRADA
- **Cómo apareció:** la prueba «confirmar cierra la venta» afirmaba que la
  reserva queda `confirmed` y encontró `pending_payment`. No lo escribía el
  conector: lo reescribía `syncOrderTotals` dos líneas después.
- **La raíz:** el prorrateo recalculaba el estado de cada reserva viva a partir
  de lo cobrado y, con saldo a cero, escribía `pending_payment` pasara lo que
  pasara. Pero `confirmed` no lo pone el dinero: lo pone quien se compromete a
  viajar **sin haber pagado todavía** — hoy, el revendedor de una OTA, que
  liquida a fin de mes.
- **Efecto:** las vistas del cuadro de mando (0023–0028) cuentan como venta las
  reservas en `('confirmed','partially_paid','paid','checked_in','completed',
  'no_show','partially_refunded')`; `pending_payment` queda fuera. Cada reserva
  de OTA confirmada **desaparecía de las cifras de la operadora**, y en el
  manifiesto salía como pendiente de pago.
- **Archivos:** `src/lib/booking-service.ts`, `src/lib/octo-service.ts`.
- **Solución:** el prorrateo promueve con el dinero y no degrada un compromiso:
  con saldo a cero, una reserva `confirmed` sigue `confirmed`. Cuando entra
  dinero manda el dinero (`partially_paid`/`paid`), que es correcto. Y el
  conector deja de escribir `status: 'confirmed'` en la VENTA: esa columna tiene
  un dueño, que es el cobro, y `pending_payment` es ahí la verdad —vendida y sin
  cobrar—.
- **Pruebas:** `booking-service.test.ts`, «sincronizar el cobro de una orden»
  (cuatro casos), más el ciclo completo en `octo-service.test.ts`.

### AUD-M07 — Veintiuna escrituras más que no miraban su error (P1) — CERRADA
- **Cómo apareció:** arreglado AUD-M05 en el conector de OTAs, se midió la misma
  forma en todo el repositorio. Veintiuna.
- **Las que dolían de verdad:**
  - `api/v1/bookings` — la **clave de idempotencia** se escribía DESPUÉS de
    crear la venta. Si falla, el reintento del socio —que reintenta siempre— no
    encuentra clave que lo frene: dos ventas, las mismas plazas apartadas dos
    veces y un pasajero cobrado dos veces. Es el gemelo exacto del bug de OCTO.
  - `stripe/webhook` (tres) — el estado de la suscripción. Un fallo se contestaba
    con 200, así que **Stripe no lo reintenta nunca más**: empresa cobrada y en
    «pendiente de pago», o al revés, hasta que alguien pierde el acceso.
  - `setup` y `superadmin/companies` — el `tenant_org_id` con el que una empresa
    se pertenece a sí misma. Sin él, la RLS la deja fuera de sus propios datos:
    un alta que termina en una cuenta que no ve nada.
  - `cron/collections` — el `reminded_at` de la cuota. Sin él, el mismo cliente
    recibe el mismo recordatorio cada día, para siempre.
  - `membego-redemption-service` — la marca de «revertido» después de que
    MembeGo ya revirtió el beneficio por su API. Sin ella, una segunda
    cancelación pide la reversa de algo ya revertido.
- **Archivos:** los doce anteriores más `plan-service`, `system-health-service`,
  `audit`, `membego-service`, `public-booking-service` y `auth/callback`.
- **Solución:** `src/lib/supabase/write.ts` con dos verbos y ningún tercero.
  `mustWrite` cuando la operación no vale sin esa escritura; `tryWrite` cuando lo
  que importaba ya pasó y no se puede deshacer —el dinero se movió, el correo
  salió— pero callarse tampoco es una opción: devuelve si llegó, para que quien
  llama no cuente como hecho lo que no se escribió.
- **Guarda:** `ui-contracts.test.ts`, «la base dice que no y alguien tiene que
  oírlo». Recorre `src/` y falla nombrando archivo y línea. Comprobada con una
  mutación: al quitar un `tryWrite`, la guarda lo señala.
- **Queda a cero:** ninguna escritura con la llave de servicio ignora su error.

### AUD-M08 — La plantilla de después del viaje no la encolaba nadie (P2) — CERRADA
- **Cómo apareció:** al investigar qué llevaba ya el sistema antes de construir
  la voz del cliente. `post_tour_thanks` existía en el catálogo de plantillas
  desde la ola de comunicaciones, con su desfase de cuatro horas y su disparador
  documentado —«4 horas después de terminar»—, en español y en inglés.
- **El defecto:** ninguna línea de código la encolaba. `grep` sobre todo `src/`
  solo la encontraba en su propia definición y en la tabla de etiquetas. Es el
  mismo caso que `departure.waitlist_pax` antes de la ola 11 y que
  `hotel.pickup_offset_min` antes de la 9: **una promesa escrita que nadie
  cumple**, y que además se ve en la pantalla de plantillas, así que la
  operadora cree que el mensaje sale.
- **Y lo de debajo:** aunque se hubiera mandado, su texto decía «contéstanos a
  este mismo correo». La opinión habría caído en una bandeja de entrada: nadie
  la tabula, nadie la atribuye a un guía y nadie la convierte en reseña.
  Preguntar sin medir es no preguntar.
- **Archivos:** `src/lib/messaging/templates.ts`, `src/lib/messaging/events.ts`.
- **Solución:** `enqueuePostTourSurvey` —lo que faltaba— y el texto reescrito
  con `{{enlace}}`, más la versión de WhatsApp que no existía. Quien encola es
  `voice-service` después de crear la fila de la encuesta, nunca antes: un
  enlace que no abre nada es peor que no mandar nada.
- **Guarda:** la de esta ola sobre el filtro por empresa en los servicios sin
  sesión, más las catorce mutaciones del módulo. La que faltaba de verdad la
  encontró la propia mutación: los filtros de inquilino **se tapaban entre sí**
  —al quitar el de la salida lo paraba el de las reservas y viceversa—, así que
  ninguno moría por separado. Ahora hay una prueba que muere con la mutación
  combinada y una guarda de código que los exige de uno en uno.

### AUD-M09 — La demostración estaba escrita y era inalcanzable (P1) — CERRADA
- **Cómo apareció:** un «no puedo acceder a las cuentas demo».
- **El defecto, en dos mitades:**
  1. `scripts/seed-demo-presentation.mjs` crea una empresa hermana y da
     membresía `is_primary: false`, y su mensaje final decía «cambia a la
     empresa de demostración **en el selector**». Ese selector no existía:
     `grep` sobre toda la aplicación no encontró nada que cambiara de empresa.
  2. La empresa de la sesión la resuelve el hook de la base
     (`order by mem.is_primary desc ... limit 1`) y, de respaldo,
     `loadClaimsFromPrimaryMembership` con el mismo orden. Siempre gana la
     principal. La demo quedaba sembrada y sin puerta.
- **Y no había ninguna cuenta demo:** el sembrador no crea usuarios, solo
  reparte membresías. Lo que se pedía por su nombre no existía.
- **La única puerta que sí había** era la suplantación del superadministrador,
  que es otra cosa: soporte, a cualquier empresa y por dos horas.
- **Archivos:** `src/lib/supabase/auth-context.ts`, `src/lib/tenant.ts`,
  `src/lib/workspace-service.ts`, `src/app/api/workspace/route.ts`,
  `src/components/tf/{app-shell,org-context}.tsx`,
  `scripts/seed-demo-presentation.mjs`, `.env.example`.
- **Solución:** una cookie de empresa activa honrada **solo** con membresía
  activa, con el rol resuelto desde ESA membresía. Lo segundo es lo que importa:
  conservar el rol de origen habría convertido el selector en una escalada de
  privilegios a un clic —`owner` en la tuya, `owner` en la de al lado donde solo
  eres `operations`— y encima invisible, porque todo funcionaría. Más tres
  cuentas de demostración con contraseña que no vive en el repositorio.
- **Guardas:** once pruebas sobre quién puede entrar a dónde, y cinco
  mutaciones, cinco muertas. La quinta —el orden del selector— sobrevivió a la
  primera vuelta porque el fixture ya tenía la empresa principal en primer
  lugar: sembrado al revés de como tiene que salir, el orden se comprueba de
  verdad.
- **Una guarda de una ola anterior, afinada:** «el sembrador no escribe
  `is_primary: true`» era correcta cuando solo repartía membresías a personas
  reales, y se quedó corta con las cuentas que SOLO existen en la demo —para
  ésas, la demo es su única empresa y es donde tienen que aterrizar—. Ahora la
  comprobación es por función: prohibido en la que toca a personas reales,
  permitido solo en la que crea las cuentas de demostración. Comprobado con una
  mutación.

### AUD-M10 — Un NCF consumido y no usado desaparecía (P0 fiscal) — CERRADA
- **Cómo apareció:** al escribir las primeras pruebas de `invoice-service.ts`,
  351 líneas sin ninguna. La función de la base (`public.next_ncf`) SÍ estaba
  probada —avanza de uno en uno, se agota y vence—; lo que no había probado
  nadie es qué hace la APLICACIÓN con el número una vez que lo tiene.
- **La raíz:** `next_ncf` consume el número de forma atómica, así que en cuanto
  vuelve está gastado para siempre. Todo lo que va después —el código único, la
  fila de la factura, cada línea del desglose— podía fallar, y entonces quedaba
  un HUECO en la secuencia.
- **Y el hueco no se podía justificar.** El 608 se arma leyendo facturas con
  estado `voided`; un número que nunca llegó a ser factura no aparece ahí, ni en
  el 606, ni en el 607. La DGII cruza el rango autorizado con lo declarado y ese
  número faltante no lo explica nadie tres meses después. **Lo peor es que la
  propia migración 0037 lo nombra**, entre los tres fallos que viene a evitar:
  «un número que se salta hay que justificarlo en el 606/607».
- **Dos defectos más, encontrados por las mismas pruebas:**
  1. Las líneas se escriben DESPUÉS de la factura, una a una y sin red. Si
     fallaba la segunda, quedaba un comprobante **emitido** —con su NCF, en el
     607, con su total— cuyo desglose mentía. La 0037 también lo dice: «una
     factura sin líneas no se puede sostener ante una inspección».
  2. Y esa factura rota **bloqueaba la orden**: la comprobación de «ya tiene
     factura» la encontraba viva, así que la caja no podía volver a facturar esa
     venta — y para desbloquearla habría que emitir una nota de crédito contra
     un comprobante que el cliente nunca recibió. Este no lo había previsto: lo
     destapó la tercera prueba.
- **Archivos:** `src/lib/invoice-service.ts`.
- **Solución:** todo lo posterior a consumir el número va dentro de una red. Si
  algo falla, `declareBurnedNcf` deja el número DECLARADO como comprobante
  anulado con el código **09 — «Errores en secuencia de NCF»**, que es el de la
  lista oficial que describe exactamente esto. Entonces el 608 lo recoge solo,
  sin tabla nueva ni migración. Si la factura ya existía se anula ESA, que de
  paso desbloquea la orden.
- **No tapa el error de verdad:** la compensación es el mejor esfuerzo y no
  relanza. Con la base caída no hay dónde dejar el rastro, y lo que el cajero
  tiene que ver es el fallo original, no «no se pudo anular». Hay prueba propia.
- **Mutación:** cuatro, cuatro muertas (sin red, código inventado, la rota
  emitida, y la compensación tapando el error).

### AUD-M11 — El 606/607 se declaraba con el mes de UTC (P1 fiscal) — CERRADA
- **Cómo apareció:** primeras pruebas de `dgii-service.ts`. `dgii.ts` —el
  formato— estaba probado entero; la REUNIÓN de los datos no.
- **Dos defectos, los dos sistemáticos:**
  1. **El mes se calculaba en UTC.** `${month}-01T00:00:00.000Z` con una
     operadora en Santo Domingo (UTC−4) desplaza el mes cuatro horas: una
     excursión vendida a las 21:00 del 30 de septiembre en el mostrador de un
     hotel —que es cuando más se vende— se declaraba en **octubre**. Y no es
     solo el fin de mes: la misma cuenta escribía la fecha del día SIGUIENTE en
     toda venta posterior a las 20:00.
  2. **El rango era cerrado por los dos lados.** Terminaba en el primer instante
     del mes siguiente con `lte`, así que ese instante caía en los dos meses. En
     el 606 era peor: `expense_date` es una fecha, y `lte` contra el día 1 del
     mes siguiente metía **cada gasto del día 1 en el mes anterior además del
     suyo**. No un borde improbable: cada primero de mes.
- **Archivos:** `src/lib/dgii-service.ts`.
- **Solución:** `monthRange(month, tz)` resuelve la medianoche local a instante
  UTC con las ayudas que ya existían (`companyTimeZone`, `zoneOffsetMs`), el
  rango pasa a ser semiabierto (`gte`/`lt`), y la fecha que va al archivo se
  convierte al día de calendario de la empresa antes de formatearla.
- **Mutación:** cuatro, cuatro muertas.

### AUD-M12 — Al proveedor se le podía pagar dos veces el mismo viaje (P0) — CERRADA
- **Cómo apareció:** una prueba de concurrencia sobre
  `generateSupplierSettlement`, simulando dos liquidaciones a la vez.
- **La raíz:** el servicio releía cada devengo antes de reclamarlo y decidía en
  la APLICACIÓN. Eso estrecha la ventana y no la cierra: entre la lectura y la
  escritura cabe otra liquidación. Comprobado — la segunda pisaba el enlace de
  la primera **y contaba el importe igual**, así que el mismo viaje salía en dos
  liquidaciones y al transportista se le pagaba dos veces. La diferencia se
  descubre cuadrando el banco, semanas después.
- **Archivos:** `src/lib/supplier-settlement-service.ts`.
- **Solución:** la condición viaja DENTRO de la escritura —
  `update … where id = ? and status in (…)`— y lo que se cuenta es la fila que
  la base devuelve, no la que se leyó antes. Sin transacciones, es lo único que
  cierra la ventana: el desempate lo resuelve Postgres, que es donde se puede.
- **Una guarda de una ola anterior, reescrita:** exigía
  `CLAIMABLE.has(fresh.status)`, o sea la implementación vieja, y saltó al
  sustituirla por una más fuerte. Es el mismo caso que AUD-M01: una guarda que
  fija el código en vez de la regla acaba protegiendo el defecto. Ahora afirma
  la regla.
- **Mutación:** cuatro, y una sobrevivió — quitar el filtro por empresa del
  reclamo no rompía nada, igual que en la ola 13. Se cerró extendiendo la guarda
  de código del filtro de inquilino a este servicio, aunque use el cliente con
  sesión: ahí la RLS es la barrera de verdad, pero el día que alguien lo cambie
  por la llave de servicio el filtro ya tiene que estar.

### AUD-M13 — El mensaje de la puerta afirmaba una causa que nadie le dijo (P2) — CERRADA
- **Cómo apareció:** una cuenta de demostración que no entraba. El formulario
  contestaba *«Email o contraseña incorrectos para este ambiente. Verifica que
  la cuenta exista en este proyecto»*, y eso mandó a revisar la base de datos
  cuando el servidor no había dicho nada de la base de datos.
- **La raíz:** Supabase contesta `invalid_credentials` a **tres** situaciones
  —la cuenta no existe aquí, la contraseña no es esa, la cuenta quedó en otro
  proyecto— y las junta a propósito: separarlas en la respuesta convertiría el
  formulario en un buscador de correos existentes. La pantalla elegía una de las
  tres y la daba por cierta. En el caso corriente, una contraseña mal tecleada,
  el mensaje manda a buscar el problema donde no está.
- **Y lo demás llegaba crudo:** email sin confirmar, cuenta bloqueada, límite de
  intentos y servidor inalcanzable salían con el texto del proveedor, en inglés.
  El peor de los cuatro es el último: sin red no hay respuesta, y enseñar
  «contraseña incorrecta» ahí hace que alguien cambie una que estaba bien.
- **Archivos:** `src/lib/auth-errors.ts` (nuevo), `src/lib/auth-client.ts`
  (reenvía `code` y `status`, no solo el texto), `src/app/login/page.tsx`,
  `src/app/register/page.tsx`, `scripts/check-account.mjs` (nuevo).
- **Solución, en dos mitades.** La pantalla dice lo único que sabe —«no
  coinciden»— y ofrece lo único que se puede hacer sin adivinar: restablecerla.
  Lo que **no** es ambiguo sí se distingue, porque ocultarlo no protege nada y
  deja a la persona probando contraseñas correctas. Y la otra mitad: la pantalla
  puede dejar de adivinar porque ahora hay dónde mirar de verdad —
  `npm run check:account -- --email=…` dice a qué proyecto apunta el despliegue,
  si la cuenta existe **ahí**, si su email está confirmado, si está bloqueada y a
  qué empresas pertenece con qué rol. Corre con credenciales, no delante de un
  desconocido, y **solo lee**: un comprobador que además escribe es uno que nadie
  se atreve a ejecutar cuando hace falta.
- **Mutación:** cuatro, cuatro muertas — volver a traducir en la pantalla,
  saltarse el traductor en el registro, devolver el mensaje que adivina, y hacer
  que el comprobador escriba.
- **De paso, un cabo suelto del sembrador viejo:** `demopresentaciones@havelgo.com`
  venía escrita en el código del sembrador anterior, que **no creaba el usuario**
  —exigía darlo de alta a mano en Supabase Auth—. Ninguna orden del repositorio
  la crea hoy, así que en un proyecto que no la tenga no hay contraseña que
  valga. Queda escrito en `docs/operaciones/ENTRAR_A_LA_DEMOSTRACION.md`.

### AUD-M14 — El diagnóstico existía solo para quien tuviera terminal — CERRADA
- **Cómo apareció:** «quiero hacer todo eso en el editor de SQL de Supabase, no
  en la terminal». Una herramienta de diagnóstico que exige un entorno de
  desarrollo montado no está disponible el día que hace falta, que es
  precisamente el día en que alguien no puede entrar.
- **Archivos:** `docs/operaciones/DESDE_EL_EDITOR_SQL.md` (nuevo),
  `supabase/tests/sql_playbook.test.sql` (nuevo),
  `supabase/tests/00_supabase_stub.sql` (las columnas de GoTrue que el cuaderno
  consulta, más `auth.identities`).
- **Lo que sí se puede desde SQL, y se documenta:** ver si la cuenta existe en
  ESTE proyecto y en qué estado, a qué empresas pertenece y dónde aterriza, dar
  o corregir una membresía, y confirmar un email.
- **Lo que NO, y por qué se dice en vez de improvisarlo:** crear la cuenta o
  ponerle contraseña. El hash vive en `auth.users` pero quien lo interpreta es
  GoTrue, que además lleva identidades, sesiones y auditoría propias: escribirlo
  a mano cambia la mitad que se ve y deja la otra como estaba, y una cuenta a
  medias que parece funcionar falla después y en otro sitio. El camino sin
  terminal es *Authentication → Users*, dos clics. El atajo en SQL queda escrito
  con lo que se está aceptando al usarlo, incluido que la clave se queda en el
  historial del editor.
- **Y sembrar la demostración tampoco:** son catálogo, reservas, cobros y
  contabilidad con dependencias entre sí. Lo que sí contesta el cuaderno es si
  **ya está sembrada**, que es la pregunta que de verdad se tenía.
- **La guarda, que es lo que separa esto de un apunte:** el cuaderno **se
  ejecuta** en cada CI contra un Postgres real con todas las migraciones. No
  solo que corra: que buscar el correo en mayúsculas encuentre la cuenta, que la
  ★ sea la misma empresa que elegiría el enganche del token, que el bloque de
  membresía no borre la de la empresa real ni duplique al repetirlo, que un slug
  inexistente no escriba nada, y que el segundo primario choque contra
  `memberships_one_primary` — que es el motivo de que el bloque vaya en dos
  sentencias y en ese orden.
- **Mutación:** cuatro. Tres muertas a la primera. **La cuarta no mordió**: la
  idempotencia del bloque 4 se comprobaba comparando la fecha antes y después, y
  `now()` devuelve el reloj de la TRANSACCIÓN — la prueba entera es una sola, así
  que las dos pasadas escribían el mismo instante y la aserción pasaba también
  sin el `coalesce`. En el editor cada bloque es su propia transacción y ahí sí
  diferirían: la aserción cómoda era justo la que no servía donde importa. Se
  reescribió midiendo `row_count`, y entonces mordió.

### AUD-M15 — El cuaderno de SQL se pegaba mal, y nada lo impedía — CERRADA
- **Cómo apareció:** se pegó `supabase/tests/sql_playbook.test.sql` en el editor
  de Supabase y contestó `syntax error at or near "\"`. Es la prueba automática
  del cuaderno, no el cuaderno: usa órdenes de `psql` (`\set`, `\echo`) que el
  editor no entiende. Confusión razonable — dos ficheros con el mismo tema, y
  sólo uno se pega.
- **Lo que de verdad falló:** nada comprobaba que lo que se entrega **sea
  pegable**, ni que siga encajando con el esquema. Documentación que nadie
  ejecuta envejece en silencio, y ésta se usa el peor día contra producción.
- **Archivos:** `scripts/extract-doc-sql.mjs` (nuevo), `scripts/db-test.sh`,
  `docs/operaciones/DESDE_EL_EDITOR_SQL.md`,
  `supabase/tests/sql_playbook.test.sql` (aviso en la cabecera).
- **Solución:** el CI **ejecuta los bloques del cuaderno** contra el Postgres
  efímero con todas las migraciones aplicadas. Los correos y slugs de los
  ejemplos no existen, así que las escrituras tocan cero filas: lo que se
  comprueba es que todos analizan y encajan. Y el extractor rechaza cualquier
  bloque con una orden de `psql`, que es exactamente el defecto que se vio.
  El único bloque que no puede correr —el atajo con `extensions.crypt`, que vive
  en Supabase y no en Postgres— va marcado `ci:skip` con el motivo a la vista.
- **Y una consulta única al principio del cuaderno**, que contesta las diez
  preguntas de una pegada y termina diciendo qué hacer. Probada en los cuatro
  estados que importan: cuenta ausente, sin confirmar, sin empresa, y sana. Con
  la cuenta ausente las filas que dependen de ella salen `—` en vez de
  inventarse un estado — decir «ninguna empresa» de una cuenta que no existe es
  la clase de dato que manda a arreglar lo que no está roto.
- **Mutación:** dos, dos muertas — colar un `\set` en el cuaderno, y renombrar
  una columna que el cuaderno consulta.

### AUD-M16 — El E2E se apropiaba de la cuenta de una persona en cada PR (P0) — CERRADA
- **Cómo apareció:** «no me permite entrar aunque pongo todo bien». La consulta
  de diagnóstico del cuaderno contestó lo que ningún vistazo al formulario podía
  decir: la cuenta existe, está confirmada, tiene contraseña, entró hoy… y su
  empresa de aterrizaje es **E2E Tenant**.
- **La raíz:** el secreto `E2E_EMAIL` del CI apuntaba a una cuenta de
  demostración en uso. `tests/e2e/global-setup.ts` corre con la llave de
  servicio y, en **cada ejecución** —o sea, en cada PR—, hacía dos cosas:
  1. `updateUserById(..., { password })` le **reescribía la contraseña**;
  2. `update({ is_primary: false }).neq(organization_id, e2e)` le **movía la
     empresa de aterrizaje** al inquilino de pruebas.
- **Por qué era tan difícil de ver:** el efecto es silencioso, a distancia y
  disfrazado de error de quien lo sufre. La persona tecleaba una contraseña que
  era correcta cuando la puso; nada en pantalla apuntaba a la causa, porque la
  causa había ocurrido la última vez que alguien abrió un PR.
- **Archivos:** `tests/e2e/global-setup.ts`,
  `tests/e2e/global-setup.test.ts` (nuevo), `vitest.config.ts`,
  `playwright.config.ts`, `.env.example`.
- **Solución:** el arranque sólo opera sobre una cuenta **exclusiva del E2E**.
  Antes de escribir nada lee las membresías; si hay alguna fuera de
  `e2e-tenant`, falla nombrando la cuenta, la empresa que la reclama y el
  remedio. El orden es el arreglo: comprobar después de reescribir la contraseña
  no comprueba nada, el daño ya está hecho.
- **De reparto:** `tests/**` entra ahora en Vitest, y Playwright se queda con
  `**/*.spec.ts`. El arranque del E2E es lógica que corre con la llave de
  servicio y decide a quién le cambia la contraseña: no podía seguir siendo el
  único código sin pruebas por estar en la carpeta de Playwright.
- **Mutación:** tres, tres muertas — invertir el orden (escribir y luego
  preguntar), quitar la comprobación, y vaciar el mensaje de error.
- **Lo que queda abierto, y no es de código:** el E2E corre contra el **proyecto
  de Supabase de producción**. Cada PR mantiene ahí la empresa `e2e-tenant`, y el
  secreto del CI es una llave de servicio sobre la operación de verdad. Anotado
  como **CI-001** en el informe de preparación; se cierra con un proyecto aparte
  para CI, no con más código.

### AUD-M17 — La empresa de demostración estaba vacía (P1) — CERRADA
- **Cómo apareció:** «no hay ni un solo dato demo, quiero que todos los módulos
  tengan datos». Al entrar a la empresa demo no se veía nada — el peor efecto
  para una presentación, porque parece que el sistema está vacío.
- **La raíz, doble:** (1) la empresa donde aterriza la cuenta,
  `havelgo-demo-presentaciones`, es la del sembrador VIEJO y nunca tuvo datos;
  el sembrador nuevo (`scripts/demo/*.mjs`) llena una empresa distinta —hermana
  de la real—. (2) Ese sembrador es JavaScript con la llave de servicio y lee de
  la base entre inserciones: no se puede correr desde el editor SQL, que es como
  trabaja quien monta la demostración.
- **Archivos:** `supabase/seed/demo_presentation.sql` (nuevo, 648 líneas),
  `scripts/db-test.sh`, `docs/operaciones/ENTRAR_A_LA_DEMOSTRACION.md`.
- **Solución:** un sembrador **SQL** pegable en el editor de Supabase, que carga
  la empresa demo completa —85 tablas, todos los módulos: catálogo, clientes,
  ventas, cobros, facturas con NCF, comisiones, operación, caja, almacén y
  plataforma—. Idempotente (borra lo suyo y resiembra), con ids deterministas
  (`md5('demo:...')::uuid`) para enlazar módulos, y con los importes cuadrando
  entre sí: el total de una orden es la suma de sus reservas, los pagos no
  superan lo facturado, la comisión sale del total. Se validó columna a columna
  contra el esquema real (enums, checks, claves únicas, referencias de
  inquilino).
- **La guarda:** `scripts/db-test.sh` lo ejecuta contra un Postgres con todas
  las migraciones, y lo corre **dos veces** — la segunda comprueba que de verdad
  es idempotente, porque si dejara restos chocaría contra una clave única. Una
  migración que cambie una tabla que el sembrador llena pone el CI rojo en vez
  de fallar delante de un cliente.
- **Un detalle del esquema, de paso:** `sales_order.branch_id` y
  `booking.branch_id` referencian `organizations` (una sucursal es un nodo org),
  mientras que `departure.branch_id` y `shift.branch_id` referencian `branch`.
  No es un error, pero es una inconsistencia que costó una iteración descubrir.
