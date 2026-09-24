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

### AUD-M17b — El sembrador reventaba si la base iba por detrás de las migraciones
- **Cómo apareció:** al pegar el sembrador en un proyecto real:
  `ERROR: relation "guest_survey" does not exist`. Esa tabla es de la 0067; el
  proyecto no la tenía aplicada. El CI no lo vio porque aplica todas.
- **Solución:** el sembrador se volvió tolerante a un esquema por detrás. El
  borrado salta las tablas ausentes y las reporta; las inserciones de
  `guest_survey` van dentro de un `IF to_regclass(...) IS NOT NULL` —el SQL
  estático de una rama no tomada no se planifica, así que una tabla ausente no
  rompe el sembrado—; y el recuento cuenta con una función que devuelve 0 si la
  tabla falta. En vez de reventar a mitad, avisa qué falta y carga el resto.
- **Se probó en los dos escenarios:** esquema completo (siembra las 25 encuestas,
  sin avisos) y esquema sin `guest_survey` (dos avisos, carga las 60 reservas y
  36 facturas igual, encuestas=0).
- **Nota para el usuario:** el aviso es la señal de que hay migraciones
  pendientes, que la app también necesita. Queda escrito en la guía.

### AUD-M18 — El selector de empresa no cambiaba el panel ni la RLS (P1) — CERRADA
- **Cómo apareció:** cargada la demo, al cambiar a esa empresa con el selector el
  panel daba «dashboard organization is outside your tenant» y todos los módulos
  seguían vacíos.
- **La raíz:** el selector (0014) guardaba la empresa elegida en una cookie y
  reresolvía la membresía por petición. Eso alcanza a `tenantQuery` (llave de
  servicio + filtro explícito por empresa), pero NO a lo que lee por sesión y
  RLS: `dashboard_summary` compara la empresa pedida contra `app.current_org_id()`,
  que lee el `org_id` del **JWT** —fijado en el login a partir de la membresía
  principal—. La cookie cambiaba; el token, no. Split-brain.
- **Archivos:** `supabase/migrations/0068_active_workspace.sql` (nuevo),
  `supabase/tests/active_workspace.test.sql` (nuevo),
  `src/app/api/workspace/route.ts`, `src/components/tf/org-context.tsx`,
  `scripts/migration-checks.mjs`.
- **Solución:** la empresa activa se guarda por persona (`user_active_workspace`)
  y el enganche del token la PREFIERE sobre la principal —solo si sigue habiendo
  una membresía activa ahí—. La ruta de cambio la persiste con la llave de
  servicio, y el cliente refresca la sesión (`auth.refreshSession()`) tras el
  cambio para que el enganche reemita el `org_id`. Así RLS, el panel y
  `tenantQuery` quedan alineados sin cerrar sesión.
- **La red de seguridad, probada contra Postgres:** el enganche, llamado como lo
  llama GoTrue, pone la empresa activa; si la membresía en esa empresa se
  desactiva, el token vuelve solo a la principal; y al borrar la selección,
  también. Cuatro aserciones.
- **El enganche es SECURITY DEFINER, y sigue siéndolo:** 0068 repite los dos
  atributos (`security definer`, `set search_path`) y su propia comprobación,
  porque omitirlos es exactamente lo que tumbó el login en 0063.
- **Nota de despliegue:** requiere 0068 aplicada y el código desplegado. Hasta
  entonces, ver una empresa distinta a la principal se hace con
  principal + re-login.

### AUD-M19 — 42 módulos de la demo salían vacíos (P1) — CERRADA
- **Cómo apareció:** con la demo cargada y visible, muchas secciones seguían
  vacías: Tickets, Quién trajo al cliente, Metas, Bonos, Membresías, Activos,
  RR.HH., Liquidaciones, Contabilidad, Mantenimiento, Incidencias…
- **La raíz:** el sembrador SQL llenaba ~58 tablas de las ~85 que el sistema
  usa. Faltaban 42.
- **Solución:** una sección nueva en `supabase/seed/demo_presentation.sql` que
  llena 40 de esas 42 tablas, enlazadas a las entidades ya sembradas
  (reservas, vendedores, salidas, personal, activos): contabilidad
  (currency_rate, ledger_account/entry, accounting_period), catálogo profundo
  (product_cost, product_bundle_item, plantillas), membresías, red de ventas
  (seller_link, seller_goal, seller_bonus, commission_rule), cotizaciones con
  opciones y líneas, extras, tickets de acceso, exenciones, lista de espera,
  calendario de pagos, movimientos de tarjeta regalo, arqueos, liquidaciones y
  cuentas por pagar, nómina, activos y mantenimiento, incidencias y acciones,
  bitácora de atracciones, acuses, aprobaciones y salud del sistema.
- **Dos que NO se siembran, a propósito:** `seller_attribution` y
  `commission_adjustment` son históricos INMUTABLES (trigger append-only:
  ni update ni delete), y sus claves foráneas en cascada bloquearían el borrado
  de vendedores/comisiones al re-sembrar. Sembrarlos rompería la idempotencia de
  la demo. Se llenan solos con el uso real (un QR escaneado, un ajuste hecho).
- **La guarda:** probado en dos pasadas contra Postgres con todas las
  migraciones (idempotente), y los 13 trozos planos regenerados corren en orden
  en CI. Auditoría final: 83 de 85 tablas de `SEED_TABLES` con datos; las 2
  restantes son las append-only, por diseño.

### AUD-M20 — Casi todo lo que se registra a diario no dejaba rastro (P1) — CERRADA
- **Cómo apareció:** «ninguna acción que se realice dentro del sistema debe
  quedar sin reporte». Al medirlo: de 95 rutas que cambian datos, **27 no
  escribían en la bitácora**, ni por sí mismas ni a través de un servicio.
- **La raíz, y era la peor posible:** el CRUD genérico —por donde pasa la
  mayoría de lo que se registra un día normal: clientes, proveedores, activos,
  gastos— anotaba el **borrado** desde el principio, pero **no la creación ni la
  edición**. O sea que la pantalla de Auditoría parecía completa y no lo era,
  que es peor que no tenerla.
- **Archivos:** el CRUD genérico (`erp/[resource]` POST y `[id]` PUT), y once
  rutas más: caja, inventario, asientos contables y su reversión, plan de
  cuentas, estado de activos y de atracciones, generación de salidas, subida de
  archivos, y los caminos sin sesión —encuesta respondida y baja, reservas de
  OTA (confirmar/extender/cancelar), webhooks de MembeGo y Stripe—.
- **Dónde va la anotación:** en la ruta cuando hay sesión; **dentro del
  servicio** cuando no la hay (encuestas, OCTO), porque es quien conoce la
  empresa. Una encuesta la contesta alguien sin cuenta: si no se anota ahí, no
  se anota en ningún sitio.
- **Qué se guarda de una edición:** los NOMBRES de los campos que cambiaron, no
  sus valores. «Alguien editó la reserva» no reconstruye nada; «cambió precio y
  titular» sí. Y no se copian datos del cliente a una tabla que nadie puede
  borrar.
- **La guarda:** toda ruta mutante audita o delega en un servicio que audita.
  Las ocho excepciones van con su motivo escrito (un cálculo de precio no es una
  acción; marcar avisos como leídos sería ruido; la disponibilidad de la OTA es
  una lectura con verbo POST).
- **Mutación:** dos, dos muertas — quitar la auditoría de la creación, y dejar
  la edición sin decir qué campos cambiaron.

### AUD-M21 — Todo reporte con rango de fechas perdía su último día (P0) — CERRADA
- **Cómo apareció:** construyendo el marco de reportes. El filtro de los
  listados mandaba `lte: new Date("2026-09-30")`, que es la **medianoche** del
  30: «hasta el 30» dejaba fuera el 30 entero.
- **El alcance:** no era una pantalla. `buildListFilter` es el filtro de TODOS
  los listados y de TODAS las exportaciones a CSV. Cada reporte con rango de
  fechas venía perdiendo una jornada, en silencio, y el archivo se veía bien.
  Y el corte iba en UTC: una venta de las 21:00 en Santo Domingo se contaba en
  el día siguiente — el mismo defecto que hubo que corregir en el 606/607.
- **Archivos:** `src/lib/report.ts` (nuevo, dominio puro), `src/lib/erp-query.ts`.
- **Solución:** rango **semiabierto** con los cortes en la medianoche de la
  **empresa**: `desde <= t < día siguiente al hasta`. Dos reportes consecutivos
  se tocan sin solaparse: nada se pierde ni se cuenta dos veces.
- **Mutación:** dos, las dos muertas — volver al corte cerrado (caen 4 pruebas)
  y volver a cortar en UTC (caen 3).

### AUD-M22 — El marco de reportes y la bitácora de actividad
- **Qué se añade:** `ReportShell`, el marco común de todo reporte: período en la
  URL (se comparte por enlace y el botón de atrás funciona), atajos, impresión y
  CSV. El encabezado impreso lleva empresa, reporte y período; el pie, cuándo se
  generó. Una hoja sin eso no se puede archivar.
- **La bitácora** (`/dashboard/reportes/actividad`): todo lo que se hizo en un
  período, con resumen por módulo arriba —quien firma necesita el volumen antes
  que el detalle— y el detalle debajo. No es la pantalla de Auditoría con otro
  nombre: aquélla sirve para BUSCAR un evento, ésta para CERRAR un período.
- **60 acciones salían en el papel con su nombre técnico.** La guarda recorre
  cada `writeAudit` del código y exige su texto en castellano: si mañana alguien
  añade una acción y no la traduce, el CI lo para antes de que
  `octo_hold_extended` acabe en un archivador.
- **El resumen tiene desempate alfabético**, y eso es una decisión: sin él, dos
  módulos con el mismo total bailan de sitio entre dos impresiones del MISMO
  período, y dos copias dejan de poder compararse línea a línea.
- **Mutación:** una más, muerta — quitar el desempate.

### AUD-M23 — Veintidós reportes imprimibles por fecha, de un registro
- **Qué pedía el negocio:** que cualquier cosa que el sistema haga se pueda
  imprimir acotada a un período. Convertir cada pantalla operativa en reporte
  habría sido invasivo —son pantallas con acciones, no documentos— y habría
  dejado veinte selectores de fecha distintos.
- **Lo que se hizo:** un **registro** (`src/lib/reportes.ts`) donde cada reporte
  es un dato —tabla, campo de fecha, columnas, qué se suma— y **una sola
  pantalla** (`/dashboard/reportes/[slug]`) que los pinta todos. El período, la
  impresión, el CSV y los totales son literalmente el mismo código en los
  veintidós, así que no pueden divergir. El índice sale del registro, no de una
  lista a mano: añadir un reporte basta para que aparezca.
- **Lo que NO entra en el registro:** el 606/607, la antigüedad de saldos, la
  rentabilidad. Ésos CALCULAN, no listan, y tienen su propio servicio.

- **Un documento que trae la primera página no es un documento.** El listado del
  ERP pagina de 200 en 200. Para una pantalla está bien; para una hoja que dice
  «Ventas de septiembre» y trae 200 de 340, no: el total del pie parece correcto
  y está mal. La pantalla pide las páginas que hagan falta hasta juntar el
  período, con tope duro de 2.000 filas — y al llegar al tope **lo dice en el
  papel** y manda al CSV, en vez de imprimir un total incompleto con cara de
  completo.

- **`partially_paid` en una hoja firmada.** Las columnas de estado salían con la
  clave cruda de la base. Una hoja que hay que traducir mentalmente no es un
  reporte. Ahora el registro declara qué columnas son enum y `textoCelda` las
  traduce; una que nadie haya traducido se humaniza («algo muy raro») antes que
  imprimir el identificador. La guarda recorre el registro y exige `etiqueta` en
  los quince campos que en este sistema siempre son enum.

- **FALLO REAL, de los que no dan error:** la bitácora pedía
  `_limit=200&_sort=occurred_at:desc`. La ruta `/api/erp/:recurso` lee `limit` y
  `sort` —sin guion bajo—, así que los **ignoraba en silencio**: el reporte
  salía con 50 eventos, en el orden por defecto, con toda la pinta de estar
  completo. El guion bajo es la forma interna de `tenantQuery`, no la de la URL,
  y confundirlas no rompe nada visible. La guarda ahora recorre las pantallas y
  rechaza cualquier parámetro `_*` en una URL; en el servidor sigue siendo
  correcto, porque allí se le habla directo a `tenantQuery`.

- **Tres guardas ajenas saltaron al registrar `guest_survey` como recurso**, y
  las tres tenían razón: el expand declaraba `guide_staff` sin destino (la
  encuesta nombra al guía por su papel, no por su tabla), y las encuestas no
  salían en «llévate tus datos» — la opinión de un huésped es suya y tiene que
  ir en el ZIP. Se registra de **solo lectura** (`writable: []`): una valoración
  corregida a mano deja de ser una valoración.

- **Una columna inventada no revienta: sale vacía.** El reporte se imprimiría
  con una raya en todas las filas y nadie sabría si es que no hay dato o que la
  columna está mal. Tres guardas nuevas cruzan el registro contra el esquema
  reconstruido de las migraciones: el campo de fecha existe, cada columna
  existe (resolviendo los alias, `customer` → `customer_id`) y toda relación la
  expande su recurso, para que la celda no acabe imprimiendo un UUID. La
  primera ya atrapó algo al escribirla: `order` vive en la tabla `sales_order`.

- **Mutación:** ocho, las ocho muertas — volver a `_limit` en la URL, dejar una
  columna `status` sin `etiqueta`, que `textoCelda` deje de traducir, que un
  vacío imprima cero en vez de raya, quitar el enlace del índice, y torcer el
  campo de fecha, una columna y una relación del registro.

### AUD-M24 — Los documentos que se firman: cierre del día, contables y fiscales
- **Qué faltaba:** el sistema calculaba estados financieros, la declaración de
  la DGII y la antigüedad de saldos, pero **ninguna de esas pantallas se podía
  imprimir**. Un estado de resultados que solo existe en un navegador no es un
  documento contable, y un 606 que solo se baja como TXT no se puede archivar:
  el archivo de la DGII es texto plano con barras, ilegible para quien tiene
  que cuadrarlo antes de enviarlo y para quien lo busca un año después.
- **El cierre del día no existía en absoluto.** Se reconstruía abriendo cinco
  pantallas y apuntando en un cuaderno, que es exactamente donde se pierde.

- **Cinco copias del encabezado impreso, evitadas a tiempo.** Lo que convierte
  una hoja en documento —empresa, título, período, pie, firmas— vive ahora en
  `hoja-impresa.tsx`, y lo usan los cinco. Con cinco copias, a los seis meses
  tres dicen la empresa y dos no. Dos guardas: ninguna pantalla de
  `/dashboard/reportes` puede quedarse sin encabezado impreso ni sin forma de
  imprimirse, y ninguna puede escribirse el suyo por su cuenta.

- **EL FALLO QUE UNA GUARDA AJENA ATRAPÓ.** La primera versión del cierre
  contaba como dinero entrado «todo cobro que no esté rechazado». La vista
  financiera de la migración 0023 —la que alimenta el panel— cuenta solo los
  `completed` y **resta** los de tipo `refund` y `credit_note`. Con las dos
  reglas conviviendo, el cierre del martes y el panel del martes daban cifras
  distintas del mismo día, y no hay forma de saber cuál creer. Se adoptó la
  regla de la vista, y una guarda nueva **lee la migración** y falla si dejan de
  decir lo mismo.

- **El fondo de apertura no es venta del día.** Sin restarlo del contado, TODA
  caja que abra con dinero parece tener un sobrante exactamente igual a su
  fondo. Un aviso que sale todos los días se aprende a ignorar, y el día que el
  descuadre es real nadie lo mira.

- **«Sin cupo» no es «0 % de ocupación»**, y «nadie contó la caja» no es «la
  caja cuadra». Las dos son afirmaciones que el documento no puede hacer, y las
  dos están probadas. El cierre dice explícitamente *Sin contar* y *ninguna caja
  se cerró: nadie contó* — que es peor que un descuadre, porque un descuadre al
  menos se ve.

- **El período de lo contable son MESES, y se dice.** El libro mayor se cierra
  por períodos `AAAA-MM`. Un selector de días encima de eso sería una mentira
  cómoda: pedirías «del 1 al 15» y recibirías septiembre entero con cara de
  quincena. Los estados financieros llevan selector de meses y el papel dice
  qué períodos contables entran. La antigüedad de saldos, al revés, no lleva
  período ninguno: un saldo no ocurre en un día, se arrastra — lleva **fecha de
  corte**, y sin ella la hoja es inservible a la semana siguiente.

- **Lo que queda fuera se imprime.** En el 606/607/608, una factura sin NCF o
  sin RNC no entra en el archivo. Si la hoja solo enseñara lo declarado, el
  contador cuadraría contra un total incompleto sin enterarse. Salen aparte,
  nombradas y con lo que hay que arreglarles.

- **El libro diario entra en el registro** con una idea nueva: `cuadre`. Dos
  totales que TIENEN que coincidir. Antes el debe y el haber salían uno al lado
  del otro y quedaba en que alguien los restara de cabeza; ahora la hoja dice
  «cuadra» o «DESCUADRA en X». La tolerancia es de un centavo, porque gritar por
  el redondeo de doscientas líneas entrena a ignorar el aviso.

- **Mutación:** ocho, las ocho muertas — no restar el fondo, contar `authorized`
  como entrado, que una devolución sume, ocupación cero en vez de «sin cupo»,
  declarar cuadre sin ninguna caja cerrada, quitar el encabezado impreso de una
  pantalla, quitar su botón de imprimir, y escribir un encabezado propio.

### AUD-M25 — La 0068, partida para el editor de Supabase
- **Por qué hace falta una copia:** el editor SQL de Supabase no es psql. Trunca
  los pegados largos, añade por su cuenta un `enable row level security` al ver
  un `create table` —y si eso cae dentro de un bloque `$$`, revienta con
  «unterminated dollar-quoted string»—, y ante una comprobación que no falla
  deja «Success. No rows returned», que no distingue «funcionó» de «no se
  comprobó nada».
- **Cómo queda partida:** parte 1 la tabla, la RLS, las políticas y el trigger
  (sin un solo `$$`, para que la inyección del editor no tenga dónde caer);
  parte 2 la función, con etiqueta `$hook$` en vez de `$$`; parte 3 una
  verificación que **devuelve ocho filas legibles** en vez de un bloque mudo.
  Ninguna pasa de 8 KB.
- **Probado de verdad, no supuesto:** se levanta un Postgres 16 efímero, se
  aplican todas las migraciones SALVO la 0068, se corren las tres partes por
  separado —como las corre una persona— y después las pruebas de
  comportamiento que ya existían (`active_workspace.test.sql`,
  `auth_hook.test.sql`). Pasan las dos.
- **Y la verificación se probó al revés:** con la parte 2 sin aplicar, la fila 7
  dice «FALTA — sigue la versión vieja». Es la fila que importa: las 5, 6 y 8
  siguen diciendo OK porque el enganche de 0063 ya las cumplía, así que sin esa
  fila la tabla daría el visto bueno a una base donde la 0068 no está.
- **La guarda:** una copia es una copia, y el día que alguien toque la migración
  la copia pasa a ser una instrucción equivocada que alguien pegará en su base
  de producción creyendo que es la buena. `editor-sql.test.ts` compara el cuerpo
  de la función carácter a carácter (salvo la etiqueta del dólar), y además
  rechaza órdenes de psql, tablas temporales, archivos de más de 8 KB y mezclar
  un `create table` con un bloque `$$`.
- **Mutación:** tres, las tres muertas — cambiar la copia sin tocar la
  migración, juntar el `create table` con el bloque de la función, y volver la
  verificación muda.

### AUD-M26 — El cambio de empresa se daba por bueno sin comprobar nada
- **Cómo apareció:** revisando de punta a punta el camino del selector después
  de aplicar la 0068 en producción. La base estaba bien; el cliente no.
- **EL FALLO:** `supabase.auth.refreshSession()` **no lanza** cuando falla:
  devuelve `{ error }`. El código lo envolvía en un `try/catch` y recargaba
  igual. Un refresco fallido —token de refresco rotado, un corte de red— no se
  notaba: la cookie quedaba en la empresa nueva y el JWT en la vieja. Es decir,
  el usuario volvía **al mismísimo fallo que la 0068 vino a cerrar**
  («dashboard organization is outside your tenant», módulos vacíos), y encima
  indistinguible de que la migración no estuviera aplicada.
- **Qué se hace ahora:** se mira el `error`, y además se **comprueba que el
  token nuevo trae de verdad la empresa elegida**, leyendo su `org_id`. La
  comparación es válida porque el enganche emite `coalesce(tenant_org_id, id)` y
  `workspacesOf` lista `tenant_org_id || id`: las dos puntas ya coincidían.
- **Y si no aterriza, se DESHACE el cambio.** Dejar la cookie apuntando a una
  empresa que el token no reconoce es peor que no cambiar: la pantalla queda
  rota sin que el usuario pueda entender por qué. Volver a la empresa de siempre
  es un estado coherente, y el mensaje dice qué hacer.
- **Efecto secundario útil:** esa comprobación también caza dos cosas que no son
  culpa del código —que el enganche no esté activado en el proyecto de Supabase,
  y que la 0068 no esté aplicada— y las convierte en un mensaje claro en vez de
  en una pantalla vacía.
