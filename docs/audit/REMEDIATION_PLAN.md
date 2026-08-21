# Remediation Plan

Fecha: 2026-08-21.

Regla: no big-bang rewrite. Resolver por piezas, con pruebas y revision independiente.

## Phase 0 — Data Loss / Security Blockers

1. Rotar secretos si `.env.development`/`.env.production` pudieron exponerse.
2. ✅ Proteger checkout Stripe: auth requerida, metadata server-side, allowlist de prices.
3. ⏳ Definir CSRF/Origin policy para todas las mutaciones; aplicado inicialmente a pagos, Stripe y upload.
4. ✅ Bloquear upload por entidad/id sin autorizacion.
5. ✅ Decidir uso de `frame-ancestors` y restringir CSP mediante `ALLOWED_FRAME_ANCESTORS`.

Validation: tests de seguridad basicos, revision manual, secret scan.

## Phase 1 — Architecture / Database / Auth

1. ⏳ Eliminar o encapsular direct `totalumSdk` en dominios criticos; aplicado inicialmente en el update de receivables dentro de `/api/payments`.
2. Definir dominio canonico: organization/company, order/booking, user/membership.
3. ✅ Agregar constraints/triggers tenant-aware para FKs criticas futuras (`supabase/migrations/0018_tenant_reference_integrity.sql`). Pendiente ejecutar en staging/prod y hacer reporte de datos historicos antes de constraints validadas.
4. ⛔ Completar memberships y claims JWT antes de `SUPABASE_USE_RLS=true`; `scripts/migrate/verify-memberships.mjs` reporto 5 tenants, 20 partners y 0 memberships activas/primarias. No activar Supabase Auth/RLS hasta crear memberships reales.
5. ✅ Agregar guard fail-closed: en produccion `DATA_BACKEND=supabase` requiere `SUPABASE_USE_RLS=true`.
6. Probar `DATA_BACKEND=supabase` en staging con lectura controlada.

Validation: tests de aislamiento multi-tenant y migracion parity.

## Phase 2 — Critical Business Logic

1. Reserva/cupo: usar RPC transaccional real.
2. Pagos: unique idempotency key, validacion de IDs relacionados, atomicidad con caja/receivables.
3. Ledger: outbox o reconciliacion durable.
4. Stripe webhook: idempotencia y contratos.

Validation: unit + integration + failure tests.

## Phase 3 — Concurrency / Reliability

1. Tests: cupo=1 con 2/10/100 usuarios simulados.
2. Tests: doble submit pago, doble webhook, doble check-in.
3. Timeouts para llamadas externas.
4. Backpressure para imports/reportes/uploads.

Validation: concurrency suite y chaos/failure testing controlado.

## Phase 4 — Testing

1. Playwright: login, dashboard, POS/reserva, pago, check-in, portal partner.
2. Integration tests API con DB/Supabase local.
3. Contract tests Stripe/Totalum/Supabase.
4. CI debe correr lint/typecheck/test/build/E2E smoke.

## Phase 5 — Performance

1. EXPLAIN ANALYZE de queries criticas.
2. Indices justificados.
3. Load/stress/spike/soak tests.
4. Performance budget y reportes.

## Phase 6 — Observability

1. Logger estructurado con requestId/userId/orgId sin PII excesiva.
2. Sentry o equivalente.
3. Audit log de negocio para P0/P1.
4. Alerts por error rate, pagos duplicados, webhooks fallidos, DB latency.

## Phase 7 — UX / Cleanup

1. Dividir componentes gigantes.
2. Marcar modulos partial/read-only en UI si aplica.
3. Endurecer TS/ESLint por carpetas.
4. Eliminar dead code despues de cobertura.

## First Recommended Action

Phase 0.1: rotar secretos si hubo exposicion y cerrar `create-checkout-session` publico/manipulable. Luego pagos/reservas.
