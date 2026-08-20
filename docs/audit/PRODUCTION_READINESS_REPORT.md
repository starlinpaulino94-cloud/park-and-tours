# PRODUCTION_READINESS_REPORT.md — Park & Tours

> **Fase 29/30 — Informe de preparación para producción**, evaluado contra la arquitectura objetivo (Supabase + Vercel) y el estado actual (Totalum + Cloudflare).
> Fecha: 2026-08-20. Complementa la auditoría funcional previa (`AUDIT_REPORT.md`, `VALIDATION.md`, ya remediada en `main`).

## Respuestas directas

| Pregunta | Respuesta hoy | Tras la migración (objetivo) |
|---|---|---|
| ¿Existen dependencias activas de Totalum? | **Sí** — 90 callsites, auth, storage, esquema | No (grep = 0) |
| ¿Supabase es la fuente de verdad? | **No** — Totalum lo es | Sí (Postgres) |
| ¿Existe aislamiento multi-tenant? | Parcial — **solo en aplicación** | Sí — RLS + app + UI |
| ¿Los permisos son seguros? | Sí a nivel app (RBAC remediado) | Sí + RLS estructural |
| ¿La BD está bien estructurada? | **No** — sin FK/UNIQUE/índices/RLS | Sí |
| ¿Existen migraciones? | **No** — script imperativo | Sí (Supabase CLI en Git) |
| ¿Flujos críticos con tests? | **No** — cero cobertura | Sí (unit + integration + E2E) |
| ¿Cálculos financieros validados? | Parcial (lógica canónica, sin tests) | Sí (tests sobre pricing/comisiones/settlements) |
| ¿Reservas concurrency-safe? | **Mitigado, no garantizado** (sin transacciones) | Sí (transacción + constraint) |
| ¿Pagos idempotentes? | Sí (clave de idempotencia, remediado) | Sí + unicidad en BD |
| ¿Tickets seguros? | Sí (código CSPRNG, sin PII en QR) | Sí + estados en BD |
| ¿Existe observabilidad? | **No** — sin Sentry, logger custom | Sí (Sentry + audit_log + Vercel logs) |
| ¿Deployment reproducible? | Parcial — build CF manual | Sí (GitHub → Vercel + migraciones CI) |
| ¿Existe rollback? | **No** definido | Sí (backups Supabase + revert de deploy) |
| ¿Preparado para producción? | **NO** para la arquitectura objetivo | Objetivo tras completar las 30 fases |

## Veredicto

> **NO — no está preparado para producción como sistema controlado.**
>
> El sistema **funciona** hoy sobre Totalum/Cloudflare y los defectos funcionales fueron remediados (es apto para un piloto controlado *sobre Totalum*). Pero **NO cumple los objetivos de este encargo**: no es un sistema del que seamos dueños de la fuente de verdad, no tiene aislamiento en BD, ni migraciones, ni tests, ni observabilidad, ni deployment reproducible. La preparación para producción se alcanza al completar la migración a Supabase + Vercel con sus gates.

## Gates de producción (estado)

| Gate | Ítem | Estado |
|---|---|---|
| **1 — Build** | Build ✅ · Typecheck ✅ · Lint ✅ | **PASA** (Cloudflare); revalidar en Vercel |
| **2 — Database** | Migrations ❌ · Constraints ❌ · Indexes ❌ · RLS ❌ · Backup ❌ | **FALLA** |
| **3 — Security** | Auth ⚠️ · Authorization ✅ · Tenant isolation ⚠️ (solo app) · Secrets ✅ · Storage security ❌ | **PARCIAL** |
| **4 — Business** | Bookings ✅ · Availability ⚠️ (sin locks) · Payments ✅ · Tickets ✅ · Commissions ✅ · Settlements ✅ | **PARCIAL** |
| **5 — Tests** | Unit ❌ · Integration ❌ · E2E ❌ | **FALLA** |
| **6 — Operations** | Monitoring ❌ · Logging ⚠️ · Audit trail ✅ · Error handling ⚠️ | **FALLA** |
| **7 — Deployment** | GitHub ✅ · Vercel Preview ❌ · Vercel Prod ❌ · Env vars ⚠️ · Rollback ❌ | **FALLA** |

## Health Score (justificado, sin maquillar)

| Dimensión | /100 | Justificación |
|---|---:|---|
| Architecture | 55 | Buena separación de capas y lógica canónica; atada a BaaS propietario y Cloudflare; 84 callsites saltan el data-access. |
| Database | 25 | Sin FK, UNIQUE, índices, migraciones ni RLS. Dominio bien modelado pero motor inadecuado. |
| Multi-tenancy | 55 | Correcto entre empresas a nivel app; sin RLS; depende de disciplina en callsites directos. |
| Security | 58 | RBAC remediado, sin secretos en repo; falta RLS, verificación email/reset, storage security. |
| Business Logic | 70 | Lógica canónica sólida (pricing/comisiones/ledger/settlements), remediada; sin tests que la respalden; sin transacciones. |
| Testing | 5 | Sin tests de ningún tipo. |
| Observability | 20 | Sin Sentry ni tracing; logger custom sobre `console`; hay `audit_log`. |
| Performance | 45 | Sin índices, límites fijos altos, agregación en JS; N+1 en recálculos. |
| Maintainability | 55 | Código legible y consistente; ~25 módulos incompletos, dependencias muertas, TS `strict:false`. |
| Deployment | 40 | GitHub + CI mínima; build CF; sin Preview/Prod en Vercel ni rollback. |
| **Production Ready** | **30** | Funciona pero no cumple los objetivos de control, integridad, tests y observabilidad. |

## Clasificación de problemas (para el orden de trabajo)

- **P0:** (1) Aislamiento no está en BD (RLS ausente); (2) sin transacciones (concurrencia); (3) dependencia total de Totalum como fuente de verdad; (4) sin backups/rollback antes de migrar datos.
- **P1:** sin migraciones versionadas; sin FK/UNIQUE/índices; sin tests de flujos críticos; sin observabilidad; storage sin construir.
- **P2:** `user` mezcla identidad/negocio; acoplamiento Cloudflare; TS `strict:false`; dependencias muertas.
- **P3/P4:** módulos incompletos (read-only), documentación, limpieza.

No se aborda nada P3/P4 (estética/limpieza) mientras haya P0/P1 abiertos.

## Recomendación

Proceder con el **Migration Plan** (`../migration/MIGRATION_PLAN.md`) por fases, con **backup y reconciliación** antes de cualquier cutover, sin big-bang. El sistema actual se mantiene operativo hasta que Supabase esté validado como fuente de verdad de todos los flujos críticos.
