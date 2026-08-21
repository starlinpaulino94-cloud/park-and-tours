# Testing Audit

Fecha: 2026-08-21.

## Verificaciones Ejecutadas

- `npm test`: PASS, 9 test files, 69 tests.
- `npm run check-types-errors`: PASS.
- `node scripts/migrate/validate-specs.mjs scripts/migrate/schema-columns.json`: PASS, 80 tablas.
- `node --check` sobre scripts de migracion: PASS.

## Cobertura Real Detectada

Tests existentes concentrados en:
- `pricing`
- `commission-engine`
- `codes`
- `format`
- Supabase query translator/storage/auth-context
- data backend switch
- ETL transform

## Hallazgos

### TEST-001 — No hay E2E verificado

Severity: P1.

Evidence: no se detecto `playwright.config.*` ni `cypress.config.*`.

Impacto: login, reserva, pago, check-in, caja y permisos no tienen prueba end-to-end.

Solucion: Playwright minimo para flujos P0/P1.

### TEST-002 — No hay pruebas de integracion API/DB reales

Severity: P1.

Evidence: tests actuales son unitarios/pure helpers principalmente.

Impacto: APIs criticas pueden fallar en runtime aunque unit tests pasen.

Solucion: tests con DB/Supabase local o mocks contractuales fuertes para pagos/reservas/auth/storage.

### TEST-003 — No hay pruebas de concurrencia

Severity: P1.

Evidence: no se detectaron tests que simulen dos usuarios sobre cupo/pago/caja.

Impacto: race conditions no detectadas.

Solucion: tests concurrentes para cupo=1, idempotency key, caja abierta, voucher redemption.

### TEST-004 — Lint no esta disponible como script npm

Severity: P2.

Evidence: `package.json` no tiene script `lint`; CI usa `npx next lint`.

Impacto: CI puede fallar por comando obsoleto/inconsistente o no representar politica local.

Solucion: definir `npm run lint` cuando se endurezca ESLint.

### TEST-005 — TypeScript no estricto reduce valor del typecheck

Severity: P2.

Evidence: `tsconfig.json` con `strict: false` y `noImplicitAny: false`.

Impacto: typecheck PASS no equivale a contratos seguros.

Solucion: strict por fases.

## Testing Pyramid Requerida

- Unit: pricing, commission, currency, id generation, validation schemas.
- Integration: API routes P0/P1, Supabase RLS, Totalum/Supabase provider parity.
- E2E: login, POS/reserva, pago, check-in, portal partner, superadmin.
- Failure testing: provider timeout, duplicate webhook, DB unavailable, invalid payload.

## Gate Testing

NO PASS para produccion completa. PASS parcial para unit tests actuales.
