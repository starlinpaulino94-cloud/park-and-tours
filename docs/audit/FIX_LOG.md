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
