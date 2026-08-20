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
| ID | Acción | Sev | Riesgo | Estado |
|---|---|---|---|---|
| S1 | Eliminar 8 dependencias muertas (`jsonwebtoken`, `bcrypt`, `pino`, `pino-pretty`, `ai`, `cookies-next`, `kill-port`, `date-fns` + `@types`) | P2 | Bajo | ✅ HECHO |
| S4 | Tests unit de `pricing`, `commission-engine`, `codes`, `format` (Vitest, 30 tests) | P1 | Bajo | ✅ HECHO |
| S6 | CI en GitHub Actions: install/lint/typecheck/test/build + guard service-role | P1 | Bajo | ✅ HECHO |
| S7 | `.env.example` documentado sin secretos (Fase 13) | P2 | Bajo | ✅ HECHO |
| S2 | Ajustar Stripe a Node (quitar `createFetchHttpClient`/`cryptoProvider`) | P2 | Bajo | ⏳ en cutover Vercel (M7) |
| S5 | Integrar Sentry | P1 | Bajo | ⏳ en cutover Vercel (M7) — integración nativa, evita conflicto con OpenNext |
| S3 | `tsconfig` `strict` progresivo en módulos financieros | P2 | Medio | ⏳ pendiente |
| S8 | Tests de `availability`/`ledger` (requieren mock de BD más elaborado) | P1 | Bajo | ⏳ pendiente |

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