- **La lectura del token no verifica firma y no pretende hacerlo:** de eso se
  encarga Supabase. Es una comprobación de COHERENCIA, y devuelve `null` ante
  cualquier token raro en vez de lanzar, porque quien llama solo está decidiendo
  si enseñar un aviso.
- **Mutación:** cinco, las cinco muertas — volver al `try/catch` que se traga el
  error, no deshacer el cambio, dar por bueno un token ilegible, no comparar la
  empresa, y decodificar con `atob` sin reconstruir el UTF-8 (que parte los
  acentos).

### AUD-M27 — CI-001: el E2E dejó de correr contra la base de verdad — CERRADA
- **Qué pasaba:** el paso de E2E recibía la URL y la **llave de servicio del
  proyecto de producción**. Cada pull request creaba y mantenía la empresa
  `e2e-tenant` en la base real y reescribía la contraseña de la cuenta de
  pruebas. Ya causó un incidente (AUD-M16): una cuenta que una persona usaba
  dejó de dejarle entrar, en silencio, porque alguien abrió un PR.
- **Por qué no bastaba con acotarlo:** mientras el CI tenga una llave de
  servicio sobre la operación de verdad, cualquier fallo —un filtro mal escrito,
  una prueba nueva que limpia más de la cuenta— escribe en los datos del
  negocio, y de ahí no se vuelve con un `git revert`. La única forma de que no
  pueda pasar es que el CI no tenga con qué.
- **La decisión: pila local efímera, no un segundo proyecto.** Cada corrida
  levanta su propio Supabase (`supabase/config.toml`), aplica las migraciones
  desde cero y lo destruye. Mejor que un segundo proyecto en la nube: no hay
  secretos que custodiar, no hay nada que mantener ni pagar, y **el E2E
  comprueba ahora que las migraciones levantan un sistema utilizable desde
  cero**, que no lo comprobaba nadie.
- **Resultado medible:** `.github/workflows/ci.yml` ya no contiene **ni una**
  referencia a `secrets.*`.

- **LA TRAMPA QUE CASI SE CUELA, Y QUE NO SE VE MIRANDO EL FICHERO.** El paso de
  build iba ANTES, con la URL de producción. Las variables `NEXT_PUBLIC_*` no se
  leen en tiempo de ejecución: Next las **incrusta en el paquete del navegador
  al compilar**. Compilado así, el navegador del E2E habría iniciado sesión
  contra producción por mucho que el servidor tuviera la pila local en su
  entorno — el aislamiento entero no habría servido de nada, y el E2E habría
  pasado en verde escribiendo en la base real. El build se movió después del
  arranque de la pila, y hay una guarda que compara el ORDEN de los pasos.
- **Segundo detalle silencioso:** `supabase status -o env` emite `CLAVE="valor"`.
  Volcado tal cual a `$GITHUB_ENV`, las comillas viajan **dentro** del valor y no
  conecta nada. Se quitan al leerlas.

- **Y una segunda cerradura, en el código y no solo en el CI:** el arranque del
  E2E clasifica el destino antes de tocar nada y se niega a escribir en un
  proyecto que no sea desechable. Denegar por defecto: lo que no se reconoce
  como local se trata como la base de alguien, y una URL ilegible tampoco pasa.
  `E2E_ALLOW_REMOTE=true` es la salida deliberada, que tiene que escribir una
  persona. Vive ahí a propósito: un día alguien cambiará el fichero del CI, y
  esto seguirá puesto.
- **La comprobación va ANTES del primer `await`**, por la misma razón que la de
  la cuenta: un arranque que crea la empresa, crea el usuario y *luego* se da
  cuenta de que la base era la de producción, ya escribió en producción.

- **Mutación: siete, las siete muertas** — volver a pasar un secreto al E2E,
  compilar antes de levantar la pila, quitar el apagado incondicional, apagar la
  RLS, apagar el enganche del token, permitir un destino remoto por defecto, y
  mover la comprobación de destino después de las escrituras. **Dos no mordieron
  a la primera** (el enganche apagado casaba con el `enabled = true` de otra
  sección, y no había prueba del ORDEN de la comprobación); las dos guardas se
  reescribieron hasta que mordieron.

- **Lo que NO se ha podido comprobar desde aquí:** este entorno no tiene Docker,
  así que `supabase start` no se ha ejecutado ni una vez. La sintaxis del
  `config.toml` sí está validada con la propia CLI —de hecho rechazó dos cosas:
  `major_version = 16` y la sección `[inbucket]`, ya deprecada—, y el YAML del CI
  se parsea en las pruebas. Pero la **primera corrida de verdad es la primera
  ejecución del CI**, y conviene mirarla.

### AUD-M28 — Limpiar la empresa `e2e-tenant` que el CI dejó en producción
- **De dónde sale:** cerrada CI-001, el CI ya no toca la base real, pero la
  empresa que creó durante meses sigue ahí. Se le da al usuario un guion para
  el editor SQL, en tres partes.
- **LO QUE SE DESCUBRIÓ AL PROBARLO, Y QUE CAMBIÓ EL GUION ENTERO.** La primera
  suposición era que las 101 claves ajenas en `RESTRICT` bloquearían un borrado
  peligroso. **Falso.** Probándolo contra un Postgres de verdad, el `delete`
  directo funcionó: hay **15 tablas en CASCADE** —`api_key`,
  `organization_relationships`, `membego_*`, `allotment`, `commission_rule`,
  `price_rule`…— que desaparecen sin avisar, y `audit_log` va en **SET NULL**,
  así que su rastro no se borra pero queda huérfano.
- Por eso el inventario dejó de ser un paso opcional: es el único sitio donde se
  ve qué se va a llevar por delante un borrado que Postgres NO va a frenar.
- **Cuatro cerrojos, los cuatro probados:** el `slug`, la marca
  `metadata->>'purpose' = 'e2e'` que le puso el arranque del E2E, unos
  `not exists` sobre las tablas en cascada que sí importan, y las 101 en
  `RESTRICT` que bloquean si hubiera datos de negocio.
- **Probado contra Postgres 16 real, con producción simulada** —la empresa del
  E2E y una empresa de verdad al lado—: la del E2E se borra, la real queda
  intacta, las membresías no quedan huérfanas. Y los tres casos en que NO debe
  borrar: sin la marca `purpose` (0 filas), con una llave de API (0 filas), y
  con un cliente dentro (Postgres lo bloquea con el error de clave ajena).
- **La guarda de `supabase/editor/` se afinó:** ahora distingue las COPIAS de
  una migración —que deben decir lo mismo que ella— de los scripts de
  MANTENIMIENTO, que no copian nada. Y la regla de la verificación pasó de
  exigir la palabra «FALTA» a exigir que sepa decir que algo va mal con la
  palabra que corresponda: una empresa que debía irse dice «SIGUE AHÍ».
- **Mutación:** tres, las tres muertas — una verificación que solo sabe decir
  OK, el borrado sin el cerrojo de `purpose` (y entonces **sí** borra una
  empresa que no es la del E2E), y un script con un nombre que no dice qué hace.

### AUD-M29 — «0 plazas» en TODOS los canales de venta, y una tipografía que cansa
- **Cómo apareció:** una captura del punto de venta. Todas las tarjetas del
  catálogo decían «0 plazas» en rojo y, al añadir una excursión, saltaba «Solo
  quedan 0 plazas para 1 pasajeros» — con las salidas completamente vacías.
- **La causa:** `departure.available_pax` es una CACHÉ que recalcula
  `availability.ts`. El sembrador SQL de la ola 16 inserta las salidas sin
  rellenarla, y el código hacía `available_pax ?? 0`, que convierte **«no lo
  sé» en «agotado»**. Es el mismo error que el cierre del día evita al no decir
  «0 % de ocupación» cuando no hay cupo: un dato que falta y un dato que vale
  cero son cosas distintas.
- **EL ALCANCE ERA MUCHO MAYOR DE LO QUE SE VEÍA.** La guarda encontró **13
  sitios más** con el mismo `?? 0`, y tres de ellos no son cosméticos:
  · `octo.ts` — le respondía **SOLD_OUT a las OTAs**. La venta se pierde en el
    canal de más volumen y nadie se entera.
  · `portal/catalogo` y `public-booking-service` — el catálogo público y la
    reserva directa enseñaban todo agotado al cliente final.
  El fallo se veía en el POS, pero estaba costando ventas en todos los canales.
- **La solución:** `src/lib/plazas.ts`, que usa la caché si está y la calcula
  si no, y devuelve `null` solo cuando no hay nada con que responder. La
  interfaz distingue ahora «Cupo sin calcular» de «0 plazas», y OCTO devuelve
  `AVAILABLE`/`null` en vez de agotado.
- **Y el sembrador arreglado**, que es donde nació: ahora rellena
  `available_pax`. Probado contra Postgres real: las 60 salidas quedan con cupo.
- **Otros defectos del punto de venta, de la misma captura:**
  · Los desplegables se montaban unos encima de otros. `SelectTrigger` traía
    `w-fit` + `whitespace-nowrap`: crecía hasta caber su texto y, dentro de una
    rejilla —donde los hijos tienen `min-width: auto`—, desbordaba sobre el
    vecino. Arreglado en el componente, no tarjeta por tarjeta.
  · «1 pasajeros en 1 excursion». La concordancia y el acento, en la pantalla
    donde se cobra, restan más confianza de lo que parece.

- **La tipografía: de cuatro familias a una.** Había Fraunces (serif de
  titulares), Manrope, Space Grotesk entera y una Space Grotesk recortada a las
  cifras. El serif cargaba la vista en pantallas que se miran ocho horas al
  día. Ahora la jerarquía la hacen el tamaño y el peso. Las cifras se alinean
  con `font-variant-numeric: tabular-nums` —una propiedad CSS en vez de una
  descarga—, que es lo que de verdad justificaba la fuente aparte. La
  monoespaciada se queda: los códigos de reserva y los NCF se leen en columna.
  Los tres tokens (`--font-sans`, `--font-display`, `--font-num`) apuntan al
  mismo sitio, así que los ~250 usos de `font-display` y `tf-num` siguen
  funcionando sin tocar ninguno.
- **Mutación:** cinco, las cinco muertas — devolver el serif a los titulares,
  quitarle las cifras tabulares a `.tf-num`, volver a importar una familia
  decorativa, que OCTO vuelva a decir agotado, y que un hueco vuelva a contar
  como cero.

### AUD-M30 — La facturación estaba montada entera y sin enchufar
- **Qué pasaba:** «el sistema no da facturas». Y era literal: `invoice-service.ts`
  sabía emitir con su NCF, su ITBIS y su secuencia; `/api/invoices/:id/pdf`
  sacaba el comprobante; `ncfTypeFor` ya elegía B01 con RNC y B02 sin él. Pero
  **nadie llamaba a nada de eso**: se cobraba y no salía factura. La máquina
  fiscal completa, sin un solo cable conectado.
- **Lo que se añade:** la emisión automática al quedar SALDADA la venta, con el
  tipo de NCF decidido por el cliente y no por el cajero.

- **POR QUÉ AL SALDARSE Y NO AL PRIMER ABONO.** Un NCF consume secuencia, se
  declara en el 607, y deshacerlo exige una nota de crédito que consume OTRO.
  Facturar en el primer abono de una venta que luego se cancela deja dos
  comprobantes quemados y un 607 que hay que explicar. Esperar a que quede
  saldada no pierde ninguna factura —quien paga completo la recibe en el acto—
  y evita el desperdicio. La regla vive en un módulo puro y probado, no dentro
  de la ruta: el día que el negocio decida otra cosa, se cambia en un sitio con
  pruebas que dicen qué se está cambiando.

- **Y NUNCA TUMBA UN COBRO.** Si la secuencia está agotada o falta el perfil
  fiscal, el dinero ENTRÓ igual: tumbar el cobro por no poder emitir el
  comprobante convierte un problema administrativo en un **descuadre de caja**
  —el cliente pagó, el cajero tiene el efectivo y el sistema dice que no pasó
  nada—. Va en mejor esfuerzo, como la contabilidad de esa misma ruta, y el
  fallo se registra (`invoice_issue_failed`) y se devuelve en la respuesta.
  Hay una guarda que lee la ruta y comprueba que el `catch` no relanza.

- **El NCF se enseña en el acto**, con el botón de imprimir en el mismo aviso.
  Es el momento en que el cliente está delante; obligar al cajero a buscar la
  factura en otra pantalla significa, en la práctica, que no se entrega.

- **El importe en letras** (`monto-en-letras.ts`). Una cifra en números se
  altera cambiando un dígito; en letras hay que reescribir la línea entera —por
  eso lo llevan los cheques y por eso se espera en una factura dominicana—.
  Escrito con sus trampas probadas: «dieciséis» y no «diez y seis», «cien» pero
  «ciento uno», «quinientos/setecientos/novecientos», «mil» y nunca «un mil»
  pero sí «veintiún mil», «un millón» en singular. **La prueba cazó un fallo mío
  real**: el reemplazo de la apócope corría en el orden equivocado y dejaba
  «VEINTIUN» sin tilde.

- **Dos guardas ajenas saltaron y las dos tenían razón:** la bitácora exigía
  traducir la acción nueva (`invoice_issue_failed` habría salido en el papel con
  su nombre técnico), y la del camino del dinero preguntaba si mi lista de
  estados era de ORDEN o de RESERVA. Lo segundo destapó que esa guarda
  comprobaba el IDIOMA del identificador (`/order/i`) en vez de lo que dice
  comprobar; ahora acepta los dos, y el módulo dice explícitamente sobre qué
  entidad decide.
- **Mutación:** cinco, las cinco muertas — que el `catch` relance, facturar en
  el primer abono, facturar una devolución, truncar los centavos por separado
  («CERO CON 100/100»), y devolver el fallo de la apócope.

### AUD-M31 — Los paquetes se podían crear pero no vender (y se ofrecían igual)
- **La revisión:** el modelo de paquetes es correcto y está bien pensado. Una
  venta de combo son N+1 reservas: una CABECERA con el precio pactado y sin
  salida —el paquete no sale ningún día, salen sus actividades— y N COMPONENTES
  a importe cero, cada uno con **su salida real, su hora, su cupo y su
  check-in**. `createOrderWithBookings` ya sabía expandirlo entero.
- **EL FALLO: se ofrecía algo que no se podía cobrar.** Ni el catálogo del
  punto de venta ni el del portal filtraban por `is_bundle`, así que un paquete
  salía como una tarjeta normal. El cajero lo añadía y el fallo aparecía al
  CONFIRMAR —«Falta el día en que empieza el paquete»—, con el cliente delante.
  Ofrecer algo que no se puede cobrar es peor que no ofrecerlo: lo segundo se
  descubre al configurar, lo primero en el mostrador.

- **Ahora se venden de verdad, por su propio camino.** Los paquetes viajan en
  una lista aparte del catálogo, porque no se venden igual: una tarjeta que
  enseña «próxima salida» y «plazas» no dice nada útil de algo que no tiene
  salida propia. Al abrirlo se pide el día de inicio, el servidor arma el
  itinerario con salidas REALES y se enseña actividad por actividad —día, hora
  y plazas— antes de comprometer al cliente.
- **Y no deja añadir un paquete bloqueado.** Si una actividad no tiene salida
  servible, el botón queda desactivado y se dice qué falta y por qué. Un
  paquete a medias no es «dos de tres»: es un precio cerrado por algo que no se
  va a entregar entero.
- **En el carrito no se enseñan desplegables de salida ni modalidad**: un
  paquete no los elige, los eligen sus actividades. Se enseña el itinerario,
  que es lo que el cajero repasa con el cliente.

- **CORRECCIÓN A LA REVISIÓN INICIAL.** Dije que «lo que decide qué salidas
  encajan no tiene red». Falso: el dominio puro (`bundles.ts` — solapes,
  itinerario, auto-resolución) tiene 33 pruebas. Lo que no tenía ninguna era
  `bundle-service.ts`, la capa que lee la base. Ahora tiene 15, y cubren lo que
  no se ve leyendo: que un producto normal no pueda tratarse como paquete (si
  no, se cobraría una cabecera con CERO componentes: una venta que no reserva
  ninguna plaza ni aparece en ningún manifiesto), que una salida cancelada o
  cerrada no se cuele en un itinerario, y que un aforo cero se lea como «sin
  declarar» y no como «agotado» —el mismo error que costó el «0 plazas»—.
- **Mutación:** cinco, las cinco muertas — devolver el paquete al catálogo del
  POS, dejar de mandar el día de inicio, permitir añadir un itinerario
  bloqueado, tratar un producto normal como paquete, y que el aforo cero
  cuente como agotado.

### AUD-M32 — El vendedor veía las ventas de TODOS
- **Lo que se reportó, literal:** «el vendedor ve las ventas de todos».
- **Era cierto, y por cuatro puertas distintas.** El rol `seller` es el rango
  más bajo del ERP interno y aun así leía la empresa entera. La RLS aísla por
  `organization_id` —empresas, no personas—, el ámbito del socio B2B solo mira
  al rol `partner` y el de sucursal solo mira la sucursal. Ninguno preguntaba
  quién vendió. Las cuatro puertas:
  1. `/api/erp/order|quote|lead|…` — el listado genérico.
  2. `/api/export/:recurso` — el MISMO filtro, así que exportaba lo mismo a
     Excel. Una cartera completa en un archivo.
  3. `/api/erp/:recurso/:id` — el detalle no pasa por el filtro del listado:
     `tenantFindOne` solo comprueba la empresa. Bastaba el identificador de la
     venta de un compañero, que sale impreso en cualquier voucher.
  4. `/api/orders` y `/api/quotes` — arman su propio filtro y no comparten
     `buildListFilter`. Son, además, las que leen las pantallas de verdad.
  No hacía falta tocar la interfaz para verlo: bastaba con la dirección. El
  menú nunca ha sido la barrera.
- **Y además se podía ESCRIBIR sobre lo ajeno.** `order` se edita con rango de
  vendedor y `seller` es uno de sus campos editables: un vendedor podía coger
  la venta de un compañero y ponerse a sí mismo —reatribuyéndose la comisión—
  sin haberla podido ni ver.
- **Fallaba también al revés, y eso explica el panel vacío.** `/api/dashboard`
  ya acotaba por vendedor buscando `seller.user = <usuario>`… pero NADA en el
  sistema escribía ese vínculo: el campo existía en la base desde 0005 y no
  había pantalla que lo pusiera. Así que el panel de todo vendedor consultaba
  con un identificador nulo y salía vacío, mientras el listado de al lado le
  enseñaba las ventas de la empresa entera.

- **La regla: «lo mío, o lo de nadie»** (`src/lib/seller-scope.ts`). Un vendedor
  ve lo suyo y lo que no está atribuido a ningún vendedor; nunca lo de otro. Las
  filas sin vendedor siguen visibles a propósito: el punto de venta NO sella al
  vendedor —sale del desplegable, que es opcional—, así que esconderlas le
  negaría al vendedor su propia venta un segundo después de hacerla, y borraría
  del mapa el histórico, el portal público y lo que carga un administrador.
- **Sin ficha vinculada NO se abre el ámbito.** No saber quién es el vendedor
  acota a «lo de nadie», nunca a «todo»: si abriera, bastaría con no vincular la
  ficha para conservar el agujero. Misma postura que ya tenía el panel, que con
  vendedor desconocido consulta con un identificador nulo.
- **Y se puede vincular la cuenta.** La ficha del vendedor gana «Cuenta de
  acceso» (selector sobre `/api/team`) y el listado enseña «Sin vincular» en
  ámbar, porque es lo primero que hay que arreglar de una ficha. El vínculo se
  resuelve desde la base en CADA petición y no en el token: desvincular o
  desactivar una ficha tiene efecto en la siguiente petición, no cuando la
  sesión se renueve. `0069` lo hace único por empresa — con dos fichas
  apuntando a la misma cuenta, qué ventas vería esa persona dependería de cuál
  devolviera la base primero, y un ámbito que cambia según el orden de las filas
  no es un ámbito.
- **Se arregló de paso un borrado silencioso del formulario genérico.** El
  formulario abre con la fila del LISTADO, que solo expande las relaciones que
  su recurso declara; las demás llegan como `<campo>_id`. El campo salía vacío
  y al guardar viajaba `null`: editarle el teléfono a un vendedor le habría
  desvinculado la cuenta sin decir nada. Ahora lee también la referencia cruda
  y nunca manda `null` por un campo que la fila no traía.

- **Lo que NO se acota, y por qué.** `customer` (el libro de clientes es
  operativo: acotarlo haría que el vendedor B no encontrara al cliente de A y
  lo diera de alta otra vez — un directorio duplicado es peor que la exposición
  que evitaría), `waitlist_entry` (quien atiende cuando se libera una plaza
  tiene que poder llamar al siguiente aunque lo apuntara quien hoy libra), el
  directorio de vendedores (lo sensible ahí no son las filas sino dos columnas
  —`commission_pct` y `monthly_goal`—, y eso se arregla recortando campos, no
  filas: **queda pendiente**) y `payment_schedule` (no tiene columna de
  vendedor; el informe de cobros sí se acota, sobre la orden ya expandida).
- **Residuo consciente:** una venta que nadie atribuyó la siguen viendo todos
  los vendedores. Es dato de la empresa, no de un compañero. Cerrarlo de verdad
  exige sellar al vendedor al vender, y eso cambia a quién se le paga la
  comisión: es una decisión de negocio, no de este arreglo.
- **Pruebas:** 21 nuevas en `seller-scope.test.ts` (qué se acota y qué no, a
  quién, el filtro, la fila concreta, y que los ámbitos de sucursal y vendedor
  se acumulen sin pisarse) + 4 contratos que leen las rutas.
