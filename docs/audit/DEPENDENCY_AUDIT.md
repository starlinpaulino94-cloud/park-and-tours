# Dependency And Infrastructure Audit

Fecha: 2026-08-21.

## Package / Supply Chain

Dependencies principales:
- Next.js 15, React 19.
- Better Auth.
- Totalum SDK.
- Supabase SDK/SSR.
- Stripe.
- Radix UI/shadcn-style packages.
- Vitest.
- OpenNext Cloudflare/Wrangler.

## Hallazgos

### DEP-001 — Vulnerabilidades npm conocidas no remediadas

Severity: P1/P2.

Evidence: contexto previo indica `npm ci` detecto vulnerabilidades.

Impacto: supply chain risk.

Solucion: correr `npm audit` y remediar controladamente, sin updates automaticos no revisados.

### DEP-002 — Lockfile existe

Severity: Positive.

Evidence: `package-lock.json` presente.

Impacto: builds reproducibles con `npm ci`.

### DEP-003 — CI existe pero incompleto

Severity: P2.

Evidence: `.github/workflows/ci.yml` instala, lint, typecheck, unit tests, build y guard de service role.

Riesgo: `npx next lint` puede no ser compatible; no hay E2E, dependency scanning, SAST, secret scanning reforzado.

### DEP-004 — Deployment target mezclado

Severity: P2.

Evidence: scripts Cloudflare/OpenNext; docs planean Vercel.

Impacto: runbooks/deploy/rollback no estan cerrados.

Solucion: decidir target y documentar pipeline reproducible.

### DEP-005 — No hay estrategia formal de observabilidad externa

Severity: P1.

Evidence: no se verifico Sentry/OpenTelemetry productivo.

Impacto: incidentes dificiles de diagnosticar.

Solucion: Sentry + logs estructurados + alertas.

## External Dependency Map

| Service | Purpose | Criticality | Data stored | Fallback | Lock-in | Migration difficulty |
|---|---|---|---|---|---|---|
| Totalum | Backend actual | P0 | negocio/auth actual | ninguno completo | alto | alta |
| Supabase | DB/Auth/Storage destino | P0 | negocio/files/auth futuro | backup/restore | medio | media |
| Stripe | pagos/suscripciones | P1 | payment metadata/customer | manual reconciliation | medio | media |
| GitHub | repo/PR/CI | P1 | codigo | local clone | bajo | baja |
| Cloudflare/OpenNext | hosting actual/previsto | P1 | runtime | Vercel plan | medio | media |

## Vendor Lock-in

El mayor lock-in actual es Totalum por auth/data-access y llamadas directas. Supabase reduce lock-in al usar Postgres, pero service-role/RLS y Storage tambien requieren runbooks.

## Gate Dependencies/Infra

PARTIAL. Lockfile y CI existen, pero falta dependency scanning, secret scanning robusto, target deployment final y rollback probado.
