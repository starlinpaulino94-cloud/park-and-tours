# Security Audit

Fecha: 2026-08-21.

## Resultado

PRODUCTION SECURITY: NO PASS.

El sistema tiene controles importantes, pero mantiene riesgos P0/P1 antes de produccion general.

## Hallazgos

### SEC-001 — Secretos reales presentes en `.env.*` locales

Severity: P0.

Evidence:
- `.env.development` existe localmente.
- `.env.production` existe localmente.
- Contienen claves sensibles segun inspeccion de nombres, sin exponer valores.
- `.gitignore` ahora ignora `.env.production` y `.env.development`.

Impacto: compromiso de Totalum, Supabase service role, GitHub PAT o sesiones si esos archivos fueron compartidos.

Root cause: secretos operativos en archivos locales descargados.

Solucion: rotar inmediatamente claves sensibles si existe posibilidad de exposicion; usar secret manager/hosting env.

### SEC-002 — Stripe checkout publico acepta metadata y priceId del cliente

Severity: P1. Status: REMEDIATED IN CODE, pending runtime configuration.

Evidence:
- `src/app/api/stripe/create-checkout-session/route.ts:41` no exige `requireTenant()`.
- `route.ts:33-39` acepta `priceId`, `mode`, `customerEmail`, `metadata`.
- `route.ts:53-67` pasa metadata del cliente a Stripe.

Impacto: usuario puede forjar `company_id`/metadata o crear checkout con price no autorizado.

Remediacion aplicada: `create-checkout-session` ahora exige tenant admin, deriva `company_id`/`requested_by` server-side y requiere allowlist `STRIPE_ALLOWED_PRICE_IDS`.

### SEC-003 — CSRF posible con cookies `SameSite=None`

Severity: P1. Status: PARTIAL REMEDIATION.

Evidence:
- `src/lib/auth.ts:159-167` usa `sameSite: none` en HTTPS.
- `src/middleware.ts:47-51` permite CORS con credenciales para origenes permitidos.
- Mutaciones como pagos/ERP/team no validan token CSRF propio.

Impacto: POST cross-site con cookies en escenarios compatibles.

Remediacion aplicada: helper `assertSameOriginMutation` y aplicacion en pagos, Stripe checkout/customer portal y upload. Pendiente extender a todas las mutaciones internas o adoptar token CSRF.

### SEC-004 — Upload no autoriza entidad/id

Severity: P1. Status: REMEDIATED IN CODE.

Evidence:
- `src/app/api/storage/upload/route.ts:21-25` acepta `entity` e `id` del form.
- `route.ts:31-37` deriva path por tenant pero no verifica recurso.

Impacto: usuario autenticado puede escribir archivos bajo entidades arbitrarias dentro de su tenant.

Remediacion aplicada: upload ahora exige entidad registrada en `RESOURCES`, id real validado con `tenantFindOne`, y bucket publico requiere rol `manager` o superior.

### SEC-005 — IDs relacionados no siempre se validan

Severity: P2.

Evidence:
- `src/app/api/payments/route.ts:96-115` acepta `cash_session_id`, `booking_id`, `customer_id`, `partner_id`.
- No verifica todos los parent-child relationships antes de crear pago.

Impacto: integridad rota o asociaciones indebidas.

Solucion: resolver cada ID con `tenantFindOne` y validar consistencia.

### SEC-006 — Direct `totalumSdk` debilita autorizacion central

Severity: P2.

Evidence: llamadas directas en `booking-service.ts`, `payments/route.ts`, `team/route.ts` y otros.

Impacto: futuros cambios pueden saltar wrappers tenant-safe.

Solucion: wrappers por dominio y excepciones documentadas.

### SEC-007 — Rate limiting insuficiente fuera de auth

Severity: P2.

Evidence:
- Better Auth tiene rate limit en `src/lib/auth.ts:114-123`.
- No se verifico rate limit en upload, payments, checkout, checkin lookup.

Impacto: abuso/DoS/spam operativo.

Solucion: rate limit por IP+tenant+usuario en rutas sensibles.

### SEC-008 — CSP permite framing global

Severity: P3. Status: REMEDIATED IN CODE.

Evidence: `src/middleware.ts:59-62` usa `frame-ancestors *` y elimina `X-Frame-Options`.

Impacto: clickjacking si no es requisito de embed.

Remediacion aplicada: `frame-ancestors` ahora usa `'self'` y orígenes explícitos en `ALLOWED_FRAME_ANCESTORS`.

### SEC-009 — Errores pueden filtrar detalles internos

Severity: P2.

Evidence: `src/lib/api-response.ts` y Stripe routes serializan `responseData`/error interno.

Impacto: informacion sensible en respuestas.

Solucion: respuesta generica + requestId; log interno redactado.

## Controles Positivos

- `tenant.ts` aplica filtros tenant en wrappers.
- Stripe webhook exige firma en produccion.
- Supabase RLS/memberships existen en migraciones.
- Service role esta server-only.

## Threat Model Resumido

Assets: datos de clientes, reservas, pagos, archivos, claves service role, sesiones.

Actors: usuario autenticado, partner, admin, superadmin, atacante externo, proveedor externo.

Trust boundaries: browser/API, API/Totalum, API/Supabase service-role, Stripe webhook, Storage.

## Privacy

PII: clientes, partners, emails, telefonos, tax IDs, documentos, reservas. Clasificacion: Confidential/Sensitive. Logs y backups deben minimizar/redactar.