- **Mutación:** catorce, las catorce muertas — entre ellas abrir el ámbito
  cuando no hay ficha, quitar la guarda del detalle en lectura y en escritura,
  fusionar los dos ámbitos en un objeto (donde el segundo `_or` pisa al
  primero) y —la que primero NO mordió— calcular el ámbito en `/api/orders` y
  tirarlo a la basura una línea después, con el nombre de la función a la vista
  de quien revisa. Esa guarda se reescribió para exigir que el resultado se
  APLIQUE, no solo que la función se llame.

### Fase 1.1 del plan del ecosistema — la venta es de quien la hace
- **Lo que faltaba.** El ámbito del vendedor (AUD-M32) nació de LECTURA. Con eso
  quedaba cerrada la mitad: el desplegable «Vendedor» del punto de venta
  listaba al equipo entero y quien vendía podía **elegir a cualquiera**. Podía
  regalarle su venta a un compañero o quedarse la de otro, y detrás va la
  comisión. Acotar lo que se LEE mientras la atribución se elige a mano no
  acota nada.
- **Y tres puertas de escritura más.** `/api/bookings/:id/cancel` y
  `/reschedule` pedían rango de vendedor y **no miraban de quién era la
  reserva** —cancelar anula la comisión de quien vendió, así que un vendedor le
  borraba el mes a un compañero con una llamada—. Y todas las rutas de
  `/api/quotes/:id/*` (enviar, revisar, decidir, convertir, editar líneas y
  alternativas) compartían un cargador que tampoco lo miraba.

- **El sello vive en el servicio, no en la ruta.** `createOrderWithBookings` es
  el único camino que crea reservas —lo usan el punto de venta, la conversión
  de cotización, la web, el revendedor, la lista de espera y la demo—. Puesto
  en la ruta, la siguiente que creara órdenes habría nacido sin sellar.
- **EL ERROR QUE CASI COMETO, Y QUE VALE POR TODO LO DEMÁS.** Sellar por
  `ctx.role === "seller"` habría sido correcto en apariencia y catastrófico en
  la práctica: `public-booking-service.ts` y `octo-service.ts` **fabrican un
  contexto con rol `seller` y sin usuario**, a propósito y documentado en su
  propio código. El sello por rol habría puesto `seller_id` en `null` en TODA
  venta web y apagado el motor de atribución entero —la cookie del visitante es
  lo único que encuentra al conserje que compartió el enlace— sin un solo error
  que lo delatara. La pregunta la responde `ventaSelladaPorVendedor`, que exige
  persona (usuario), y hay una prueba que fija los dos motores sin sesión.
- **El sello PISA lo que venga en el cuerpo**, al revés que el de sucursal. Un
  gerente creando algo para otra sucursal está en su derecho; un vendedor
  eligiendo a otro vendedor no es una decisión legítima. Y con la ficha sin
  vincular sella a nadie sin dejar pasar el valor del cuerpo: si lo dejara
  pasar, bastaría con no vincular la ficha para atribuirse lo que sea.
- **`field-write-role.ts`: permiso por CAMPO.** `writeRole` es del recurso
  entero, y `order` lo tiene en `seller` —tiene que tenerlo— con `seller` y
  `partner` entre sus campos editables: el mismo rango que permite anotar una
  nota permitía cambiar a quién se le paga. `seller.user` sube a `admin`: es la
  única columna que traslada ventas, comisiones y liquidación de una persona a
  otra con un cambio. Subir el recurso entero habría roto el alta de vendedores
  por gerencia.
- **Se prohíbe CAMBIAR, no enviar.** El formulario genérico manda todos sus
  campos en cada guardado, también los que nadie tocó: rechazar por «viene el
  campo» habría convertido editarle una nota a una venta en un 403
  incomprensible. Se compara contra la fila actual y por `refId`, porque una
  referencia viaja unas veces como uuid y otras como objeto expandido.
- **`seller-identity.ts`**: la cuenta que se vincula tiene que ser de esta
  empresa y no estar ya en otra ficha. El índice único de 0069 ya lo impide en
  la base, pero ahí el fallo sale como una restricción que nadie entiende; aquí
  sale diciendo con qué ficha choca. Un fallo de lectura NO se convierte en
  permiso: al revés, un corte de red serviría para colar una llave.
- **El cargador de cotizaciones pide el contexto OBLIGATORIO.** Opcional, la
  siguiente ruta se olvidaría de pasarlo y no lo notaría nadie; obligatorio, el
  compilador obliga a decidir. `null` significa «uso interno, sin persona
  detrás» y solo lo usa el recálculo, que corre después de una escritura ya
  autorizada.
- **Pruebas:** 10 nuevas en `seller-scope.test.ts` (sello, quién lo activa, fila
  ajena con referencia expandida), 11 en `field-write-role.test.ts` y 3
  contratos que leen las rutas. Tres guardas ajenas saltaron por el camino y se
  reescribieron para enunciar la regla nueva en vez de la línea vieja.
- **Mutación:** dieciséis, quince muertas a la primera. La que no mordió fue,
  otra vez, **la misma familia**: quitar el `throw` dejando la llamada a
  `protectedFieldChanges` en pie —el veredicto calculado y tirado a la basura
  una línea después, con el nombre de la función a la vista de quien revisa—.
  Es el segundo caso idéntico en dos olas; la guarda ahora exige que el
  resultado se ACTÚE, no solo que la función se llame.

### Fase 1.2 y 1.3 — el inventario de rutas, y recortar columnas sin negar tablas
- **El inventario, convertido en guarda.** `/api/orders` y `/api/quotes` se
  cerraron a mano porque no pasan por `buildListFilter`. «A mano» no se
  sostiene: la siguiente ruta que consulte una tabla con dimensión de vendedor
  nacería sin ámbito y nadie lo notaría, porque **un filtro que falta no da
  error — devuelve la empresa entera**. `seller-scope-rutas.test.ts` recorre
  TODAS las rutas de la API y exige que cada una que toque esas tablas esté en
  uno de tres casos: pide rango por encima de vendedor, aplica el ámbito, o
  está en una lista de excepciones **con su motivo escrito**.
- **Resultado del barrido: una sola ruta abierta de verdad.** `/api/payments`,
  y se deja abierta a propósito —cobrar es operativo: el cliente llega al
  mostrador a pagar una venta que pudo hacer cualquiera del equipo, y exigir que
  sea del vendedor que atiende lo dejaría sin poder pagar—. Residuo consciente y
  escrito: la respuesta devuelve la orden actualizada. Las demás (check-in,
  cierre de salida, comisiones, liquidaciones, rentabilidad, QR) piden rango por
  encima de vendedor; `/api/portal/summary` está acotada por socio y sin socio
  responde 403.
- **La excepción caduca sola**: hay una prueba que comprueba que cada ruta
  excusada siga existiendo y siga tocando esas tablas. Una excepción que
  sobrevive a la ruta que excusaba es una puerta abierta con permiso escrito.

- **`field-projection.ts`: se PROYECTA, no se bloquea.** `READ_ROLE` decide
  sobre la tabla entera, y con `product` eso no vale —un vendedor sin catálogo
  no puede vender y el punto de venta se queda sin nada que enseñar—. Lo que
  sobra no es la tabla: son columnas. Fuera `base_cost` del producto, `cost` de
  la modalidad, y `commission_pct`, `monthly_goal` y `max_discount_pct` de los
  compañeros —la ficha PROPIA se exceptúa, porque el apartado del vendedor
  existe justamente para enseñarle su comisión—.
- **El recorte baja por las expansiones.** Recortar solo la fila de arriba
  habría sido teatro: una reserva expande su producto con el coste dentro y una
  orden expande su vendedor con la comisión dentro. Se resuelve a qué recurso
  apunta cada relación con el mismo mapa que usa la expansión, así que una
  expansión nueva hereda el recorte en vez de volver a arrastrar el coste.
- **Se BORRA la clave, no se pone a cero.** Un coste en cero no es «no puedes
  verlo»: es «esta excursión no cuesta nada», y el margen que se dibuja a partir
  de ahí sale del 100 %. Tres pantallas pasaron de `?? 0` a «—».
- **Y en los TRES sitios**: listado, detalle y exportación. El exportador no
  sabe recortar por su cuenta; un archivo con el coste de cada excursión
  mientras la pantalla no lo enseña es el fallo que nadie revisa.
- **`payment_schedule` sube a `manager`.** Estaba en `seller` y esa tabla no
  tiene columna de vendedor —el suyo está en la orden, tabla unida, que la capa
  de consulta no sabe filtrar—: cualquier vendedor leía el calendario de cobros
  de toda la empresa.
- **UN FALLO MÍO, CAZADO POR MI PROPIA GUARDA.** Declaré
  `product_modality.base_cost`. Esa columna se llama `cost`: el recorte no
  habría recortado nada, sin un solo error. Lo cazó la prueba que valida cada
  campo declarado contra el recurso real —la misma idea que ya protege al
  ámbito por fila—, y por eso está escrita antes que el código.
- **Mutación:** doce en las dos olas, las doce muertas — entre ellas poner a
  cero en vez de borrar, dejar de bajar por las expansiones, tratar toda ficha
  como «la propia», que la exportación deje de recortar mientras la pantalla sí,
  y volver a escribir mal el campo de la modalidad.

### Fase 1.4 — la identidad del vendedor deja de depender de que alguien se acuerde
- **El paso que se olvida siempre.** Dar de alta a un vendedor eran tres pasos
  en dos pantallas: crear la ficha en Vendedores, invitar la cuenta en
  Configuración → Equipo, y volver a la ficha a vincularla. El tercero es el
  que decide si esa persona ve sus ventas o no ve ninguna, **no falla si se
  olvida y no avisa**: el vendedor entra y se encuentra un sistema vacío. Ahora
  `POST /api/sellers/invite` hace los tres de una vez, y la fila de quien no
  tiene cuenta ofrece el botón justo donde se nota que falta.
- **Pide rango de administración, y no es un descuido.** La ficha la crea
  gerencia, pero esto hace dos cosas que gerencia no puede hacer por separado:
  crear una cuenta de acceso y escribir `seller.user_id`, que
  `field-write-role.ts` reserva a administración.
- **`team-invite.ts`: lo que las dos altas hacen igual, en un solo sitio.** Lo
  escribía entera `/api/team/invite`. Copiado, la divergencia es cuestión de
  tiempo y se nota en lo peor —el tope del plan comprobado en un camino y no en
  el otro, o una invitación que no queda en la bitácora—. El orden también es
  la política: el tope del plan ANTES de tocar Supabase Auth (al revés quedaría
  una cuenta creada sin membresía, invisible en el equipo e imposible de volver
  a invitar porque el correo ya existiría) y la membresía nace **pendiente**,
  porque una invitación no es un acceso.
- **`ctx.sellerId` para todo el personal interno, no solo para el rango bajo.**
  En una operadora pequeña el gerente y el dueño también venden: sin este dato
  su apartado propio no existiría, o peor, existiría vacío. No les acota nada
  —`sellerScopeApplies` solo mira al rango más bajo—, les da su vista. Se salta
  para el socio y para el superadministrador **incluso mientras impersona**:
  quien entra a mirar una empresa ajena no es vendedor de ella, así que no
  aterriza en el apartado de nadie ni se le acota lo que ve, que es justo para
  lo que sirve impersonar (y queda auditado).
- **`/api/me` devuelve `sellerId`.** El shell decidía a dónde llevar a cada
  quien mirando solo el rol, y con eso no se puede: son TRES estados —gerente
  que vende, vendedor con ficha, vendedor sin ficha— y solo este dato los
  distingue. Al tercero hay que decírselo, no mandarlo a una pantalla en blanco.
- **El backfill se PROPONE, no se aplica.** `supabase/editor/vinculo_vendedores_*`
  empareja por correo y devuelve filas para revisar una por una. El correo no es
  identidad: se teclea en dos sitios, se reutiliza y cambia. Un emparejamiento
  automático que acierte el 95 % significa que **a una persona de cada veinte le
  aparecen las ventas —y la comisión— de otra**, y eso no se descubre leyendo un
  registro: se descubre el día de pago. No llevan número de migración porque no
  son copia de ninguna; una guarda ajena lo exigía y tenía razón.
- **Mutación:** ocho, seis muertas a la primera. Las dos que no:
  - el tope del plan comprobado DESPUÉS de crear la cuenta — y la causa era, por
    **cuarta vez en esta rama**, que `indexOf` encontraba el nombre de la
    función en su línea de `import`. Ahora hay un helper (`cuerpoDe`) que quita
    la cabecera antes de comparar posiciones, y está escrito por qué;
  - la membresía invitada naciendo activa: esa propiedad **nunca había tenido
    guarda**, ni antes de extraer el servicio. Ahora la tiene.

### Fase 1.5 — el apartado del vendedor, y el menú deja de ser la barrera
- **Dónde aterriza cada quien.** Todo el mundo caía en el panel de la empresa.
  Para quien vende a comisión eso son ocupación de salidas, canales y alertas de
  caja —nada de lo cual es suyo— con sus tres cifras escondidas en medio. Y si
  además su cuenta no estaba vinculada, el panel salía **vacío sin decir por
  qué**: parece una avería y es una configuración a medio hacer. Ahora el rango
  más bajo del ERP aterriza en `/dashboard/mi-espacio`; de `cashier` hacia
  arriba no se desvía a nadie, y quien además vende llega por el menú.
- **TRES situaciones, no dos.** Gerente que vende, vendedor con ficha, y cuenta
  sin ficha. La tercera no se distinguía: las mismas pantallas, todas vacías,
  sin forma de saber si es que no había vendido nada o es que el sistema no
  sabía quién era. Ahora hay una pantalla que lo explica **y dice quién lo
  arregla**, porque quien la lee no puede hacerlo solo: hace falta rango de
  administración.
- **Las cifras salen de `/api/dashboard`, que YA fuerza el ámbito en servidor.**
  Montar una ruta nueva habría significado un segundo sitio donde equivocarse
  sobre qué es «lo suyo», y los dos acabarían discrepando. La lista tampoco
  manda un filtro por vendedor desde el navegador: un filtro que decide qué ve
  cada quien y viaja en la dirección es un filtro que se puede quitar.
- **`page-guard.tsx`: guardas de rol en el SERVIDOR.** De 129 pantallas, 5
  miraban el rol, y ninguna de ellas era de las que enseñan dinero. El menú
  esconde `/dashboard/comisiones`; la URL, no. La API sí se defiende, así que lo
  que se veía era una pantalla rota llena de errores en vez de un «esto no es
  para ti» — pero apoyarse en eso es apoyarse en que ninguna de las rutas que
  esa pantalla llama tenga un hueco.
- **Va en un `layout.tsx` y no en cada página.** Las pantallas son de cliente y
  no pueden leer la sesión; convertir cada una en pareja servidor+cliente serían
  dos ficheros por pantalla y un sitio más donde olvidarse. Un layout de dos
  líneas corre en el servidor, no toca la página y **cubre sus subpáginas**:
  `vendedores` protege metas, bonos, tipos y atribución de una vez, y una
  pantalla nueva dentro de una carpeta protegida nace protegida.
- **Se explica, no se redirige.** Un desvío silencioso hace pensar que el enlace
  está roto y que hay que volver a intentarlo.
- **Ocho carpetas protegidas**: vendedores, comisiones, liquidaciones, partners,
  personal, rentabilidad, deudas y catálogo/costos.
- **Guardas ajenas que saltaron**: siete del panel ejecutivo (el panel se movió
  a `_components/panel-empresa.tsx` para que `page.tsx` pudiera ser de servidor
  y decidir el aterrizaje) y la que exige que toda pantalla con registros diga
  cómo se crean —las dos de Mi espacio quedan anotadas como derivadas, con su
  motivo: una venta se hace en el punto de venta, y un botón de «nuevo» en el
  apartado del vendedor le dejaría **crearse su propia comisión**.
- **Mutación:** siete, las siete muertas.

### Fase 1.6 — probar la RUTA y la SESIÓN, no solo la regla
- **Lo que faltaba, dicho con precisión.** Las 31 pruebas de `seller-scope.ts`
  comprueban que la REGLA es correcta. Ninguna comprobaba que la ruta la LLAME
  —que es otra cosa, y ya falló una vez: `/api/orders` arma su propio filtro y
  se quedó fuera del armador compartido—. Y **un filtro que falta no da error:
  devuelve la empresa entera.**
- **13 pruebas contra la RUTA** (`erp-ambito-vendedor.test.ts`). Se falsea solo
  el suelo —`tenantQuery`, `tenantCount`, `tenantFindOne`— y corre de verdad
  todo lo de arriba: la autorización por rango, el armador del filtro, el
  ámbito y el recorte de columnas. Lo que se comprueba es lo único que importa:
  **qué filtro llega a la base y qué sale por la respuesta**. Incluye la
  exportación, donde se verifica que el CSV de un vendedor no trae el coste y
  el de un gerente sí.
- **3 pruebas con un navegador y una sesión REAL**
  (`vendedor-aislamiento.spec.ts`). Es la única de toda la cadena que ejerce el
  vínculo cuenta↔ficha: entra una persona con su contraseña, el enganche de la
  base le mete el rol en el token y `auth-context` resuelve su ficha
  consultando `seller.user_id`. Fallaría si el enganche dejara de inyectar el
  rol o si ese vínculo dejara de consultarse, que es justo lo que ninguna
  prueba con `mock` puede ver. Las tres afirmaciones son «no»: no aterriza en
  el panel de la empresa, no ve la venta de su compañero —ni en pantalla ni
  pidiéndosela a la API—, y no entra a comisiones tecleando la URL.
- **El E2E siembra ahora DOS cuentas.** El aislamiento no se puede probar con
  la de propietario: ve todo por definición. La del vendedor se **deriva** de la
  otra (`algo@x` → `algo+vendedor@x`) para que herede la garantía de ser una
  dirección dedicada.
- **Mutación:** siete contra las pruebas de ruta —las siete muertas, y estas no
  leen código fuente: ejercitan los manejadores— y tres contra el sembrador. La
  que no mordió: quitar la comprobación de «esta cuenta no es de nadie» a la
  cuenta derivada. **Era un agujero real, no un hueco de cobertura**: con el
  alias `+`, esa dirección es real y llega al mismo buzón, así que cualquiera
  puede haberla registrado — y el arranque le habría reescrito la contraseña en
  cada ejecución de CI, en silencio. Es exactamente el fallo que ese fichero
  existe para no repetir. Ahora tiene su prueba.

### Fase 2 — el bolsillo del vendedor
- **La compuerta se evalúa ANTES que el ámbito**, y ese es el error conceptual
  más caro de este dominio: daba igual que `seller-scope.ts` supiera acotar las
  comisiones, `READ_ROLE` las reservaba a gerencia y devolvía 403 antes de que
  el filtro llegara a aplicarse. Por eso el vendedor no veía ni su propia
  comisión.
- **Dos trampas al abrirla, y la segunda no estaba en el plan.** La primera sí:
  eximir «las tablas que el ámbito ya acota» habría incluido `price_rule` y
  `commission_rule`, o sea el tarifario y el esquema de comisiones de toda la
  empresa. La segunda apareció al mirar el esquema: `commission`, `settlement`
  y `payable` llevan `beneficiary_type`, así que **una fila sin `seller_id` no
  es «de nadie», es de un socio o de un proveedor**. La regla «lo mío o lo de
  nadie» —correcta para la venta, donde una orden sin vendedor es de la
  empresa— les habría abierto de paso todas las comisiones de los tour centers
  y todas las facturas de los proveedores. El ámbito tiene ahora dos modos.
- **Y la compuerta pasa a vivir en una función** (`assertCanReadTable`). Estaba
  copiada en el listado, el detalle y la exportación; desde que tiene ramas por
  actor, tres copias divergen, y la que se queda atrás suele ser la exportación.
- **CORRECCIÓN A MI PROPIO PLAN.** Escribí que cada tabla que se abriera
  necesitaría su política de RLS «o la pantalla saldría vacía». Es falso para
  las tablas existentes: la política que instala `enable_tenant_rls` es por
  organización y **no mira el rol**. Abrir las comisiones no necesitó una sola
  línea de SQL. El enunciado solo vale para tablas nuevas.
- **0070 — la comisión sabe de qué día es.** El mercado liquida por fecha de
  TOUR y no de venta; la fecha de salida vive dos tablas más allá y la capa de
  consulta no filtra por columna de tabla unida. Se copia UNA vez al devengar y
  no sigue a la reserva si se reprograma: mover esa fecha movería el período de
  liquidación de un dinero ya devengado, que quizá ya se pagó.
- **El estado de cuenta lo decide la FILA, no el rango.** Abierto a su
  beneficiario, el rango deja de decidir y bastaría con cambiar el identificador
  de la dirección para bajarse la liquidación de un proveedor. Y el documento
  del proveedor **no es el del vendedor con otro nombre**: lleva el coste y las
  retenciones dentro. `assertSettlementBeneficiary` comprueba el TIPO antes que
  el identificador, porque los uuid son de tablas distintas y compararlos entre
  clases es preguntar «¿este uuid aparece en algún sitio de la fila?».
- **Los cuatro avisos van a la PERSONA.** «Te aprobaron la comisión» repartido
  por audiencia de rol se lo manda a todos los vendedores: cada uno recibe lo de
  sus compañeros, ninguno encuentra lo suyo, y todos acaban sabiendo cuánto
  cobran los demás. Sin cuenta vinculada no se avisa a nadie —un aviso personal
  sin persona no puede convertirse en un aviso para todo el mundo— y nunca se
  avisa a quien acaba de hacer la acción.
