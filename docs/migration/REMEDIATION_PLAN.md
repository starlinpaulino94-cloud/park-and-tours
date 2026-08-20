# REMEDIATION_PLAN.md — Estabilización Park & Tours

> **Plan de remediación/estabilización** paralelo y previo a la migración de datos. Orden por severidad. No incluye estética hasta cerrar P0/P1.
> Ver el plan de migración de motor en `MIGRATION_PLAN.md`.

## Principios
- **No refactor por refactor.** Cada cambio responde a bug/riesgo/dependencia/duplicación/seguridad/escalabilidad.
- **Proteger lo que funciona.** La lógica de `src/lib/*-service.ts`, la remediación previa (PR #1) y la separación de capas se conservan.
- **Nada destructivo sin backup + rollback.**

## Fase 0 — Protección (HECHO)
- [x] Proyecto versionado en Git; estado registrado.
- [x] Rama de estabilización desde `main` actualizado.
- [x] `.gitignore` protege `.env`/`.envProd`/`node_modules`/`.next`/`.open-next`; sin `.env` versionado; sin secretos en `src/`.
- [ ] `.env.example` documentado (Fase 13 de migración).
- [ ] Backup verificado de datos Totalum antes de cualquier ETL.

## Estabilización que NO depende de la migración (se puede hacer ya)
| ID | Acción | Sev | Riesgo |
|---|---|---|---|
| S1 | Eliminar 10 dependencias muertas (`jsonwebtoken`, `bcrypt`, `pino`, `pino-pretty`, `ai`, `cookies-next`, `kill-port`, `date-fns` + `@types`) | P2 | Bajo |
| S2 | Ajustar Stripe a Node (quitar `createFetchHttpClient`/`cryptoProvider`) — **solo al migrar a Vercel** | P2 | Bajo |
| S3 | Activar `tsconfig` `strict` progresivamente en módulos financieros (pricing/commission/ledger) | P2 | Medio |
| S4 | Tests unit de `pricing`, `commission-engine`, `availability`, `ledger` (lógica pura, sin BD) | P1 | Bajo |
| S5 | Integrar Sentry en `instrumentation.ts` | P1 | Bajo |
| S6 | CI en GitHub Actions: install/lint/typecheck/test/build | P1 | Bajo |

Nota: S4/S5/S6 aportan valor inmediato y **son independientes de Totalum vs Supabase** — buenos primeros pasos de bajo riesgo mientras se prepara la migración.

## Estabilización que se resuelve CON la migración
- Transacciones reales (concurrency-safe bookings) → al pasar `booking-service.ts` a Postgres.
- FK/UNIQUE/índices/RLS → al crear el esquema Postgres.
- Storage seguro → al construir el flujo de upload sobre Supabase Storage.
- Verificación email/reset password → nativo Supabase Auth.

## Orden recomendado
1. S4 + S5 + S6 (tests base + observabilidad + CI) — bajo riesgo, alto valor, sin tocar datos.
2. S1 (limpieza de deps muertas).
3. Migración de motor por fases (ver `MIGRATION_PLAN.md`).
4. S2 + S3 durante/después del corte a Vercel.