- **Las metas IGNORAN el parámetro de la consulta.** Es la diferencia entre
  filtrar y acotar: aceptar `?seller=` y comprobar después deja un fallo de
  comparación entre el vendedor y las metas de un compañero.

- **Tres cosas que arreglé de mi propio método**, y las tres del mismo tipo —una
  guarda que parece proteger y no protege—:
  1. Un `Boolean(ctx.sellerId)` que ninguna mutación podía matar, porque
     `beneficiaryOf` ya rechaza una fila sin identificador. Código que finge.
  2. **El mutador daba «NO MUERDE» cuando la sustitución no encontraba su
     texto**: acusaba a la guarda de un fallo inexistente y escondía que no se
     había probado nada. Ahora falla ruidosamente si el fichero no cambia, y
     detecta el resultado por código de salida y no buscando una palabra.
  3. Una guarda que buscaba `userId,` en una VENTANA de caracteres alrededor de
     la llamada: atrapaba cualquier `userId,` que anduviera cerca por otro
     motivo. Ahora mira dentro de la llamada a `notify({`.
- **Y una guarda mía que se disparó con un comentario** en vez de con el código:
  el fichero del estado de cuenta del vendedor EXPLICA por qué no lee
  `booking_cost`, y la comprobación leía el fichero entero.
- **Mutación:** veintiuna a lo largo de la fase, las veintiuna muertas tras
  reescribir cuatro guardas.

### Fase 3 (parte) — el enlace es suyo, y el techo de descuento existe de verdad
- **El embudo y el QR se abren a su dueño.** Todo el motor de atribución estaba
  escrito y funcionando —`/e/[slug]`, cookies, `seller_link`, `funnelReport`— y
  lo único que lo cerraba era una guarda de rango. Un cartel que no se puede
  descargar no se pega en ningún mostrador.
- **Y `assertSellerOwnsRow` NO servía para abrirlo.** Aquel es un ÁMBITO, y un
  ámbito deja pasar a quien no es vendedor —a un gerente no hay nada que
  acotarle—: usarlo aquí habría dejado entrar también a caja y a operaciones,
  que no tienen ficha y para quienes «nada que acotar» significa «lo ven todo».
  Hace falta la pregunta contraria (`assertGerenciaOVendedorDe`): esto era de
  gerencia y se le abre a UNA persona más, la dueña de la fila.
- **El embudo del vendedor ignora `?seller=`**, igual que las metas: aceptarlo y
  comprobar después deja un fallo de comparación entre él y el embudo de un
  compañero, que dice cuánta gente trae.
- **0071 — el slug lo genera el servidor.** `seller_link_slug_key` es único EN
  TODO EL SISTEMA, no por empresa, y aceptarlo del navegador permitía dos cosas:
  **ocupar** los nombres del espacio compartido —incluidos los de otras empresas
  alojadas aquí— y, peor, **imitar** el de un compañero (`MARISOL1` frente a
  `MARIS0L1`) para llevarse sus visitas. El cliente teclea lo que ve en un
  cartel: no comprueba nada. Sale de `writable`, nace en la ruta, y si choca se
  reintenta — el choque es normal cuando el espacio es compartido.
- Más el techo de 25 enlaces activos por vendedor (sin tope, una cuenta fabrica
  miles de slugs del espacio de nombres ajeno), `created_by` —quien lo creó deja
  de coincidir con de quién es— y la creación anotada en la bitácora: un enlace
  reparte atribución, o sea dinero, y el día que aparezcan veinte de la nada la
  pregunta es quién los hizo.

- **EL TECHO DE DESCUENTO, QUE NO EXISTÍA.** `seller.max_discount_pct` está en
  el esquema desde 0005, la pantalla lo pide y se guarda; **no se aplicaba en
  ningún cálculo**. La operadora configuraba un techo, creía haber acotado lo
  que sus vendedores regalan, y el sistema aceptaba un 90 % igual que un 5 %. Es
  de la misma familia que «el formulario pedía la sucursal y la API la tiraba»:
  un campo que promete algo que no ocurre es peor que no ofrecerlo, porque quien
  lo rellena deja de vigilarlo a mano.
- **Sin techo declarado no hay techo, pero un cero declarado sí lo es.** `null`
  es «nadie lo configuró» y no se convierte en cero: si la ausencia valiera
  cero, activar esto le quitaría de golpe la capacidad de descontar a todas las
  empresas que nunca rellenaron el campo —que son todas, porque el campo no
  hacía nada—. Y «esta persona no puede descontar» tiene que poder expresarse.
- **Es una autorización de QUIEN VENDE, no del dueño de la venta.** Un gerente
  registrando una venta ejerce la suya; si fuera la de la ficha atribuida,
  bastaría con atribuirle la venta a alguien sin techo para saltárselo.
- **En los dos sitios**: la creación de la orden, que es donde se cobra, y la
  cotización, porque el punto de venta cotiza mientras el cajero teclea y
  enseñar un total con un 40 % para rechazarlo al confirmar es discutir con el
  cliente delante por un precio que el sistema ya le había enseñado.
- **Guardas ajenas que saltaron**: la etiqueta en castellano del evento nuevo,
  el inventario de columnas de la migración, el inventario de rutas —que no
  reconocía la guarda nueva y por eso dio por desprotegido el QR— y **una mía**,
  que exigía que un campo protegido sea escribible: al quitar `seller` de
  `writable` la protección quedaba decorativa. Se resolvió al revés de lo
  esperado: gerencia SÍ debe poder reasignar un cartel impreso cuando la persona
  se va, así que el campo vuelve a ser escribible y lo que se prohíbe es que lo
  reapunte el vendedor.
- **Y otra mía mal escrita**: prohibía la palabra `slug` en todo el bloque del
  recurso, y buscar POR slug es legítimo —es lo que se teclea de un cartel—.
  Ahora mira solo dentro de `writable`.
- **Mutación:** once, las once muertas.

### Fase 3.3 — la pantalla del enlace, y un ciclo de vida que ya estaba resuelto
- **`/dashboard/mi-espacio/enlace`**: crear el enlace, copiarlo, descargar el
  PNG del QR y ver el embudo de los últimos 30 días. **No tiene campo para el
  slug**, y no es un olvido: se dice en pantalla que la dirección la genera el
  sistema, para que nadie lo busque y crea que falta algo.
- **EL CICLO DE VIDA YA ESTABA, Y MEJOR DE LO QUE YO LO HABÍA PLANEADO.** El
  plan pedía un disparador que pusiera los enlaces en inactivo al desactivar la
  ficha del vendedor. **No hace falta**: `resolveLinkBySlug` comprueba el estado
  del VENDEDOR en cada resolución, así que desactivar la ficha deja de atribuir
  al instante y por todos sus enlaces a la vez. Guardar además un estado por
  fila sería una segunda fuente de verdad que puede desincronizarse —y
  asimétrica, porque reactivar al vendedor no reactivaría los carteles—.
- **Y el cartel impreso que sobrevive meses en un lobby no se rompe**: un slug
  que ya no resuelve manda a la portada, igual que cualquier enlace roto, y el
  cliente sigue pudiendo comprar. Lo que se pierde es la atribución, que es
  justo lo que se quería perder. Un 404 habría sido peor por dos motivos: deja
  al cliente sin comprar, y distingue los slugs que existen de los que no.
- **El límite de tasa de `/e/[slug]` también existía ya** (120/hora), con el
  detalle bien pensado de que topar el límite sigue llevando al cliente a
  comprar: lo que se pierde es el registro de la visita, no la venta.
- En vez de duplicar nada, esas cuatro propiedades quedan **fijadas con
  guardas**, para que nadie las «optimice» creyendo que sobran. Cuatro
  mutaciones, las cuatro muertas.

### Fase 3.4 (segunda mitad) — la ruta que NO hizo falta
- El plan pedía `GET /api/seller-portal/catalog` para servirle al vendedor un
  catálogo sin coste. **Al mirarlo, no hacía falta**: los dos caminos que ya
  existen están limpios, y por motivos distintos.
  · `/api/pos/context` arma una **lista blanca** —nombra campo por campo lo que
    devuelve—, así que el coste no viaja por construcción y una columna nueva en
    `product` no se cuela sola.
  · `/api/erp/product` lo recorta con `field-projection.ts` (Fase 1.3).
- Una tercera ruta habría sido **un tercer sitio donde equivocarse**. Lo que se
  añade es la guarda que impide que la lista blanca se convierta en un `...p`
  «para no repetir campos», que es exactamente como se pierden estas cosas.
- **Lo que sí queda sin hacer**, y se dice en vez de darlo por cerrado: la
  **comisión estimada por producto** en el catálogo del vendedor. Exige correr
  el motor de comisiones por producto de forma especulativa y, sin regla
  aplicable, es una cifra inventada — el propio plan pedía declararla
  «estimada» por eso. Se prefiere no enseñarla a enseñar un número que el
  vendedor va a tomar por un compromiso.
- Mutación: tres, las tres muertas.

### Fase 4.1 — ningún tour center podía entrar, y nadie lo sabía
- **El fallo, en una línea:** `src/app/api/team/route.ts` **no contenía la
  palabra `partner_id` en ninguna línea**. El formulario de Configuración →
  Equipo pedía «Tour center» desde el principio y lo enviaba; la API lo
  descartaba y creaba la membresía sobre la operadora. Como el identificador de
  socio solo se emite cuando la organización de la membresía es de tipo socio,
  ese usuario llegaba al portal sin socio y recibía 403.
- Es decir: el administrador creía haberle dado acceso a su tour center, y lo
  que había creado era **un usuario más de su propia empresa**, con el rol que
  fuera. Mismo patrón que «el formulario pedía la sucursal y la API la tiraba»,
  con más consecuencias.
- **Y la invitación era peor todavía**: ni siquiera MANDABA el dato, así que un
  socio no podía entrar ni por el camino en el que él mismo pone su contraseña.
- **Dos comprobaciones, y la segunda es la que importa.** Que sea un socio
  —colgarla de otra cosa no emite identificador de socio y esa persona acabaría
  en el ERP interno creyendo todos que está en el portal— y **que sea de esta
  operadora**: los identificadores son uuid y el formulario los manda tal cual,
  así que sin comprobarlo un administrador engancha a alguien a un socio de OTRA
  operadora. No es un error de escritura: es cruzar el aislamiento entre
  inquilinos por el único sitio donde se puede.
- **EL CERROJO.** El ámbito del socio se decide hoy por `ctx.role === "partner"`
  mientras el identificador de socio se rellena para cualquier rol: un empleado
  de un tour center dado de alta como `seller` o `cashier` entraría al **ERP
  interno** de la operadora. Así que al colgar de un socio el rol se **fuerza**
  a socio. Es una línea, y permite arreglar la puerta hoy sin esperar a
  sustituir las condiciones repetidas.
- **El inventario real de esas condiciones son 29 sitios, no «al menos ocho»
  como decía el plan.** Queda corregido; la sustitución va en 4.2.
- **Y el equipo lista también a los suyos.** La membresía de un usuario de
  portal cuelga de la organización del SOCIO: listando solo por la operadora, el
  alta funcionaría y la pantalla seguiría sin enseñar a esa persona — el
  administrador volvería a darla de alta, se toparía con «ya pertenece a esta
  empresa» y no tendría forma de entender por qué. Se acota por `tenant_org_id`
  para que el aislamiento no dependa de esa consulta.
- **Mutación:** seis, las seis muertas.

### Fase 4.2 — el aislamiento deja de depender del nombre del rol
- **La regla pasa a ser una sola:** identificador de socio presente ⇒ acotado,
  diga lo que diga el rol. Vive en `esDeSocio()` (`src/lib/tenant.ts`) y
  sustituye las **29 comparaciones** `ctx.role === "partner"` repartidas por 20
  ficheros — rutas de venta, manifiestos, vouchers, PDF de arqueo y de estado de
  cuenta, subida de ficheros, cotizador, portal, ERP genérico y los tres
  `layout` del servidor.
- **Por qué importaba:** el identificador de socio se rellena para CUALQUIER
  rol; lo emite `auth-context` en cuanto la membresía cuelga de una organización
  de tipo socio. Un empleado de un tour center dado de alta como `seller` o
  `cashier` tenía socio y **ninguna de las 29 condiciones lo reconocía como de
  fuera**: entraba al ERP interno de la operadora. Hoy era latente —el cerrojo
  de 4.1 fuerza el rol al colgar de un socio—, pero una puerta que depende de
  que otra siga cerrada no está cerrada.
- **Sigue mirando el rol también, y no es redundancia por si acaso.** Varios
  servicios FABRICAN contextos a mano —el motor público, el de revendedor, el
  sembrador— y ninguno rellena `isPartnerMember`. Mirar las dos cosas hace que
  la sustitución sea segura en todos ellos sin tener que encontrarlos uno a uno,
  que es justo el barrido donde se escapa el que falta.
- **Tres sitios se dejan comparando por nombre, con su motivo escrito:**
  `tenant.ts` (es la definición), `portal-context.tsx` (componente de cliente;
  `tenant.ts` es `server-only` y no se puede importar ahí) y
  `configuracion/page.tsx` (es el rol que se **asigna** en el formulario, no el
  de quien llama).
- **La guarda que importa no es la lista, es el barrido.** Enumerar los veinte
  ficheros protege lo ya arreglado; lo que reabre la puerta es un fichero NUEVO
  que vuelva a escribir la comparación, y de ése nadie se acuerda de añadirlo a
  ninguna lista. Así que la regla recorre todo `src`, cuenta las comparaciones
  por fichero y las compara contra las tres perdonadas **con su recuento**: sin
  el recuento, un fichero perdonado una vez queda perdonado para siempre y puede
  ir acumulando comparaciones nuevas debajo de la excepción vieja.
- **Y una prueba de conducta, no de texto** (`socio-identidad.test.ts`): las
  guardas de contrato comprueban que los veinte puntos LLAMAN a `esDeSocio`, y
  eso no vale nada si la función contesta mal — podría devolver `false` siempre
  y las veinte llamadas seguirían en su sitio. Incluye el fallo simétrico: un
  `partnerId` vacío no puede contar como socio, o el personal interno se queda
  fuera de su propio ERP.
- **Migración 0072**: `app.can_read_partner()` deja de mirar el rol en la base de
  datos también, por el mismo motivo y para que las dos capas digan lo mismo.
- **Mutación: trece, las trece muertas** — ocho contra las guardas de contrato
  (incluida un fichero nuevo con la comparación vieja, para probar el barrido) y
  cinco contra la prueba de conducta.

### Fase 4.3 — el ciclo de vida del socio deja de ser decorativo
- **`pending` existía y no hacía nada.** `organizations.status` admite
  `pending`, `suspended`, `inactive` y `blocked` desde la primera migración, y
  el formulario de socios los ofrece en su desplegable. **No los miraba nadie**:
  el enganche del token comprueba el estado de la MEMBRESÍA, no el de la
  organización del socio, así que un tour center marcado como pendiente —o
  suspendido— seguía entrando al portal y reservando con normalidad. Un estado
  que no se comprueba no es un estado: es una etiqueta.
- **Dónde se aplica:** `requireTenant`, por donde pasa toda ruta. Mismo sitio y
  mismo motivo que el segundo factor. Y con `code: PARTNER_INACTIVE`, para que
  la pantalla pueda distinguir «tu empresa aún no está activa» de «no tienes
  permiso», que son dos conversaciones con dos personas distintas.
- **El estado va por consulta y no en el token**, como la ficha de vendedor: en
  el token, suspender a un socio tardaría hasta una hora en surtir efecto. Una
  consulta por clave primaria y solo para quien viene de un socio.
- **Y el cargador falla CERRADO, que aquí no es lo mismo que en los demás.**
  `loadSellerId` devuelve null y null ACOTA; si un fallo de red aquí devolviera
  «activo», un socio suspendido volvería a operar con solo tirar la consulta.
- **El portal explica en vez de romperse.** Una contraseña correcta seguida de
  un portal que falla en cada recuadro sin decir por qué termina en una llamada
  a la operadora para reportar una avería que no existe. El muro va **antes** de
  consultar nada, y no ofrece ninguna acción porque no hay ninguna que dependa
  de quien lo lee.
- **El estado por defecto de un socio nuevo sigue siendo `active`, a propósito.**
  El propio criterio de hecho de esta fase pide que un usuario creado con un
  socio seleccionado entre «sin que nadie toque la base»; nacer en `pending`
  lo incumpliría. Lo que cambia es que el estado, cuando se elige, **muerde**.
- **Condiciones aceptadas: DOS versiones, no una fecha.** «Hay fecha de
  aceptación» no significa «aceptó esto»: la operadora cambia el texto y la
  firma vieja se queda acreditando otra cosa — que es justo el papel que alguien
  sacaría en una discusión sobre una comisión. Aceptadas es
  `terms_accepted_version = terms_version`. Y la versión sube **solo si el texto
  cambió**: subirla en cada guardado haría llegar «las condiciones han
  cambiado» cada vez que alguien corrige un teléfono, y a la tercera vez nadie
  las vuelve a leer.
- **La aceptación la escribe un solo sitio** (`POST /api/portal/terms`), la
  firma el socio —nunca el personal interno que entra a auditar el portal, que
  estaría firmando en nombre de otra empresa— y sella la versión **que lee el
  servidor**, no una que mande el cliente.
- **Y no basta con sacarla de la lista blanca.** El reparto del formulario tiene
  una rama final de cajón de sastre: todo lo que no encaja en ninguna lista cae
  en `metadata`. Sacar las cuatro columnas de la lista de escritura no las
  bloqueaba, las desviaba. Se descartan, y hay una prueba que lo afirma sobre
  los tres destinos.
- **Migración 0073 — el cerrojo en la base, y cierra DOS puertas.** Rol de socio
  si y solo si organización de socio. La primera mitad ya la aplicaba la
  aplicación desde 4.1; **la segunda no estaba cerrada en ningún sitio del
  servidor**: una membresía con rol `partner` sobre la operadora sale sin
  identificador de socio, y «sin identificador» es exactamente lo que
  `app.can_read_partner` entiende por «ve todo». El formulario de Configuración
  lo impedía, pero solo en el navegador. Queda cerrado también en
  `resolveMembershipOrg`.
- **Y una parte 0 en el editor** que lista las membresías que ya incumplen. El
  disparador es `before insert or update`, así que no rompe filas existentes:
  lo que fallará es la próxima edición de una de ellas, y es mejor tener la
  lista ahora que descubrirla el día que un administrador no pueda guardar.
- **Mutación: dieciséis, las dieciséis muertas.** Una no mordía —quitar las
  columnas del descarte las desviaba a `metadata` sin que ninguna guarda se
  quejara— y se arregló con una prueba de conducta sobre el reparto, no
  relajando nada.

### Fase 4.4a — la ficha del socio deja de llevar dentro lo que la operadora piensa de él
- **El eje nuevo.** `HIDDEN_BELOW` recorta por RANGO, y eso no sirve aquí: para
  esconderle al socio —rango 10— las notas que la operadora escribe sobre él
  habría que pedir `manager`, y entonces tampoco las vería operaciones ni caja,
  que son quienes trabajan con ellas a diario. `OCULTO_AL_SOCIO` es un eje
  distinto, no un umbral más alto.
- **`metadata` va en la lista, y es la mitad que convierte el recorte en teatro
  si se olvida.** La ficha del socio se reconstruye desde `organizations`, y esa
  fila arrastra su `metadata` entera — que es donde vive `notes`. Borrar `notes`
  de arriba y dejar el saco debajo deja el mismo texto en la respuesta, una
  clave más adentro.
- **Baja por las expansiones**, que es como el socio recibe su ficha en la
  práctica: su pantalla de reservas expande el socio de cada una. La recursión
  ya existía del recorte por rango, así que sale gratis y una expansión nueva la
  hereda.
- **No se exime por ser su propia fila.** El vendedor sí se exime en su ficha
  —su comisión es suya— y por analogía sería fácil hacer lo mismo aquí; sería
  exactamente al revés. Los dos ejes se escriben por separado y `propia` toca
  uno solo, para que la analogía no tenga dónde agarrarse. Y hay una guarda
  sobre `ES_PROPIA` en vez de solo sobre la salida: hoy el recorte sale bien
  PORQUE esa entrada no existe, y mirar solo el resultado pasaría el día que
  alguien la añada.
- **Lo que el socio SÍ sigue viendo**: su comisión, su crédito y sus condiciones
  comerciales. Son la relación que ha firmado, no una nota sobre él. Y
  `/api/portal/summary` ya devolvía una lista blanca explícita de campos, así
  que por ahí no había fuga.
- **Mutación: ocho, siete muertas.** La octava —eximir también el eje del socio
  para la fila propia— es un no-op mientras `ES_PROPIA` no tenga entrada para
  `partner`; la regresión real es añadirla, y ésa sí muere. Se deja dicho en vez
  de contarla como muerta.

### Fase 4.4b — el tour center da de alta a los suyos
- **Lo que había:** contratar a un vendedor un martes significaba llamar a la
  operadora para que le abriera una cuenta. Con dos operadoras, dos llamadas — y
  mientras tanto esa persona trabaja con la cuenta de otra, que es exactamente
  como se acaba sin saber quién vendió qué.
- **Y algo peor, que nadie había visto:** `PUT /api/team` buscaba la membresía
  con `.eq("organization_id", ctx.companyId)`. La de un usuario de tour center
  cuelga de la organización del SOCIO, así que **ningún usuario de socio se
  podía editar desde ningún sitio**: ni desactivar, ni cambiar de rol. Con la
  persona delante en la lista —el listado sí los trae desde 4.1— y la respuesta
  «Usuario no encontrado en esta empresa». Misma familia que el fallo de 4.1,
  una ruta más allá.
- **Migración 0074 — `partner_role`, y por qué una columna nueva.** Desde 0073
  todas las personas de un socio tienen el mismo `role` por definición, así que
  no había dónde escribir «ésta puede dar de alta a las demás». Relajar aquella
  equivalencia para meter ahí la jerarquía sería reabrir la puerta que cierra:
  cada rol nuevo admitido sobre una organización de socio es un rol que el
  aislamiento tendría que volver a reconocer uno a uno. El aislamiento sigue
  leyendo `role`, que no se mueve.
- **El relleno deja UN administrador por socio: el más antiguo.** Sin relleno la
  función nace apagada para todos los tour centers que ya existen; poniendo a
  todos, un becario da de alta a quien quiera el primer día, y eso no se
  deshace.
- **El permiso devuelve un ÁMBITO, no un sí/no.** `ambitoDeLectura` /
  `ambitoDeEscritura` contestan «sí, y sobre ESTA organización», y la ruta lo
  usa como filtro de la consulta. Es la propiedad que hace que no se pueda
  olvidar: un booleano se comprueba arriba y la consulta va sin acotar.
- **Leer no exige administrar.** Saber quién de tu propia empresa tiene acceso
  no es una facultad de gestión; ocultárselo solo conseguiría que las cuentas de
  quien se fue sigan abiertas porque nadie las ve.
- **El socio no elige ni el rol ni la organización de destino.** El rol es el
  único que puede haber sobre su organización; la organización es la suya.
  Pasarle `body.partner_id` dejaría que el administrador de un tour center diera
  de alta gente en otro de la misma red cambiando un identificador.
- **Y no puede dejar su empresa sin nadie que la administre.** Bajarse a agente
  y desactivarse son el mismo agujero por dos caminos, y el segundo es el que se
  olvida. La operadora podría rescatarlos, pero ése es justo el trámite que esta
  entrega quita.
- **Las dos columnas que parecen accesorias no lo son:** último acceso y segundo
  factor contestan la pregunta que nadie se hace a tiempo —a quién le queda la
  cuenta abierta sin usarla, y quién la tiene sin proteger—. Sin ellas hay que ir
  preguntando a la gente.
- **Y el estado del socio se consulta ahora desde la MEMBRESÍA**, no desde la
  organización: una consulta igual que antes, y de paso más estricta, porque la
  respuesta deja de existir cuando la membresía deja de existir. `claims.status`
  viene del token y una membresía borrada seguía pasando hasta la renovación.
- **Mutación: catorce, las catorce muertas.** Una no mordía —volver el listado a
  la operadora— porque la guarda pedía que la expresión apareciera «alguna vez»
  y la edición la seguía aportando; se cuentan las dos.

### Fase 4.5 — un punto de entrada por actor, y el plan cuenta a todo el mundo
- **La señal de que sobraba un sitio:** en el detalle genérico había dos guardas
  gemelas, una debajo de la otra, y **cada una decía en su comentario que era la
  pareja de la otra**. Eran la misma pregunta hecha sobre dos dimensiones.
- **Se unifica ahora y no después.** Funcionaba porque hoy los dos ámbitos son
  disjuntos: el rol del socio no es `seller`, así que el del vendedor nunca se
  le aplicaba. **Eso deja de ser cierto en la Fase 5**, donde el vendedor de un
  tour center tiene que estar acotado por las dos cosas a la vez; y la Fase 8
  añade el proveedor. Dos reglas sueltas más un tercer actor es el momento
  exacto en que aparece un tercer módulo paralelo.
- **Se ACUMULAN, no se eligen.** Un `if/else if` entre actores haría que a quien
  sea las dos cosas se le aplique solo el primero — y en la pareja
  socio/vendedor el primero es **el menos restrictivo**: ese vendedor vería las
  ventas de todos sus compañeros del tour center. Hay una prueba con ese actor
  exacto, que hoy no existe todavía.
- **Y el ámbito del socio pasa a entrar por `_and`.** Antes se escribía
  `filter[scope.field] = …` sobre el filtro base, o sea que **sustituía** lo que
  hubiera pedido quien consulta en vez de sumarse. Funcionaba porque sustituía
  por algo más restrictivo; es una propiedad que dependía del orden de dos
  asignaciones y ahora no depende de nada.
- **Una rama que ninguna mutación puede matar es una rama que no hace nada.** El
  detalle traía un ternario para distinguir el campo `_id` de una referencia; no
  distinguía nada, porque `refId` de una cadena es la cadena. Se quitó en vez de
  inventarle una guarda.
- **El plan contaba solo la organización raíz**, y la membresía de un usuario de
  tour center cuelga de la del SOCIO: una operadora con cinco empleados y
  cuarenta personas repartidas en sus tour centers figuraba con cinco. Con el
  socio dándose de alta a sí mismo (4.4), eso deja de ser una imprecisión y pasa
  a ser **un plan que no limita nada**.
- **El conteo falla contando de MENOS.** Un fallo leyendo las organizaciones
  devuelve la raíz sola, que es el recuento de antes: cobrar de más por una
  consulta que se cayó sería mucho peor que cobrar de menos.
- **Y hay con qué medir ANTES de desplegarlo**
  (`supabase/editor/medir_usuarios_antes_de_activar_el_conteo.sql`, sin número
  porque no acompaña a ninguna migración). El arreglo mueve operadoras de
  «dentro de su plan» a «por encima» sin que hayan hecho nada, y lo
  descubrirían al recibir un 402 al dar de alta a alguien. La consulta dice
  cuáles y por cuánto. **No es opcional**: es la diferencia entre avisar y que a
  alguien le deje de funcionar el sistema un martes.
- **Mutación: diez, las diez muertas.**

## Fase 5 — El tour center opera

### Fase 5.1 — el sub-login del vendedor del tour center
- **Qué es:** una persona del portal que ADEMÁS tiene ficha de vendedor
  colgando de su propio tour center. Con eso, el ámbito combinado —lo de su
  socio, y dentro de eso lo suyo— sale solo, porque los dos filtros se acumulan
  desde 4.5. La prueba que allí usaba un actor que no existía ahora describe uno
  real.
- **La ficha se busca ACOTADA A SU SOCIO, y esto no es una comodidad.** Sin el
  filtro, un usuario de tour center cuyo correo coincidiera con el de una ficha
  interna quedaría acotado a esa ficha — y vería las ventas de un vendedor de la
  operadora desde el portal. Va con `is null` para el personal interno por lo
  simétrico: una ficha con socio no es de la operadora.
- **La asimetría, escrita para que no parezca un descuido.** Dentro de la
  operadora **lo dice el rol**: `seller` declara por sí solo que esa persona
  está acotada, así que sin ficha se acota a «lo de nadie» —falla cerrado—.
  Dentro de un tour center el rol no puede decir nada, porque desde 0073 todas
  sus personas tienen el mismo; la señal es **la ficha**. Y por eso aquí sin
  ficha NO se acota: un tour center que no usa vendedores —la mayoría, al
  principio— se habría encontrado el portal vacío el día del despliegue.
- Quien administra la cuenta del tour center no se acota nunca, tenga ficha o
  no: es el equivalente del gerente que además vende.
- **El cuidado específico del plan: `seller` entra como PROPIA, nunca como
  compartida.** «Compartida» significa literalmente sin filtro de socio, y esa
  tabla trae las condiciones de los vendedores INTERNOS —comisión, meta, techo
  de descuento—. Queda una guarda que lo comprueba en las dos listas, porque la
  de catálogo compartido es donde se añade por costumbre lo que el socio «solo
  consulta».
- **Y las cuatro tablas sin columna de socio quedan denegadas POR ESCRITO**
  (`seller_goal`, `seller_bonus`, `seller_link`, `seller_attribution`). Ya lo
  estaban —se deniega por defecto—: lo que faltaba era la decisión tomada de
  antemano, que es lo que el plan pedía. Acotarlas exigiría una subconsulta que
  el armador de filtros no expresa, y con un filtro por vendedor a secas el
  agente de un tour center vería las metas de la red interna.
- **El recorte de columnas gana una exención**: quien administra un tour center
  ve la comisión y la meta de SU gente. El recorte por rango se las escondía
  —su rango es el más bajo que hay— y `/portal/vendedores` existe justamente
  para enseñárselas. Al agente no: sus compañeros son sus compañeros. Y la
  exención comprueba el socio de la fila en vez de apoyarse en que el ámbito ya
  la haya filtrado: son dos capas, y la segunda tiene que sostenerse sola.
- **El ámbito del vendedor pasa a recibir al actor entero.** Eran cuatro
  argumentos del mismo tipo en fila —el sitio donde se cuela un intercambio de
  dos que compila—, y harían falta dos más. El compilador hizo de inventario:
  nombró los siete puntos de llamada uno a uno.
- **Y el compilador cazó un tipo que mentía**: `ActorDeFila` no declaraba
  `partnerRole`, así que la exención de quien administra funcionaba solo porque
  el contexto real lo trae. Un llamante que construyera el tipo estricto la
  habría perdido sin que nada se quejara.
- **Mutación: doce, las doce muertas.**

### Fase 5.2 — el equipo de ventas del tour center, y el POS que no los confunde
- **El fallo que apareció al mirar el POS:** los desplegables «Vendedor» y
  «Partner» eran independientes y se mandaban tal cual. Nada comprobaba que
  encajaran, así que se podía registrar la venta del tour center A atribuida a
  un vendedor del tour center B. No es un error de etiqueta: **detrás del
  vendedor va la comisión**, y el motor la calcula sobre `seller_id` sin volver
  a mirar de quién es la venta. Se le paga a quien no vendió, y quien vendió lo
  reclama —con razón— en la liquidación del mes siguiente.
- **La regla NO es simétrica, y mi primera versión lo fue.** Exigir que los dos
  coincidieran siempre parecía lo obvio; **lo cazó una prueba de comisiones que
  ya existía**: el vendedor de la casa SÍ puede cerrar la venta de un tour
  center —el conserje trae al cliente, el mostrador remata— y el motor genera
  dos comisiones a propósito, una para cada uno. Prohibirlo habría roto una
  forma de vender que ya estaba en producción. Lo que no puede pasar es que una
  ficha **que pertenece a un tour center** figure en la venta de otro, o en una
  venta propia.
- **Se comprueba antes de escribir nada** —plazas, cupo, crédito—, porque
  rechazar tarde obliga a compensar escrituras que no había que haber hecho. Y
  solo cuesta una consulta cuando hay vendedor: la venta directa, que es la
  mitad de las que se registran, no paga nada.
- **La pantalla se acota también**, y es otra cosa que cerrarla: estrechar el
  desplegable no impide nada —los identificadores viajan en el cuerpo— pero
  ofrecer una opción que el servidor va a rechazar es peor que no ofrecerla,
  porque el error aparece al final, con el carrito lleno. Y el vendedor que deja
  de encajar al cambiar de socio **se suelta**: si no, queda seleccionado un
  identificador que el desplegable ya no enseña.
- **`/portal/vendedores`**: cuánto vendió cada uno de los suyos y cuánto lleva
  generado. Es de quien DIRIGE, no de quien vende: enseña justo lo que el ámbito
  del vendedor existe para que un agente no vea, y aquí ese ámbito no se aplica
  solo —la consulta pide las órdenes de una lista de vendedores y no pasa por el
  armador de filtros—, así que la puerta se cierra a la entrada.
- **Sin equipo no se consulta nada.** `in: []` no significa «ninguno» en todos
  los traductores de consulta: en alguno es una condición que no se aplica, y
  entonces esa pantalla enseñaría las ventas de la operadora entera.
- Y la ruta **no rehace el aislamiento**: `seller` ya viene acotado por el
  ámbito —es tabla propia del socio desde 5.1— y el recorte de columnas es el
  mismo módulo que usa el listado genérico.
- **Mutación: doce, las doce muertas.** Dos no mordían al principio: una guarda
  buscaba `if (attributedSeller)` suelto y lo encontraba en OTRO sitio del mismo
  fichero —ahora mira el trozo que precede a la comprobación—, y a la regla le
  faltaba el caso del socio en blanco, que da un mensaje distinto («es de otro
  tour center» cuando no eligió ninguno) y manda a quien vende a buscar cuál es
  el otro.

### Fase 5.3a — la cartera propia del tour center
- **Lo que bloqueaba la venta desde el portal, y no era la venta.** `POST
  /api/orders` acepta al socio desde hace tiempo y le fuerza su `partner_id`.
  Lo que no podía era **terminar**: exige `customer_id`, y el socio no tenía
  forma de crear ni de buscar un cliente. `customer` no estaba en su ámbito
  —lo habría visto entero, que es la cartera de la operadora con teléfonos y
  correos— y el CRUD genérico le deniega toda escritura. La pieza que faltaba
  era una columna: de quién es cada cliente.
- **Migración 0075**: `customer.partner_id`, su índice, y **la política en la
  misma entrega**. Aquí es más fuerte que el riesgo transversal del plan: sin
  ella la aplicación filtraría por socio y la BASE diría que ese socio puede
  leer la cartera entera — y una política que contradice a la aplicación es la
  que alguien cita el día que se discute qué pasó.
- **`seller` va en el mismo saco, y es deuda de 5.1**: aquella ola la abrió al
  socio en la aplicación y dejó la política como estaba. Se salda aquí.
- **El relleno no se inventa dueños.** Sin relleno, la política le esconde al
  socio los clientes de sus PROPIAS reservas: hoy ve el nombre en cada una y
  mañana vería un hueco. Con un relleno ambicioso le regalaría clientes que
  también compraron por otro canal. Solo se asigna cuando **todas** las compras
  del cliente son de un mismo socio y **ninguna** es directa — y las directas no
  se filtran en el `where`, porque filtrarlas sacaría del grupo justo los casos
  ambiguos y el `having` los daría por inexistentes.
- **El alta la sella el servidor.** `customer.partner_id` no está en la lista
  blanca de escritura de nadie; la ruta del portal lo pone desde el contexto. Si
  viniera del cuerpo, un tour center daría de alta clientes a nombre de otro y
  se los quitaría de la cartera al siguiente. Y por lista blanca de campos, no
  copiando el cuerpo.
- **El socio ve la ficha, no el historial.** `customer.expandOne` arrastra
  órdenes, reservas y oportunidades: todo lo que esa persona le ha comprado
  nunca a la operadora, por cualquier canal. Se declara una expansión propia
  para el socio en vez de confiar en que la RLS filtre — la capa de datos habla
  por el rol de servicio cuando la RLS está apagada, y entonces no filtra nadie.
- **Y una guarda que pasaba por mirar donde no había nada**: el trozo del
  recurso `customer` se cortaba buscando `"  customer: {"`, que aparece antes
  dentro de las expansiones de otros recursos. Un `not.toMatch` sobre el trozo
  equivocado siempre pasa. Ahora se ancla en su `table`.
- **Mutación: diez, las diez muertas.**

### Fase 5.3b — el portal reserva
- **`/portal/reservar`**: el catálogo con el neto del socio, las plazas reales,
  su crédito disponible y su propia cartera de clientes, en una pantalla.
- **Lo que la pantalla NO hace, que es la parte que importa:** no calcula
  precios, no comprueba cupo y no decide si el crédito llega. El neto lo da el
  motor de precios con el canal `b2b_portal`, las plazas las da el catálogo, y
  el crédito lo vuelve a comprobar la venta con los documentos abiertos en el
  momento de escribir. Lo que se pinta es un **espejo**; uno que decidiera por
  su cuenta sería la segunda verdad que se desincroniza sola, y aquí eso es
  prometerle una plaza a un cliente que ya no existe.
- **El aviso de crédito no bloquea.** El saldo vivo cambia con cada cobro y
  quien decide es el servidor al escribir; un veto en pantalla haría que el
  socio dejara de vender por un número viejo. Y sigue sin poder saltárselo: la
  ruta le borra `allow_over_credit` desde antes, y eso es lo que permite que el
  aviso sea solo un aviso.
- **Tampoco manda el socio ni el precio en el cuerpo.** Los pone el servidor.
  Mandarlos daría la impresión de que la pantalla lo decide, y el día que
  alguien cambiara ese valor en la petición se descubriría que no servía de
  nada — o, peor, que sí.
- **Y una guarda vieja cazó un error nuevo en el acto**: escribí
  `available_pax ?? 0` al pintar las plazas. La regla que nació de una captura
  del usuario —un cupo que nadie ha calculado no es un agotado— saltó en la
  primera ejecución. Pasa por `plazasParaMostrar`, que dice «cupo sin definir»
  en vez de un cero rojo que le diría al tour center que no puede vender una
  salida vacía.
- **Mutación: seis, las seis muertas.**

### Fase 5.4 — el voucher del tour center, y la disputa que no existía
- **El neto iba impreso en el papel que el socio le da al turista.**
  `booking.total_amount` de una venta B2B es lo que el tour center le paga a la
  operadora, no lo que el cliente pagó en el mostrador. El voucher lo imprimía:
  **el margen de quien se lo acaba de vender, en el documento que ese mismo
  vendedor le está poniendo en la mano.**
- **La condición es de la RESERVA, no de quién la descarga.** El mismo PDF lo
  puede bajar la operadora y reenviárselo, o salir por el correo automático;
  acabe como acabe, termina en la mano del turista. Con `esDeSocio(ctx)` el neto
  se habría escapado por los otros dos caminos sin que nadie lo notara.
- **Y no se pone a cero: el bloque entero desaparece.** Un total en cero dice
  «esto no costó nada», que es otra afirmación falsa. En su lugar va la línea
  que remite a quien cobró.
- **La marca es del socio; las condiciones y el pie, de la operadora.** El
  turista compró en el mostrador del tour center y no sabe que detrás hay otra
  empresa — un logo ajeno le hace dudar de lo que acaba de pagar, o le enseña a
  quién llamar la próxima vez sin pasar por quien se lo vendió. Al revés sería
  peor: un documento que promete en nombre de quien no puede cumplir. **El color
  de marca no se hereda**, porque la ficha del socio no tiene dónde guardarlo y
  arrastrar el de la operadora pintaría el papel del tour center con los colores
  de quien no lo firma.
- **La disputa: el estado existía y no se podía alcanzar.** `settlement.status`
  admite `disputed` desde 0006, la interfaz lo sabe traducir, y
  **`dispute_reason` lleva ahí sin que nadie la escriba desde 0040**. La
  pantalla del portal decía literalmente «contacta con tu gestor»: de esa
  llamada no quedaba nada — ni el motivo, ni la fecha, ni quién se comprometió a
  mirarlo.
- **Migración 0076** añade lo que faltaba: cuándo, quién del tour center, y **a
  quién le toca resolverla**. Ese último es el que el plan pedía con esas
  palabras y el que evita el final habitual: un aviso a «los administradores»
  que todos ven y ninguno coge.
- **El destinatario se guarda, no solo se avisa.** Un aviso enviado y no
  registrado deja la disputa sin dueño en cuanto alguien lo marca como leído. Y
  cuando no hay nadie asignado **se dice**: dejar al tour center creyendo que
  alguien la está mirando es peor que decirle que insista.
- **Una liquidación PAGADA se puede disputar**, y es el caso que más importa:
  «me pagaste menos de lo acordado» solo se descubre cobrando. Cerrarlo al pagar
  convertiría el pago en un finiquito unilateral.
- **Quién puede: la comprobación que ya existía.** `assertSettlementBeneficiary`
  es la misma que abre el estado de cuenta y el PDF — su propio comentario ya
  anticipaba esta ruta. Una cuarta copia de la misma pregunta es la que un día
  dice algo distinto.
- **Mutación: catorce, las catorce muertas.**

### Fase 5.5 — la exportación del socio, por lista blanca que falla por omisión
- **El exportador no sabe recortar columnas, y el recorte por campos tampoco
  alcanza.** `exportColumns` arma las cabeceras con **las claves que traigan las
  filas**: es lo correcto para el ERP interno —quien exporta quiere todo lo que
  tiene— y exactamente lo contrario de lo que hace falta para un actor externo.
  `field-projection` quita lo que se declaró sensible; aquí el problema era lo
  que **no se declaró nada**, o sea cada columna que se añada a cualquier tabla
  a partir de mañana.
- **Falla por omisión, y ésa es toda la gracia.** Un recurso sin lista devuelve
  un 403 que se entiende. La alternativa —exportar todo mientras nadie declare
  nada— convierte cada tabla nueva en una fuga silenciosa que se descubre cuando
  ya está en el Excel de alguien.
- **`null` no es «ninguna columna»: es «esto no se ha decidido».** Una lista
  vacía habría producido un archivo con cabeceras y sin datos, que parece un
  error del sistema en vez de una decisión.
- **Y el orden es el declarado**, resuelto antes de recorrer las filas. Con el
  orden de las claves, las columnas cambian entre dos exportaciones del mismo
  listado según qué fila venga primero con qué campos rellenos — y un archivo
  cuyas columnas bailan no se puede comparar con el del mes pasado.
- **La lista se valida contra el ESQUEMA, no contra `resources.ts`.** Los
  recursos declaran lo que se escribe, y `booking` escribe seis campos de los
  treinta que se leen. La guarda nueva se apoya en el esquema que
  `schema-contract.test.ts` ya reconstruye leyendo las migraciones.
- **Y cazó cuatro campos míos mal escritos en la primera ejecución**: las
  columnas de la orden no se llaman como las de la reserva (`total`,
  `paid_total`, `balance`, no `*_amount`) y la de la comisión es `percentage`,
  no `rate`. Escritas de oído, esas cuatro columnas simplemente no habrían
  salido en el archivo — y nadie lo habría notado, porque el socio no sabe qué
  columnas debería tener y quien las declaró no vuelve a mirar.
- **Mutación: ocho, las ocho muertas.**

---

## La medición del conteo de plan — hecha (2026-09-23)

`supabase/editor/medir_usuarios_antes_de_activar_el_conteo.sql`, ejecutada en
producción antes de desplegar el arreglo de 4.5. Resultado:

| operadora | plan | tope | antes | ahora | efecto |
| --- | --- | --- | --- | --- | --- |
| Platform Admin | — | — | 2 | 2 | sin tope declarado |
| Havelgo Demo Tours | — | — | 1 | 1 | sin tope declarado |

**Ninguna operadora se pasa: el arreglo se puede desplegar sin avisar a nadie.**
Queda cerrado el «no es opcional» que este registro dejó escrito en 4.5.

Y la tabla dice dos cosas más que no se preguntaban:

- **`antes` y `ahora` coinciden en las dos**, o sea que hoy no hay NINGUNA
  membresía colgando de una organización de socio. Es exactamente lo que
  describía 4.1 —«ningún tour center podía entrar»— visto desde los datos: el
  hueco que 4.1 cerró no llegó a producir un solo usuario de portal.
- **Ninguna de las dos tiene plan asignado**, así que `max_users` es nulo y el
  techo no existe todavía. El conteo corregido no limitará nada hasta que se
  asigne un plan; conviene volver a correr esta consulta el día que se asigne,
  porque entonces sí puede haber una operadora por encima.

## Fase 6 — El contrato explícito

### Fase 6.1 — el contrato socio–producto: no estaba roto, no existía
- **Lo que había.** `authorized_products` aparece en el tipo `Partner`, el
  catálogo del portal lo pide expandido, el reparto del formulario lo descarta
  a propósito y la ficha del socio promete «catálogo autorizado» en su
  descripción. Lo que no hay en ninguna parte es **dónde guardarlo**: no existe
  la tabla, `partner` no lo declara escribible, ningún formulario lo ofrece, y
  `authorized_products` **ni siquiera está en el mapa de relaciones** — así que
  la expansión devuelve vacío SIEMPRE.
- Y el catálogo filtraba así: `authorizedIds.length ? { _id: { in: … } } : {}`.
  Lista vacía, sin filtro. **Ese filtro no se aplicó nunca, ni una vez, desde
  que se escribió.** Un operador que lea esa pantalla concluye que su tour
  center solo ve lo autorizado.
- **Migración 0077** crea la tabla, su política —tabla nueva y actor externo:
  aquí la tabla ES la autorización, y sin política un socio leería las de sus
  competidores, que es el mapa de qué vende cada uno— y **siembra**.
- **La siembra no es una comodidad.** En cuanto la lista vacía deja de
  significar «todo», un socio sin filas no vende nada: sin sembrar, el
  despliegue apagaría la venta de todos los tour centers a la vez, con el
  síntoma «el catálogo me sale vacío», que nadie relaciona con una migración. Lo
  mismo por los otros dos lados, con un disparador cada uno: **un producto nuevo
  nace autorizado para todos** y **un socio nuevo nace con el catálogo de hoy**.
  Lo contrario suena más «contrato explícito» y es la trampa — publicar una
  excursión dejaría de verse hasta que alguien la autorizara socio a socio.
- **Y se aplica AL VENDER, que es la mitad que faltaba.** Acotar el catálogo
  esconde el producto de una pantalla; la reserva llega por el cuerpo de una
  petición con un `product_id` dentro, y la de un socio que integra por API ni
  siquiera pasa por esa pantalla. Un filtro de listado es una sugerencia.
  Comprobado **antes** de tomar plazas, consumir cupo o apuntar crédito, y solo
  cuesta una consulta cuando la venta es de un socio.
- **El error dice QUÉ productos, por su nombre, y todos de una vez.** Un 403 con
  uuids obliga a quien integra a cruzarlos a mano; contestarle de uno en uno le
  hace descubrir su contrato a base de reintentos.
- **Nueve pruebas existentes se pusieron en rojo al instante** — todas las de
  venta al socio, más las de OTA. Es exactamente el riesgo del plan reproducido
  en el banco de pruebas: sin autorizaciones sembradas, no se vende. Los
  fixtures se siembran igual que la migración.
- **Tres guardas foráneas mordieron**: un recurso escribible sin pantalla es un
  módulo muerto (de ahí `/dashboard/partners/catalogo`), una tabla nueva tiene
  que salir en «llévate tus datos», y **un `create table` junto a un bloque `$$`
  revienta el editor de Supabase** — el SQL va en tres partes por eso.
- **Mutación: diez, las diez muertas.** Tres no mordían y eran fallos de las
  guardas, no del código: una comprobaba que la lista se calculaba pero no que
  se usara —se podía borrar el filtro entero—, otra daba por bueno un disparador
  **renombrado** porque `..._off` contiene el nombre original, y la tercera
  aceptaba una siembra que escribe `null` donde va el socio.

### Fase 6.2 — el socio a neto cobraba su margen dos veces
- **Dos formas de trabajar con un canal externo, y son excluyentes.** A
  **comisión**: vende al precio de tarifa y se le liquida un porcentaje. A
  **neto**: COMPRA a un precio rebajado y revende al que quiera, con su margen
  ya dentro del precio. El sistema soportaba las dos por separado sin saber que
  no se suman.
- `generateCommissionsForBooking` empujaba un beneficiario de tipo socio **en
  cuanto la reserva tenía socio**, sin preguntar nada más. Un tour center con
  tarifa neta cobraba su margen dos veces: una en el precio y otra en la
  liquidación.
- **Y no se ve el día de la venta**: las dos cifras son correctas por separado.
  Se ve un mes después, cuando alguien compara la liquidación con el contrato —
  que es exactamente por lo que el plan lo llamaba riesgo económico y no de
  datos.
- **Migración 0078**: `pricing_model` en la RELACIÓN, no en la organización,
  porque es del contrato — la misma agencia puede trabajar a comisión con una
  operadora y a neto con otra. Mismo sitio y mismo motivo que las condiciones
  aceptadas de 0073.
- **Lo desconocido es «comisión», no «neto».** Es lo que hacía el sistema con
  todos los socios antes de que la columna existiera; entender el hueco como
  neto les quitaría la comisión a todos de golpe el día del despliegue — el
  mismo apagón silencioso que evita la siembra de 0077, con el signo cambiado.
  Las filas existentes toman el valor por defecto sin tocarlas: no hay relleno.
- **La ficha pide el modelo justo encima de la comisión estándar**, a propósito:
  con «neto» esa casilla deja de aplicarse, y verlas juntas es lo que evita
  rellenar las dos creyendo que se suman.
- **Y la verificación mira dos cosas que solo se ven después**: socios a neto
  con la comisión estándar todavía rellena —señal de que alguien la puso
  creyendo que sumaba— y **comisiones ya generadas** a socios que ahora se
  declaran a neto. Esas son del pasado y no se tocan —reescribir el histórico es
  peor—, pero hay que saber que existen antes de liquidar el mes.
- **Lo que NO se hizo, y por qué:** el plan pedía «modelo de precio **y de
  cobro**». El de cobro son los tres modos de la Fase 7 (paga el cliente al
  operador; cobra el punto de venta y debe el neto; el vendedor retiene su
  comisión), y allí tendrán quién los lea. Declarar hoy una columna que nadie
  lee es repetir exactamente el fallo que 6.1 acaba de arreglar.
- **Mutación: siete, las siete muertas.**

### Fase 6.3 — la reserva por API nacía sin socio, y el tarifario no existía
- **El hallazgo grande no era el tarifario: era la llave de API.** `api_key`
  tiene `partner_id` desde que existe, y ese dato llegaba **solo al registro de
  auditoría**. La reserva se creaba sin socio. Todo lo que cuelga del socio se
  perdía en silencio, de una vez: su comisión, su comprobación de crédito, su
  cupo contratado, su contrato por producto (el de 6.1) y la visibilidad de esa
  reserva en su propio portal. El socio integrado por API era, para el sistema,
  un cliente anónimo que casualmente traía una llave.
- **Y se pierde callando**, que es lo que lo hace caro: la reserva se crea, el
  tourista viaja, nadie ve un error. Sale a la luz a fin de mes, cuando el socio
  reclama una liquidación que no cuadra con lo que vendió.
- `createPublicBooking` recibe ahora el socio y sella con él `partner_id` y el
  canal: `b2b_portal` cuando lo hay, `web` cuando no.
- **El canal es `b2b_portal` también por API, y a propósito.** `b2b_api` ni
  existe en el enum `sales_channel` —el insert habría fallado, y TypeScript no
  lo ve porque el canal viaja como cadena—, pero además las reglas de precio se
  indexan por canal: con dos canales distintos, el mismo socio pagaría un precio
  por el portal y otro por la API, por el mismo producto y el mismo día.
- **El tarifario y la API salen de la MISMA función**, `tarifarioDeSocio`. El
  criterio del plan —«el archivo descargado coincide con lo que la API
  devuelve»— no se consigue revisándolo: se consigue teniendo una sola fuente.
  Dos implementaciones del mismo precio no divergen el día uno; divergen el día
  que alguien añade una regla de temporada a una de las dos, y la divergencia
  aparece facturando.
- **Los precios los da el motor, no una fórmula.** Reconstruir aquí «precio base
  menos comisión» habría dado un número parecido casi siempre, que es la peor
  clase de número: el que nadie revisa hasta que no cuadra.
- **La fecha es obligatoria y va dentro del archivo y en su nombre.** Las reglas
  tienen temporada, así que «el tarifario» sin día no existe; un archivo sin
  fecha dentro es el que alguien reenvía en noviembre con los precios de agosto.
- **Un producto sin tarifa no tumba el archivo entero**: se queda fuera y los
  demás salen. Lo contrario le quita al socio los cuarenta precios que sí tiene
  por culpa del que falta, y el arreglo está del lado de la operadora.
- **Una guarda de texto no mordía y se tiró.** Comprobaba que hubiera un `catch`
  cerca del `resolvePrice`; un `catch` que vuelva a lanzar el error la cumple al
  pie de la letra y rompe el archivo igual. Esa propiedad es de lo que SALE, no
  del texto: vive ahora en `src/lib/tarifario.test.ts`, ejecutando la función
  con un producto cuyo precio revienta y comprobando que los otros dos siguen
  saliendo. **Es la segunda vez en esta fase que una «mutación que no muerde»
  resulta ser una guarda escrita contra el texto en vez de contra el efecto.**
- **`/api/v1/products` aplica el contrato por producto**, que se había quedado
  fuera en 6.1: era justo la ruta por la que mira un socio que integra antes de
  reservar, así que le enseñaba productos que su propia reserva iba a rechazar.
  Y añade `net_price`/`net_currency` con la misma función del tarifario.
- **Mutación: nueve, las nueve muertas.**

### Fase 6.4 — el motor de cupos estaba entero; lo que faltaba era enseñarlo
- **Lo primero fue mirar qué había, y había casi todo.** `allotment` existe
  desde 0010, `allotments.ts` decide, `allotment-service.ts` aplica y
  `createOrderWithBookings` —el único camino que crea reservas, también el de la
  API y el de las OTA— lo comprueba antes de tomar plazas. La liberación
  automática funciona y la cancelación devuelve las plazas a su cupo. Nada de
  eso había que escribirlo.
- **Lo que no existía era que el socio lo supiera.** Su catálogo y su pantalla
  de reservar le enseñaban las plazas libres de la SALIDA. Un tour center con
  diez garantizadas veía las cuarenta de la guagua, vendía quince, y el 409 de
  `assertAllotment` le llegaba en la cara del turista que tenía delante. **El
  contrato no estaba roto: estaba escondido, y un límite que solo aparece al
  final es indistinguible de un fallo del sistema.**
- **La rejilla del cupo ya estaba escrita y pedía `manager`.** Es decir: el
  contrato de plazas que el tour center firmó solo podía verlo la otra parte. Se
  enteraba de lo que le quedaba preguntando por WhatsApp — que es exactamente
  lo que el motor de cupos vino a sustituir.
- **Una función para las tres superficies**, `cupoVisible`: el catálogo del
  portal, la pantalla de reservar y `/api/v1/availability` dicen el mismo número,
  y el mismo que va a comprobar la reserva. Mismo motivo que el tarifario de
  6.3: dos cuentas del mismo cupo no divergen el día uno.
- **Tres motivos y no uno, porque el remedio es distinto.** «Cupo cerrado» y
  «cupo agotado» los arregla su comercial; «salida llena» no lo arregla nadie y
  lo que toca es otro día. Un único «no hay plazas» manda al socio a llamar a
  quien no puede ayudarle.
- **Y solo se bloquea el botón por lo que no cambia esperando.** La pantalla
  avisa en vez de bloquear porque su número es de hace dos minutos y una
  cancelación libera plazas todo el rato. Pero un cupo CERRADO no se abre solo:
  dejar el botón vivo ahí solo sirve para que el socio escriba los datos del
  turista y se coma el rechazo al final.
- **`/api/v1/availability` no miraba ninguna de las dos cosas que la reserva sí
  mira**: ni el contrato por producto de 6.1 —un socio integrado planificaba
  sobre un producto que no tiene autorizado— ni su cupo. Ahora `seatsLeft` es LO
  SUYO: dejarle el número grande al lado del pequeño es pedirle a quien integra
  que elija el equivocado.
- **«No saber» sigue sin ser «agotado».** Una salida sin cupo calculado no está
  llena, y la pantalla dejó de reconstruir el número desde `capacity`: hacerlo
  en el navegador devolvía la guagua entera justo cuando nadie la había contado.
- **Y no se le inventa un contrato al que no lo tiene.** `allotmentState`
  devuelve un `free_sale` de relleno para que la venta siga adelante; eso es un
  valor por defecto, no un acuerdo, y presentarlo como tal le diría al socio que
  firmó algo que no firmó.
- **Una entrada de menú estaba duplicada palabra por palabra** (`p-reservar`,
  dos líneas idénticas: dos entradas en el menú del socio y dos claves de React
  iguales). Una lista escrita a mano acumula esto en silencio; la guarda que lo
  caza son tres líneas y vale para todas las futuras.
- **Mutación: quince, las quince muertas.**

### Fase 6.5 — al tour center no se le contaba nada
- **`notification.partner_id` está en la tabla desde 0009 y NADIE la escribía ni
  la leía.** Es la tercera columna de esta fase que promete un vínculo con el
  socio y no lo cumple, después de `authorized_products` (6.1) y de
  `api_key.partner_id` (6.3). La consecuencia era literal: al tour center no se
  le contaba **nada** de sus propias ventas — ni que la reserva quedó
  confirmada, ni que le movieron la fecha y la recogida, ni que se la
  cancelaron, ni que le emitieron la liquidación, ni que se la pagaron.
- **Y el turista SÍ recibía sus avisos.** Al cliente se le escribe desde que
  existen la reserva, la reprogramación y la cancelación. El socio —que es quien
  tiene el teléfono del turista en la mano y quien lo va a buscar al hotel—
  quedaba como el último en enterarse de una venta que hizo él.
- **Emitir una liquidación no avisaba a nadie**, ni al socio ni dentro de la
  operadora: se creaba el documento y ahí se quedaba. Para el socio es el aviso
  que ABRE el plazo de revisión; sin él descubre el corte cuando le llega el
  pago, y discutirlo entonces es discutir sobre dinero que ya se movió — la
  disputa de 5.4 existe para usarse antes de eso.
- **`settlement_paid` solo miraba `beneficiary_type === "seller"`**: a un socio
  liquidado no se le decía nunca que le habían pagado.
- **Dos buzones, no uno con permisos.** `inboxFilter` compartía la bandeja por
  rango, y eso fallaba por los dos lados a la vez: **hacia dentro**, el cajón de
  `audience_role is null` —los avisos anteriores a 0044— lo alcanza cualquiera,
  y para un miembro de un tour center eso es la bandeja interna de la operadora;
  **hacia fuera**, los avisos de socio llevan `partner_id` y no llevan rol, así
  que por rango no los habría alcanzado nunca, ni con el rango más alto.
- **Y la decisión no se reimplementa: entra como dato.** `notify.ts` es puro y
  no puede importar `tenant.ts`, que es `server-only`. Escribir aquí
  `role === "partner"` habría reabierto la puerta trasera de 4.2 — lo cazó esa
  misma guarda en la primera ejecución. El actor trae `esDeSocio(ctx)` ya
  resuelto por el único sitio autorizado a mirar el nombre del rol.
- **El agujero que se abre al crear un actor nuevo, y que cierra en la misma
  entrega.** La ruta de marcar como leído decía «`user_id` nulo ⇒ es de empresa
  ⇒ vale». Los avisos de un tour center también tienen `user_id` nulo: esa regla
  dejaba que un interno —y, peor, **otro tour center**— se los marcara como
  leídos y se los borrara de la campana antes de que él los viera. Ahora lo
  decide `puedeMarcar`, que vive al lado de `inboxFilter` porque leer una
  bandeja y marcar lo que hay en ella son la misma regla escrita dos veces si se
  separan.
- **Una sola pantalla para los dos buzones.** Quien decide qué hay dentro es el
  servidor, así que la bandeja es el mismo componente en el panel y en el
  portal. Dos copias se habrían separado el día que alguien arreglara el
  contador en una sola.
- **Un `badgeKey` en el menú del portal era una promesa muerta**: el dato estaba
  en `nav.ts`, `app-shell` lo pintaba, y `side-shell` —el atajo que usa el
  portal— lo tiraba al suelo. Una bandeja sin número de no leídos obliga a
  entrar a mirar, que es de lo que venimos.
- **Migración 0079: un índice y una política.** Hasta ahora `notification` tenía
  solo el aislamiento por empresa, así que la BASE le dejaba a un miembro de un
  tour center leer la bandeja interna entera de la operadora y solo el filtro de
  la aplicación lo impedía. **No se usa `can_read_partner`**, y esa es la
  diferencia que importa: esa función exige que la fila lleve el socio de quien
  consulta, y los avisos PERSONALES de un miembro del tour center no llevan
  ninguno — con ella, el socio dejaría de ver los suyos propios.
- **El socio entra en la clave de dedupe por la SEMILLA**, no por un trozo nuevo:
  añadir un quinto campo cambiaría la clave de todos los avisos ya escritos y el
  índice único dejaría pasar una copia de cada uno.
- **Mutación: quince, las quince muertas.**

### Fase 6.6 — el prepago no existía, y el crédito sí
- **Lo primero fue mirar qué había.** El control de crédito funciona desde 0031:
  `creditCheck` comprueba el techo con lo que el socio debe según sus documentos
  abiertos, y la venta se para. Nada de eso hacía falta tocarlo.
- **Lo que no había es lo contrario**: el socio que ingresa por adelantado y va
  gastando, que es como trabaja media costa — transfieren el lunes y venden toda
  la semana contra ese depósito. Sin esto había que llevarle el saldo en una
  libreta y mirarla antes de cada venta. Como el cupo antes de 6.4 y el contrato
  antes de 6.1: el acuerdo existía fuera del sistema.
- **EL SALDO NO SE GUARDA: SE SUMA.** No hay columna `balance`. Una columna con
  el saldo es un número que puede discrepar de sus propios movimientos, y cuando
  discrepa nadie sabe cuál de los dos es el bueno. Un saldo derivado se
  recalcula. (Había un `balance: 0` en el sembrador de demostración que no iba a
  ninguna columna — ni en `PARTNER_RELATIONSHIP_COLUMNS` ni en
  `PARTNER_ORG_COLUMNS`: era justo esa columna imaginaria.)
- **EL IMPORTE SIEMPRE ES POSITIVO; el signo lo pone el TIPO.** Con importes con
  signo, una recarga de −500 vacía el monedero sin que nada parezca raro: en el
  listado se lee como una recarga. Lo hace cumplir un `check` en la base, porque
  el día que alguien inserte por SQL la aplicación no está delante.
- **Y el ajuste SIEMPRE resta.** Un ajuste que suma es una recarga y tiene que
  entrar por la puerta de las recargas, donde queda el número de la
  transferencia — si no, es la forma de regalarle saldo a un socio sin que se
  vea de dónde salió.
- **El socio no puede escribir en su propio monedero**, y por eso son DOS rutas
  y no una con permisos. Quien apunta una recarga es quien VE la transferencia
  en el banco, y eso es la operadora. Si el socio pudiera, el saldo dejaría de
  significar «dinero ingresado» para significar «lo que el socio dice que
  ingresó», y con eso vendería sin haber pagado. Ni siquiera puede LEER la ruta
  interna: acepta el socio por parámetro, y el saldo de un socio dice cuánto
  ingresa y cuánto vende.
- **El consumo no se apunta a mano.** Lo escribe la venta, con su orden colgada,
  y el CRUD genérico no tiene ni una columna escribible en esa tabla. Un consumo
  sin venta detrás baja el saldo y no deja nada que enseñar cuando el socio
  pregunte por qué.
- **Una venta descuenta UNA vez, y lo hace cumplir un índice único** — no una
  comprobación de la aplicación: dos instancias a la vez le ganan siempre. Sin
  él, un reintento cobra dos veces la misma reserva.
- **Se comprueba ANTES de escribir y se descuenta DESPUÉS**, igual que el cupo:
  descontar antes y que la saga se compensara dejaría al socio pagando una
  reserva que no llegó a nacer. Y se descuenta con el TOTAL de verdad, no con la
  estimación que sirvió para comprobar — cobrar por la estimación dejaría el
  saldo distinto de lo que el socio ve en su factura.
- **La cancelación mira el LIBRO, no el contrato de hoy.** Un socio que pasó de
  prepago a crédito entre la venta y la cancelación recibiría un abono por una
  venta que nunca le descontó, o al revés se quedaría sin su devolución. Y
  devuelve lo de ESA reserva, no el total de la orden.
- **La moneda es lo que más calla.** Un monedero en dólares al que se le apunta
  una recarga en pesos suma 30.000 a un saldo de dólares. Se rechaza y no se
  convierte — convertir sería inventarse un tipo de cambio que nadie pactó y
  enterrarlo en una fila. La moneda sale del contrato, no del cuerpo de la
  petición: dejar que quien apunta la elija es exactamente cómo entra esa
  recarga.
- **Y la primera versión de esa comprobación no podía fallar nunca**: comparaba
  el movimiento consigo mismo. La moneda del monedero entra ahora como parámetro
  aparte, y hay una mutación que lo vigila.
- **El saldo se suma sobre TODOS los movimientos, no sobre la página que se
  devuelve.** Un saldo por página crece solo cuando el socio pasa de quinientos
  movimientos, y crece hacia arriba —se pierden consumos viejos—, que es el lado
  caro del error.
- **Prepago y crédito son EXCLUYENTES**, declarados en la relación como el
  modelo de precio de 6.2. Comprobar los dos sería pedirle al socio prepago que
  además tenga crédito. Y **lo desconocido es crédito**: es lo que hacen hoy
  todos los socios, y entender el hueco como prepago les cortaría la venta a
  todos de golpe el día del despliegue, porque todos los monederos nacen a cero.
- **Una recarga apuntada avisa al socio** (6.5). Un ingreso que él no ve
  reflejado es una llamada al día siguiente preguntando si llegó — y, si no
  llegó, una venta que le rebota por saldo sin que sepa por qué.
- **Mutación: veinte, las veinte muertas.**

### Fase 7.1/7.2 — la caja no sabía de quién era el dinero
- **Las tres tablas de caja llevaban sucursal y usuario, y nada más.** No había
  forma de decir «esta caja es del mostrador del tour center Coral» ni «este
  turno es del vendedor de la playa»: el dinero de la calle no cabía en el
  modelo, así que o no existía o entraba en el cajón de la operadora.
- **Y hay un sitio donde ya se perdía HOY, sin esperar a la caja externa.**
  `/api/payments` creaba el cobro CON su socio —`payment.partner` existe y se
  rellenaba— y en la línea siguiente abría el `cash_movement` sin él. Desde el
  momento de escribirlo, el efectivo de una venta de socio era indistinguible
  del propio de la operadora. Mientras el socio no pueda abrir caja eso no
  descuadra nada; deja de ser cierto en cuanto exista la caja externa.
- **`/api/cash/sessions` armaba su propio filtro y no pasaba por ningún ámbito**:
  listaba TODAS las sesiones de la empresa. Con la caja externa son dos fallos a
  la vez — al interno le enseñaría el efectivo de los tour centers como propio,
  y a un miembro de un tour center el de la operadora y el de las demás.
- **El arqueo interno exige `partner` NULO, no la ausencia de filtro.** El
  criterio del plan es que no incluya NI UN movimiento de caja de socio, y eso
  hay que escribirlo: omitir el filtro —que es lo que hace la política de la
  base, donde el interno lo ve todo— haría que el arqueo sumara el efectivo de
  los tour centers como propio.
- **Y lo hace cumplir la BASE, no el acordarse de copiarlo.** Un disparador
  rechaza el movimiento cuyo dueño no sea el de su turno. El arqueo suma los
  movimientos de SU turno, así que basta con eso — y no se consigue acordándose
  de pasarlo bien en las tres rutas que escriben. Con `is distinct from` y no
  `<>`: con nulos, que es el caso normal, `<>` devuelve nulo y no salta nunca.
- **Un turno no cambia de dueño a mitad**, también por disparador. Mover el
  socio de una sesión abierta reasigna de golpe todo su efectivo, y en la
  dirección cara: una caja de socio que se vuelve de la operadora mete en el
  arqueo un dinero que nadie tiene.
- **`tenantFindOne` solo comprueba la empresa**, así que bastaba conocer el
  identificador de una sesión para meterle un retiro, cerrarle el turno a otro o
  abrir su arqueo — y el descuadre, con su aprobación, queda a nombre de quien
  sí estuvo ahí. Las cuatro rutas usan ahora la MISMA función: tres
  comprobaciones distintas de «esta caja es tuya» acaban discrepando.
- **El socio no abre la caja de la operadora, ni al revés.** La segunda
  dirección es la que no se piensa: dejarle abrirla metería su efectivo en el
  cajón de la casa —el descuadre que toda esta fase existe para evitar— y el
  arqueo interno lo contaría como propio.
- **La caja no se abre al CRUD genérico**, y la decisión queda escrita: la base
  se la deja leer al socio (`can_read_partner`), pero sus pantallas van por las
  rutas de caja, que además comprueban el dueño del turno. Una segunda puerta al
  mismo dinero con la mitad de las comprobaciones. La aplicación puede ser más
  estricta que la base; nunca al revés.
- **Diez de diecisiete mutaciones no mordían, y las diez eran fallos de las
  guardas.** Cinco comprobaban la LLAMADA y no el efecto —borrar el `throw` y
  dejar la llamada las pasaba—; dos daban por bueno un disparador **renombrado**
  porque `..._off` contiene el nombre original; una encontraba su texto en otro
  sitio del mismo fichero; una comprobaba que el filtro se calcula pero no que
  se use. Y la décima destapó una trampa nueva: **`/api/cash` seguido de un
  asterisco dentro de una cadena abre un comentario de bloque**, y el
  quitacomentarios de las guardas se tragó tres líneas de la lista de tablas
  denegadas — la guarda buscaba entonces en las definiciones de recursos, donde
  el nombre sí aparece.
- **Mutación: diecisiete, las diecisiete muertas.**

### Fase 7.3 — tres modos de cobro, y el sistema solo conocía uno
- **El único que existía era «paga todo el cliente al operador».** Los otros dos
  —cobra el punto de venta y debe el neto; el vendedor retiene su comisión y el
  cliente paga el resto al subir— se parecen bastante en la pantalla de cobro y
  se distinguen un mes después, cuando alguien intenta cuadrar qué se cobró,
  quién lo tiene y a quién se le debe.
- **Se declara en TRES sitios, y cada uno tiene su motivo.** Los dos primeros
  son del CONTRATO con el tour center —la misma agencia puede cobrar ella con
  una operadora y no con otra—, así que van en la relación, al lado de
  `pricing_model` (0078) y `payment_mode` (0080). El tercero es de la PERSONA:
  un promotor retiene y el cajero del mostrador no, trabajando los dos para la
  misma operadora.
- **Y la VENTA guarda el que se le aplicó.** Es la lección de la cancelación del
  monedero (6.6): un contrato que cambia entre la venta y el cobro dejaría el
  dinero movido bajo un modo y la liquidación calculada con otro, y nadie sabría
  cuál de los dos fue el que pasó. No es escribible por CRUD — editable, se
  podría reescribir a posteriori dónde estuvo el dinero de una venta liquidada.
- **El contrato del socio gana a la ficha del vendedor, que es el orden
  contrario al que parece.** Un vendedor de un tour center que retiene puede
  existir, pero mientras el contrato diga que cobra el punto de venta, el dinero
  es del mostrador y no suyo: dejar que su ficha gane haría que retuviera de un
  dinero que la operadora nunca va a ver pasar.
- **`pos_collects` no cabe en una ficha de persona**, y el `check` de la base lo
  impide: el punto de venta es el tour center, no el vendedor. Ofrecerlo en su
  ficha invitaría a declarar ahí algo que luego decide el contrato, y las dos
  declaraciones acabarían discrepando.
- **La comisión retenida nunca pasa del total.** Con una comisión mal
  configurada —un porcentaje de más, una regla fija por encima del precio— el
  vendedor retendría más de lo que cobró y el cliente subiría a la guagua con
  saldo NEGATIVO: con dinero a devolver por una excursión que aún no ha hecho.
- **Lo desconocido es «paga el cliente al operador»**, en las tres columnas. Es
  lo que el sistema hace hoy con absolutamente todas las ventas; nacer en otro
  modo cambiaría de golpe, el día del despliegue, dónde está el dinero de todo
  lo que ya existe. La venta admite nulo a propósito: rellenar un histórico con
  un modo que nadie declaró sería afirmar algo sobre ventas viejas que nadie
  comprobó.
- **Dos guardas no mordían.** Una rebanaba el recurso de la venta desde
  `  order: {`, que sale ANTES en el fichero como expansión de otro recurso —la
  guarda leía cincuenta líneas por encima del recurso que quería mirar y daba
  por buena una lista de escribibles que ni había visto. La otra no existía: un
  campo del formulario que el recurso no acepta se rellena, se guarda sin
  quejarse y no cambia nada, que es el mismo silencio de `authorized_products`
  antes de 6.1.
- **Mutación: catorce, las catorce muertas.**

### Fase 7.4 — la comisión retenida: o las dos cosas, o ninguna
- **El criterio del plan no se puede cumplir desde la aplicación.** El cliente
  de Supabase habla por HTTP y cada inserción es su propia transacción: entre
  marcar la comisión como cobrada y apuntar el movimiento de caja cabe un fallo
  de red, un reinicio del proceso y un despliegue. Y una compensación —«si falla
  la segunda, deshaz la primera»— es otro par de pasos que también puede
  quedarse a medias.
- **Los dos finales malos, y los dos son caros.** Si se apunta el movimiento y
  falla la comisión, el vendedor se llevó su dinero y la comisión sigue en
  `pending`: **entra en la liquidación del mes y se le paga otra vez**. Si se
  marca la comisión y falla el movimiento, el arqueo del turno cuadra de menos y
  el vendedor aparece debiendo un dinero que ya era suyo. Ninguno se ve el día
  de la venta: el primero se ve pagando dos veces, el segundo discutiendo un
  descuadre.
- **Así que las dos inserciones viven en una función de Postgres** (0083), como
  ya hacía `reserve_departure_capacity` con el cupo, y la aplicación solo la
  llama. La comisión **nace** en `paid`: crearla pendiente para actualizarla
  después son otra vez dos pasos, y el hueco entre ellos es exactamente por
  donde se cuela la liquidación que la paga por segunda vez.
- **El movimiento es un `withdrawal`, no un cobro negativo.** El depósito del
  turista entra como venta por su camino normal; esto es la parte que el
  vendedor no entrega. Así el turno cuadra solo: entró el depósito, salió la
  comisión, y lo que queda por entregar es la diferencia.
- **Una reserva se retiene UNA vez.** El `for update` sobre el turno serializa
  a dos peticiones simultáneas —el doble clic de siempre— y la segunda encuentra
  ya escrita la retención de la primera. Y una comisión cobrada **sin** su
  movimiento no se tapa con otro apunte: esa combinación solo puede venir de una
  escritura por fuera, así que se para y se avisa.
- **La función falla CERRADA.** Es `security definer`, así que se salta la RLS:
  el ámbito se comprueba a mano dentro, y `anon` y `authenticated` no pueden
  llamarla. Es la lección de 0017, donde dos funciones de cupo se podían invocar
  sin credenciales con solo el uuid de una salida de otro tenant.
- **Los datos van en UN objeto y no en trece argumentos.** Con trece —cinco
  `uuid` seguidos— intercambiar dos compila, se ejecuta y escribe la comisión de
  otro vendedor sobre otra reserva sin que nada se queje. Misma razón por la que
  el ámbito del vendedor dejó de recibir cuatro cadenas en fila.
- **Sin turno abierto NO se retiene, y no se inventa uno.** El dinero que el
  vendedor se queda tiene que salir de algún arqueo, o al cerrar el día nadie
  sabe cuánto entregó y cuánto se quedó. Sin turno, la comisión sigue su camino
  normal y se liquida a fin de mes: peor para él, pero es lo único que no
  descuadra nada.
- **Y si la retención falla, la comisión no se escribe por el camino normal.**
  Quedaría pendiente una comisión que quizá ya se retiró, que es el mismo pago
  doble con otro disfraz.
- **Se cuentan las comisiones ESCRITAS, no las calculadas.** La función devolvía
  `resolved.length`; con la retención hay caminos donde una comisión calculada
  no llega a escribirse, y ese número lo usa quien llama para el registro de la
  venta.
- **Una clave `functions:` en el verificador de migraciones se quitó antes de
  nacer**: ese script solo sabe de tablas y columnas, así que habría sido
  exactamente el adorno que media auditoría lleva quitando. Que la función
  exista y que `anon` no la pueda llamar se comprueba contra la base de verdad,
  en la verificación de su parte del editor.
- **Dos guardas no mordían**, las dos de familias ya conocidas: una comprobaba
  que la palabra `insert into cash_movement (` estuviera, no que la inserción
  llegara a su `returning`; la otra daba por bueno un turno inventado porque
  `... || "cs-inventada"` es un prefijo válido de lo que buscaba.
- **Mutación: dieciocho, las dieciocho muertas.**

### Fase 7.5 — el turno del vendedor, que no podía existir
- **Las rutas de caja pedían rango `cashier`, y un `seller` está por debajo.**
  Así que el promotor de playa —la persona entera para la que existe el modo
  «retiene su comisión»— no podía abrir un turno; y sin turno no hay dónde
  apuntar lo que se queda ni con qué cuadrar al final del día. Se llevaba en una
  libreta, como el cupo antes de 6.4 y el saldo antes de 6.6.
- **La exención es la mínima**: un vendedor opera la caja cuyo `seller_id` es el
  suyo, y ninguna otra. No es un rango nuevo ni una excepción por rol — es la
  misma regla de propiedad que ya decide todo lo demás en ese módulo, y por eso
  vive en él y no repartida por las rutas.
- **Y está escrita en el sentido que perdona el olvido.** `exigeRangoDeCaja`
  devuelve `true` cuando hace falta el rango, así que quien llama escribe
  `if (exige…) requireAtLeast(…)`: olvidarse deja la ruta **cerrada**. Con el
  sentido contrario, olvidarse la dejaría abierta de par en par.
- **Un retiro con comisión no es un retiro a secas.** Los dos sacan dinero del
  cajón, pero el primero es lo que el vendedor se quedó y no tiene que entregar.
  Mezclarlos le dice que entregue de más y, al cuadrar, le apunta el descuadre a
  él. Ahora tiene su propia línea — y sigue restando del esperado, porque lo que
  cambia es qué se le enseña, no cuánto hay en la caja.
- **`/dashboard/mi-espacio/turno` cuadra por medio de pago**, que es el criterio
  del plan: lo cobrado en efectivo, lo que entró por tarjeta y transferencia
  —que no está en su bolsillo y por eso se dice—, lo que se quedó de comisión y
  lo que le toca entregar.
- **Y no recalcula la resta.** Lo que entrega es el ESPERADO del arqueo, que ya
  lleva restada su comisión: rehacer la cuenta en la pantalla serían dos cuentas
  del mismo dinero, y la que se equivoque decide lo que el vendedor pone sobre
  la mesa. Tampoco vuelve a filtrar por vendedor en el navegador — un segundo
  filtro en el cliente es una segunda definición de «lo mío», y además es la que
  cualquiera puede quitar desde la consola.
- **Una guarda existente lo paró**: una pantalla que enseña registros sin decir
  cómo se crean. Y tiene razón — el vendedor no abre su propio turno, se lo abre
  quien le entrega el fondo. Queda apuntado con ese motivo, porque un botón de
  «abrir turno» aquí le dejaría declararse el fondo de apertura contra el que
  luego se le cuadra.
- **Mutación: catorce, las catorce muertas.**

### Fase 8.1 — el rol nuevo habría entrado como vendedor
- **Lo que el plan mandaba hacer antes de crear el rol era auditar**, y la
  auditoría encontró esto: `auth-context` guardaba su propia lista de roles
  válidos, y lo que hacía con lo que no reconocía **no era rechazarlo: lo
  convertía en `seller`**. Añadir el rol de proveedor a la base sin acordarse de
  esa línea no lo habría dejado fuera — lo habría **ascendido al rango 20**, el
  que abre las veintiuna rutas que exigen vendedor: cotizar, cobrar, cancelar y
  reprogramar. Y nada habría fallado por el camino.
- **Ahora la lista sale de la tabla de rango y lo desconocido cae al último.**
  Si alguien se queda fuera se ve el primer día; al revés no se ve nunca. La
  prueba que decía «cae a vendedor» decía el fallo, no el contrato.
- **Había TRES tablas de rango**, idénticas y separadas: `tenant.ts` decidía los
  permisos, `nav.ts` qué entradas de menú se ven y `notify.ts` a quién alcanza un
  aviso. Copiadas, así que coincidían; separadas, así que el día que alguien
  añadiera un rol coincidirían dos de tres. Y la discrepancia no se ve: un rol
  que en `tenant` está por debajo del vendedor y en `nav` por encima enseña un
  menú que lleva a un 403 — al revés, esconde una pantalla que la ruta sí sirve.
  Viven en `roles.ts`, que es puro y lo puede importar cualquiera: esa era la
  razón técnica de las tres copias.
- **«No es socio» dejó de querer decir «es interno».** Con el tercer actor,
  `!esDeSocio(ctx)` pasó de «es de la operadora» a «es de la operadora O es un
  proveedor», y esa frase decidía en tres sitios: el recorte de campos, el
  portal B2B y **la lista blanca de exportación** — donde un proveedor habría
  caído en la rama de la operadora y se habría llevado el juego de columnas
  interno. Se pregunta en positivo (`esInterno`) para que no cambie de
  significado cuando llegue el cuarto.
- **El proveedor se reconoce por su IDENTIFICADOR desde el primer día.** El
  aislamiento del socio se escribió comparando el nombre del rol y costó una
  fase entera (4.2) sacarlo de veintinueve sitios; éste nace con la regla buena.
- **Y su vigencia se comprueba en cada petición, fallando cerrado.** Aquí importa
  más que en el vendedor: lo que hay al otro lado son datos personales de
  terceros — una hoja de ruta es una lista de clientes con hotel, habitación y
  teléfono. Si un fallo de red devolviera «sigue siendo proveedor», un
  transportista desactivado seguiría viéndolas.
- **UNA MUTACIÓN APUNTÓ MAL Y DESTAPÓ UN HUECO REAL.** El texto que quería
  romper en la comprobación del proveedor aparecía antes, idéntico, en
  `loadSellerId`, así que el mutador rompió esa otra y **las pruebas pasaron
  igual**: sin `user_id`, esa consulta devuelve la primera ficha de vendedor
  activa de la empresa y se la cuelga a quien sea —sus ventas, sus comisiones,
  su ámbito—. Lleva ahí desde la fase 1 sin nada que la sujete. Ahora tiene su
  guarda.
- **Alcance decidido, y por qué así.** `supplier.supplier_type` ya distingue
  transporte, restaurante, embarcación, parque, guías, hotel y equipos desde
  0009, así que servir a todos no cuesta nada más que a uno — que es lo que el
  propio plan apuntaba al dejar la decisión abierta. Si la operadora quiere
  limitarlo a transporte, es una línea de filtro, no un rediseño.
- **El portal nace con su guarda en el layout**, que es la norma que el plan
  fija para toda pantalla de actor externo, y con una sola entrada: sus
  servicios llegan en la entrega siguiente, y un menú lleno de enlaces a
  pantallas que no existen es peor que uno corto.
- **Mutación: dieciocho, las dieciocho muertas.**

### Fase 8.2 — el proveedor solo ve lo suyo, y se filtra por columna
- **El vínculo existía, pero de LADO.** Un recurso de salida apunta a un
  vehículo o a una persona, y son ELLOS los que cuelgan del proveedor. Para
  acotar habría que filtrar por una columna de una tabla unida, y la capa de
  consulta de esta aplicación no sabe hacerlo — la misma razón por la que la
  fecha de servicio tuvo que copiarse a `commission` en 0070.
- **Y el riesgo de no desnormalizar es peor que la incomodidad**: un filtro
  sobre una columna que no existe **no da error, devuelve la empresa entera**.
  Es el «fallo silencioso» que el plan marca como riesgo transversal, y aquí lo
  que se devolvería son los clientes de otro proveedor con su hotel, su
  habitación y su teléfono.
- **Lo rellena un disparador, no quien escribe.** Un dato desnormalizado que se
  copia a mano se queda viejo el día que alguien cambie el vehículo desde otra
  pantalla, y en esta tabla «ver» significa leer datos personales de terceros.
- **Manda el vehículo; sin vehículo, la persona.** Con un autobús de A y un
  chofer de B, la ruta queda de A y el chofer de B no la ve. Es deliberado:
  enseñar de menos en una pantalla llena de datos de clientes se arregla con una
  llamada; enseñar de más, no.
- **La compuerta se evalúa ANTES del ámbito**, que es el primer riesgo
  transversal del plan: meter una tabla en el ámbito de un actor no la abre,
  porque `READ_ROLE` rechaza por rango antes de que el filtro por fila llegue a
  aplicarse — y el proveedor tiene el rango más bajo que hay, así que le pasaría
  con todas. La exención no sube el rango: salta la compuerta y deja decidir a
  `supplierScopeFor`, que **deniega por defecto**.
- **El ámbito se ACUMULA, no se elige.** Tercer actor en `row-scope`, misma
  regla: un `if/else if` aplicaría solo el primero el día que alguien sea las
  dos cosas. Y en las dos funciones, porque el filtro del listado no protege el
  detalle.
- **LISTA BLANCA de campos, al revés que con el socio.** Al socio se le esconden
  campos concretos, que es razonable para dos notas internas. Aquí no: las
  tablas que el proveedor ve crecen con cada entrega, y con lista negra **cada
  columna nueva sale por omisión** — una columna nueva en una ruta de recogida
  es un teléfono de cliente en la pantalla de un transportista. Una tabla sin
  lista declarada devuelve filas **vacías**: el proveedor se queja, que es mejor
  que recibirlas enteras y que no se entere nadie.
- **No entra el coste de su línea** ni su moneda: lo que la operadora le paga se
  ve en su estado de cuenta, con su detalle y su forma de discutirlo, no
  colgando de cada fila. Ni el saldo en su ficha, ni las notas internas — que es
  donde alguien escribe «este chofer llegó tarde dos veces».
- **`hasHiddenFields` no tenía ningún llamante**, y la tentación evidente
  —`if (!hasHiddenFields(t)) devolver tal cual`— sería un agujero con el eje de
  lista blanca: una tabla sin nada declarado es justo la que MÁS hay que
  recortar. Queda escrito en la propia función.
- **Y lo que ya existía se rellena**, copiando lo que el vínculo de lado ya dice
  hoy. Sin eso, el primer proveedor que entre ve su portal vacío aunque lleve
  seis meses conduciendo.
- **Dos guardas no mordían**: una comprobaba que el disparador existiera y que
  sus dos ramas estuvieran, pero no que ASIGNARA —el disparador seguiría
  creándose, correría en cada escritura y no haría nada—; la otra buscaba la
  condición del relleno con `toMatch` y le bastaba con que una de las cuatro
  pasadas la conservara.
- **Mutación: quince, las quince muertas.**

### Fase 8.3 — el portal del proveedor: lo que le toca hacer, y cuándo
- **Un recurso de salida no sabe CUÁNDO es.** La fecha vive en
  `departure.departure_at`, tabla unida, y la capa de consulta no sabe filtrar
  ni ordenar por ahí — exactamente lo que obligó a copiar la fecha de servicio a
  `commission` en 0070 y el proveedor a estas dos tablas en 0085. Tercera vez, y
  ya es un patrón con nombre: **se desnormaliza aquello por lo que se filtra**.
- **Lo que se hace hoy sin la columna está escrito**, en `asset-impact.ts`:
  pedir quinientas filas y filtrar por fecha **en memoria**. Funciona hasta la
  fila quinientos uno, que desaparece sin que nada avise. En el portal del
  proveedor esa fila es un servicio que alguien tiene que ir a prestar.
- **0086 la copia, y en DOS mitades.** Una la rellena al escribir la fila; la
  otra la mueve cuando la salida se reprograma. Con solo la primera, el
  proveedor vería el servicio el día que no es, o dejaría de verlo en
  «próximos» estando todavía por delante.
- **Y aquí la fecha SÍ se mueve, al revés que la de la comisión.** En 0070 se
  copia una vez y no se toca a propósito: reprogramar cambiaría el período de
  liquidación de un dinero ya devengado. Aquí no hay dinero devengado, hay una
  guagua que tiene que estar en un sitio a una hora.
- **Dos tablas, una lista.** El proveedor aparece en la operación por dos sitios
  —como recurso de una salida y como dueño de una ruta de recogida— y para él
  son la misma cosa: cosas que tiene que ir a hacer. Y el orden es **del
  conjunto**: vienen de dos consultas ordenadas cada una por su lado, y
  concatenarlas sin reordenar enseña todos los recursos y luego todas las rutas
  —cada bloque en orden y el conjunto en ninguno—, que es la forma de que
  alguien se salte el servicio de las nueve porque estaba debajo del de las
  cinco de la tarde.
- **El recorte va ANTES del mapeo.** El mapeo elige a mano lo que la pantalla
  pinta, así que hoy no saca nada que no deba — pero es una lista escrita por
  una persona. Pasando las filas por la lista blanca de 0085 primero, un campo
  prohibido llega ya borrado y el mapeo lo lee como `undefined`: el recorte no
  depende de que el mapeo esté bien escrito.
- **La ruta se acota por la FICHA, no por el parámetro.** Atender un
  `?supplier_id=` cuando quien pregunta es un proveedor convertiría esta ruta en
  la forma de leer los servicios del transportista de enfrente, con sus puntos
  de recogida y su número de pasajeros. El interno sí puede mirar el de otro
  —es como se atiende un «no me sale nada» por teléfono— y necesita rango.
- **El reloj entra por parámetro.** Con dos lecturas, un servicio que empieza
  justo ahora cabría en las dos listas o en ninguna. Y el que empieza
  exactamente ahora cuenta como próximo: todavía no pasó.
- **La lista blanca se comió `service_date` en cuanto existió**, que es
  precisamente lo que tiene que hacer con una columna que nadie declaró. Se
  arregló declarándola —y `product`, que la salida trae expandido— en vez de
  relajar la regla: el eje de lista blanca vale porque no tiene excepciones.
- **Y eso destapó que mi propia prueba de orden pasaba por el motivo
  equivocado.** Con la fecha recortada, todos los servicios salían con
  `service_date` nulo, `localeCompare` devolvía 0 en todas las comparaciones y
  el orden de concatenación coincidía por casualidad con el esperado. La prueba
  ahora siembra una RUTA de la una antes de un RECURSO de las cinco: es la única
  línea que distingue «ordenado» de «ordenado por bloques».
- **El doble de la base no expandía en cascada, y el proveedor de verdad sí.**
  `expandRows` recurre —salida → producto—; el doble expandía un solo nivel y la
  prueba recibía `producto: "p-1"` en vez de `"Isla Saona"`. Se arregló el
  doble, no la prueba: un doble que miente por debajo es peor que no tenerlo,
  porque convierte cada prueba que lo use en una prueba de otra cosa. Las 3034
  restantes siguieron pasando.
- **La pantalla no enseña ni un dato del pasajero.** Ni nombre, ni hotel, ni
  teléfono: existe para que sepa QUÉ tiene que hacer y CUÁNDO, no quién va
  dentro. Eso está en la hoja de ruta, que es otra pantalla, para otro momento y
  con otro ámbito. Y la guarda se escribió **sobre el tipo**, con lista exacta,
  porque buscar la palabra «hotel» a pelo se rompía con el pie de la propia
  pantalla —que dice, en castellano, dónde están esos datos— mientras dejaba
  pasar un `s.guest_phone`.
- **Mutación: veinticuatro, las veinticuatro muertas** a la primera, que es la
  primera vez en esta rama que no hubo que reforzar ninguna guarda.

### Fase 8.4 — aceptar o rechazar, con su plazo, su número y su enlace de un solo uso
- **DOS EJES, NO UNO.** `status` dice lo que la operadora sabe del recurso
  —previsto, confirmado, en conflicto—; `acceptance` dice lo que contestó el
  proveedor. Meterlo en la misma columna haría que «confirmado» quisiera decir
  dos cosas a la vez, y la primera vez que haya que decidir si sale la guagua esa
  ambigüedad se resuelve a favor de lo que le convenga al que mira.
- **Nace en `not_required`, no en `pending`.** Lo desconocido es lo de hoy: hoy
  nadie pregunta nada. Con `pending` por defecto, el despliegue convertiría de
  golpe cada recurso histórico en un servicio sin confirmar y el tablero de
  despacho amanecería en rojo por una migración. Y `not_required` es además lo
  honesto para lo que ya pasó: no es que el proveedor no contestara, es que nunca
  se le preguntó — poner `accepted` sería escribir una conformidad que nadie dio.
- **Asignar es preguntar, y lo pone la BASE.** Un disparador, no la pantalla que
  asigna: dejarlo en manos de quien escribe significa que el día que se asigne
  desde la mesa de despacho, una importación o un arreglo a mano, el servicio
  saldría sin que nadie lo hubiera pedido y el proveedor se enteraría al llegar
  el autobús.
- **EL NOMBRE DEL DISPARADOR NO ES DECORACIÓN.** Postgres dispara los `before` de
  una fila en orden ALFABÉTICO, y este tiene que correr después del de 0085, que
  es el que calcula `supplier_id`. Con cualquier otro nombre leería el proveedor
  viejo. Se llama `..._supplier_acceptance` para ordenar detrás, y **la migración
  falla si el orden deja de cumplirse** — un comentario no habría bastado para
  algo que se rompe sin que nadie lo note.
- **Y la respuesta del proveedor anterior se BORRA al reasignar.** Si A había
  aceptado y el servicio pasa a B, conservar «aceptado» deja una fila diciendo
  que hay conformidad de quien ya no tiene nada que ver con ese viaje, con su
  número de confirmación al lado.
- **El plazo nunca pasa de la salida.** Un plazo que vence después de que el
  servicio ocurra no es un plazo, es un recordatorio para después del entierro. Y
  las veinticuatro horas por defecto son el MISMO número en el disparador y en el
  dominio, con guarda: si el disparador diera veinticuatro y la pantalla dijera
  cuarenta y ocho, el proveedor leería un plazo y tendría otro.
- **QUÉ PASA AL VENCER: se declara por proveedor, con `alert` por defecto.**
  `alert` marca el servicio como vencido y avisa a operaciones, y es el de por
  omisión porque es el único que no decide nada en nombre de nadie. `tacit` —quien
  calla otorga— existe porque hay proveedores de toda la vida con los que se
  trabaja así, y aun así deja escrito que NADIE contestó: `responded_via` queda
  en «tacito», no en «enlace».
- **Y `reassign` NO es un valor declarable, a propósito.** El plan lo mencionaba
  como tercera opción; no es una política, es una función que no existe. Habría
  que elegir otro vehículo, comprobar sus documentos y sus conflictos y avisar a
  dos proveedores. Ofrecerlo como una casilla que en realidad no mueve nada sería
  peor que no ofrecerlo — y mover una guagua de verdad sin que lo decida una
  persona, peor todavía.
- **El enlace se guarda en HASH, nunca en claro**, y es deliberadamente distinto
  del token de la encuesta (0067), que sí se guarda a secas: aquel pone una nota
  a un viaje que ya terminó, este compromete a una empresa a poner un autobús con
  cuarenta personas dentro. Treinta y dos bytes de azar criptográfico, no los
  siete caracteres de la encuesta: un enlace que se puede adivinar probando es un
  enlace con el que alguien acepta servicios en nombre del transportista de
  enfrente.
- **La tabla del enlace tiene RLS encendida y CERO políticas.** No es la política
  de siempre con un filtro más: es la ausencia de política. Lo único que entra
  ahí es el cliente de servicio; ni el proveedor, ni el socio, ni el personal
  interno tienen nada que hacer leyendo material de credenciales — lo que
  necesitan saber está en la fila del recurso.
- **Contestar es UNA sola escritura, en Postgres.** Hay que gastar el enlace y
  escribir la respuesta, y partirlo en dos tiene dos formas de salir mal: marcar
  usado y fallar al escribir deja al proveedor sin poder contestar y sin constar
  que contestó; escribir y fallar al marcar usado deja el enlace vivo, y entonces
  no es de un solo uso. Misma lección que la comisión retenida en 0083. Y el
  estado del recurso se mira ANTES de gastar el enlace, para que quien ya contestó
  desde el portal lea «ya contestado» y no «este enlace no sirve».
- **ABRIR NO ES USAR.** El robot que previsualiza el enlace en WhatsApp lo abre;
  si eso lo gastara, el proveedor recibiría un enlace ya quemado por algo que él
  no pidió. Se gasta al CONTESTAR.
- **Y cada apertura se anota, incluida la de un enlace que no existe.** El intento
  fallido es el que más dice: cuarenta aperturas de un enlace inexistente desde la
  misma dirección son alguien probando. Una bitácora que solo apunta los aciertos
  no sirve para verlo.
- **El cron quería ser horario y una guarda vieja lo impidió — con razón.** El
  plan de Vercel en el que esto corre solo admite trabajos diarios; un cron más
  frecuente NO DESPLIEGA y tumba el despliegue entero, y hay una guarda escrita
  desde que pasó. Así que el barrido es diario, **y eso acota lo que puede
  prometer**: da el estado al día y el aviso de la mañana, no una alarma
  inmediata. Lo que sostiene el plazo no es el cron — `puedeResponder` lo compara
  con el reloj en cada consulta, así que un cron caído nunca permite contestar
  tarde.
- **SIETE GUARDAS PREEXISTENTES SALTARON A LA VEZ**, y las siete pedían algo real:
  la exención de CSRF y la del plan para la ruta pública, la tabla y las doce
  columnas nuevas en el verificador de migraciones, la expectativa de vigilancia
  del cron, la frecuencia del cron, y **la lista exacta de campos que escribí en
  8.3** — que obligó a declarar el eje de la respuesta a propósito en vez de
  dejarlo colarse.
- **EL DOBLE DE LA BASE ENTREGA COPIAS, y cuatro pruebas pasaron sin probar
  nada.** `db.rows()` clona, así que escribir en lo que devuelve no cambia la
  base: las cuatro pruebas que preparaban su caso así lo preparaban contra una
  copia y comprobaban el caso de partida. Se arreglaron pasando por el servicio.
  Es la misma familia que el doble que no expandía en cascada de la ola anterior:
  un doble que miente por debajo convierte cada prueba que lo use en una prueba de
  otra cosa.
- **Cinco guardas no mordieron a la primera, y las cinco eran defectos de guarda:**
  dos de «la guarda encuentra su texto en otro sitio del mismo fichero» —el `case
  when … then p_confirmation` aparece en el `update` y en el `return`, y la
  restricción de `responded_via` existe en las dos tablas—, una de `toMatch`
  donde hacían falta dos coincidencias contadas, y **una repetición exacta de la
  lección de 8.3**: la prueba comprobaba el valor POR DEFECTO del eje de
  aceptación, que es justo lo que devuelve una columna recortada por la lista
  blanca, así que pasaba idéntica con la columna borrada. Ahora comprueba un
  valor que no es el de por defecto.
- **Mutación: cincuenta y cuatro, las cincuenta y cuatro muertas.**

### La auditoría de migraciones, y el «OK» que no probaba nada
- **El pegado falló en el editor** con «syntax error at end of input» en la
  línea 0. Lo que había llegado eran solo los comentarios de cabecera, y un
  bloque de comentarios a secas es una sentencia vacía. Tres cambios: **la
  consulta va primero** y la explicación detrás del `;` final —así un pegado a
  medias todavía trae la consulta—, el fichero baja de 7,3 kB a 4 kB, y fuera
  los emoji: `⚠️` lleva detrás un selector de variación (U+FE0F) que algunos
  portapapeles parten por la mitad.
- **Y después el resumen dijo «OK» de todo, incluido 0087, y eso era falso.**
  El resumen comprueba la última COLUMNA que el fichero escribe. De 0077 en
  adelante lo que cada migración aporta son **funciones y disparadores**, que
  van al final — mientras la columna la crea la primera línea. Una migración de
  cinco partes de la que solo se ejecutó la primera salía en verde.
- **Es exactamente el fallo del que venimos**: un verde que alguien usa para
  decidir que puede desplegar, y que no había mirado lo que importa. El
  inventario no lo cubría porque sirve a `verify-migrations.mjs`, que habla por
  PostgREST y no ve los catálogos de Postgres.
- **`auditoria_funciones_N.sql`** se genera leyendo los propios ficheros de
  migración —no una lista a mano, que se quedaría atrás a la primera migración
  nueva— y comprueba cada función y cada disparador.
- **Y distingue crear de reemplazar.** `app.custom_access_token_hook` existe
  desde 0063 y `app.can_read_partner` desde 0001: verlas no prueba que 0084 o
  0072 se ejecutaran. Esas salen como «solo lo reemplaza», no como OK. Para
  saber quién define cada objeto por primera vez se leen TODAS las migraciones,
  también las anteriores a la 0021 — sin eso, `can_read_partner` parecía nacer
  en 0072 y habría dado por ejecutada una migración que igual no se ejecutó.

### Fase 8.5 — la hoja de ruta del chofer, y el despacho que solo pedía sesión
- **TRES RUTAS BAJO `/api/operations/` EXIGÍAN SESIÓN Y NADA MÁS**: el despacho
  del día, rehacer las rutas de recogida y la hoja de ruta. Lo que devuelven o
  mueven son los clientes del día con su hotel, y a qué hora pasa el transporte
  a buscarlos.
- **Y `loadRunSheet` no recibía ningún actor.** `loadRunSheet(companyId, routeId)`
  devolvía, por parada, el nombre del cliente, su hotel, su habitación y su
  teléfono, de CUALQUIER ruta que se le pidiera. Mientras los únicos con sesión
  eran empleados de la operadora eso era un permiso que faltaba; desde 0073 hay
  tour centers con cuenta y desde 0084 proveedores, así que era **la lista de
  clientes de la operadora a un identificador de distancia** — y en manos del
  actor con más datos de terceros a tiro.
- **El ámbito va en el SERVICIO, no en la ruta HTTP.** La hoja se lee desde la
  pantalla interna y desde el portal del proveedor: una comprobación por
  llamante es una comprobación que alguien se deja.
- **Y se comprueba por INVENTARIO**, no ruta por ruta: lo que se cierra no son
  tres ficheros, es la idea de que bajo `operations/` vive lo de la casa. Rango
  de operaciones y nada de actores externos, comprobado recorriendo el
  directorio.
- **Aquí SÍ salen los datos del cliente, y es deliberado.** En «Mis servicios»
  no sale ni un nombre, y es correcto: allí el proveedor mira qué le toca hacer.
  En la hoja de ruta está recogiendo a esas personas, así que necesita saber a
  quién busca, en qué habitación está y a qué teléfono llamar. Lo que se acota
  no es esconder campos: es **cuándo y cuánto**.
- **Solo sus rutas, y solo alrededor del servicio.** Doce horas por delante y
  doce por detrás. Sin ventana, la hoja de ruta no es la hoja del día: es el
  histórico de clientes de la operadora, con teléfono, descargable cuando
  quiera. Y **una ruta sin fecha NO abre** — lo contrario de lo que pide el
  cuerpo, porque «sin fecha» querría decir «siempre».
- **Cada apertura del proveedor queda anotada, no solo las que fallan.** Es una
  lectura de datos personales de gente que no es suya, y una bitácora que solo
  apunta los intentos fallidos no responde «quién vio esta lista», que es la
  única pregunta que se hace cuando un teléfono se filtra.
- **De quién es cada parada, POR COLUMNA.** Cuarta vez que aparece el patrón
  —la fecha de la comisión (0070), el proveedor en recursos (0085), la fecha de
  servicio (0086)—: un filtro sobre una columna que no existe no da error,
  devuelve la empresa entera. Aquí eso serían los clientes del día de todos los
  proveedores. Con las dos mitades del disparador, porque reasignar una ruta
  tiene que llevarse sus paradas: si no, el chofer anterior sigue viendo los
  clientes de un servicio que ya no es suyo.
- **«RECOGIDO» Y «NO-SHOW» ESTABAN EN EL ESQUEMA DESDE 0011 Y NADIE LOS
  ESCRIBÍA.** La operadora se enteraba de que un cliente no bajó cuando ese
  cliente llamaba a reclamar. Ahora se marcan desde el móvil del chofer, con la
  hora y con el nombre de quien marcó (0088).
- **Y un no-show no es un dato, es una ACUSACIÓN**: dice que alguien pagó, no se
  presentó y no le toca reembolso. Por eso se guarda la hora al lado de la
  prevista —que es lo que dice si se esperó—, se anota con severidad de aviso, y
  **no se bloquea** marcarlo antes de tiempo: un chofer que no puede marcar deja
  la hoja a medias y la operadora se queda sin saber qué pasó, que es peor que
  una marca temprana anotada como tal.
- **Sin hora prevista, no se dice que no esperó.** `null` y no `false`: inventar
  esa respuesta sería inventar la acusación que luego se discute.
- **Cancelar no es del chofer.** Solo dos marcas. Una parada cancelada no se
  marca: el cliente avisó, y ponerle un no-show le cuelga un incumplimiento a
  quien hizo las cosas bien.
- **La pantalla es de pulgar, no de ratón.** El chofer está parado en la puerta
  de un hotel a las siete de la mañana con una mano en el volante: bloques
  grandes y dos botones grandes, no filas de tabla. Y el teléfono es un enlace
  `tel:`, porque con el motor encendido copiar un número no es una opción.
- **Una prueba mía volvió a pasar por el motivo equivocado.** La del orden de
  las paradas: los datos sembrados ya venían ordenados, así que pasaba idéntica
  con el orden quitado. Ahora siembra una parada SIN secuencia y con la hora más
  temprana de todas —la consulta la devuelve primero y tiene que salir la
  última—. Es la tercera ola seguida en que aparece la misma familia.
- **Mutación: cuarenta y una, las cuarenta y una muertas.**
