# ARCHITECTURE.md — Park & Tours

> **Fase 2 — Auditoría arquitectónica** y arquitectura objetivo. Estado actual, problemas estructurales y diseño destino Supabase + Vercel.
> Fecha: 2026-08-20.

## 1. Arquitectura actual (as-is)

```
Navegador (React 19 / Next 15 App Router)
   │  fetch → /api/*  ·  Server Components
   ▼
Next.js App Router  ── middleware.ts (CORS/CSP/cookie check)
   │
   ├─ Rutas API (src/app/api/**)  ─┐
   ├─ Server Components (dashboard)│ lógica de negocio en:
   │                               │  src/lib/*  (booking-service, pricing,
   │                               │   commission-engine, ledger, availability…)
   ▼                               │
src/lib/tenant.ts  ◀───────────────┘  (capa de acceso + aislamiento por company)
   │  totalumSdk.crud.*
   ▼
Totalum API (REST tipo Mongo)  ← base de datos + auth store + archivos
   │
   ▼
Cloudflare Workers (OpenNext)  ← hosting/runtime
```

### Qué está BIEN (conservar)
- **Capa de acceso a datos embudada**: casi todo pasa por `src/lib/tenant.ts` (`tenantQuery/Create/Update/Delete/FindOne/Count`). Esto hace la migración un *port*, no una reescritura.
- **Lógica de negocio separada en `src/lib/`**: `booking-service`, `pricing`, `commission-engine`, `ledger`, `ledger-events`, `availability`, `cash`, `inventory`. Fuente canónica server-side; los componentes no recalculan negocio crítico.
- **Capa de recursos genérica** (`resources.ts` + `/api/erp/[resource]`): CRUD uniforme con `writeRole`/`readRole`/`sanitizePayload` para 77 recursos.
- **Autorización server-side** por rol (`requireAtLeast`) y máquina de estados protegida (status fuera de `writable`).
- **RBAC + validación** ya endurecidos en la auditoría previa (ver `AUDIT_REPORT.md`).

### Problemas estructurales (P0/P1 para la migración)
| # | Problema | Severidad | Detalle |
|---|---|---|---|
| A1 | **Aislamiento multi-tenant solo en aplicación** | **P0** | `tenantQuery` inyecta `company` en TS; 84 callsites directos lo omiten. No hay RLS. Un olvido = fuga. |
| A2 | **Sin transacciones** | **P0** | Flujos multi-write (orden, pago, settlement) con compensación manual best-effort; overbooking mitigado pero no garantizado. |
| A3 | **Dependencia total de un BaaS propietario** | **P0** | Totalum es la BD, el auth store y el storage. No es fuente de verdad controlada. |
| A4 | **Sin integridad referencial ni unicidad en BD** | **P1** | `REF` son strings sin FK; `canRepeat:true` obligatorio → cero UNIQUE (suplido por `unique.ts` best-effort). |
| A5 | **Esquema no versionado como migraciones** | **P1** | El esquema se crea vía script imperativo contra la API de Totalum, no como DDL en Git con historial. |
| A6 | **Acoplamiento a Cloudflare Workers** | **P1** | OpenNext, `wrangler.jsonc`, config Stripe Workers-specific, guardas en `instrumentation.ts`. |
| A7 | **`user` mezcla identidad y negocio** | **P2** | `role/company_id/partner_id/status` viven en el registro de auth en vez de una tabla de membresías. |
| A8 | **Observabilidad pobre** | **P2** | Sin Sentry; logger custom que parchea `console`; sin tracing ni structured logging real. |
| A9 | **Sin tests** | **P1** | Nació de vibe coding; cero cobertura sobre pricing/comisiones/availability/permisos. |

## 2. Arquitectura objetivo (to-be)

```
Navegador (Next 15 / React 19)
   │  @supabase/ssr (JWT en cookie)  ·  Server Components / Server Actions
   ▼
Next.js App Router (Vercel, Node runtime)
   ├─ UI  (components)
   ├─ Application  (src/lib/*-service.ts — lógica canónica, sin cambios de dominio)
   ├─ Data access  (src/lib/db.ts — cliente Supabase + tenant.ts reescrito, misma firma)
   ▼
Supabase
   ├─ PostgreSQL  ← FUENTE DE VERDAD (FKs, constraints, índices, transacciones)
   │     └─ RLS por organization_id  (defensa en profundidad)
   ├─ Auth  (auth.users + JWT con custom claims org_id/role)
   ├─ Storage  (buckets public/private con RLS por path)
   └─ Edge Functions / pg_cron  (solo donde aporten; hoy no hay cron)
   ▼
Observabilidad: Sentry (errores) + Vercel logs + audit_log en Postgres
   ▼
GitHub (código, migraciones, tests, CI) → Vercel (Preview → Production)
```

### Principios de la arquitectura objetivo
1. **Postgres es el núcleo y la única fuente de verdad.** Supabase Auth/Storage se apoyan en él. Ninguna integración (Stripe, OTAs futuras) es fuente paralela de verdad — consumen o producen eventos.
2. **Aislamiento en tres capas**: visibilidad en frontend + autorización en servidor (`requireAtLeast`) + **RLS en BD** (nueva). El frontend nunca es el mecanismo de aislamiento.
3. **`service_role` solo en backend seguro**, jamás en bundle/cliente/env público. Usada únicamente para operaciones cross-tenant auditadas (superadmin, webhook, seed, team).
4. **Transacciones reales** para flujos críticos (booking, payment, settlement) — cierra A2.
5. **Migraciones versionadas en Git** (Supabase CLI) — cierra A5.
6. **Refactor solo con causa** (bug/riesgo/dependencia/duplicación/seguridad/escalabilidad). El dominio y la lógica de `src/lib/*` se conservan.

### Separación de capas (objetivo)
```
UI (components, pages)
   ↓   solo presenta y llama services / server actions
Application / Business logic (src/lib/*-service.ts)   ← fuente canónica
   ↓   nunca llama al SDK directo; usa el data-access
Data access (src/lib/db.ts + tenant.ts)   ← única puerta a Postgres
   ↓
PostgreSQL (Supabase)  ← constraints + RLS + transacciones
```

Regla explícita: **ningún componente frontend llama a múltiples APIs para calcular negocio ni modifica la BD directamente**. La lógica ya está en `src/lib/`; la migración la preserva y le añade transacciones.

## 3. Modelo organizacional (evolución)

Hoy la jerarquía es **plana**: todo cuelga de `company` (string), `user` usa `company_id`, `partner` usa `parent_partner` (self-ref). Se evoluciona hacia un modelo explícito que soporta relaciones comerciales entre organizaciones sin romper el tenant:

```
organizations (kind: tenant|partner|branch)  ─ parent_org_id (self)
   ↕
organization_relationships (from_org ↔ to_org, type, comisión, crédito, contrato)
   ↕
organization_memberships (user ↔ org ↔ role ↔ status)
```

Detalle y ruta de migración en `../database/DATA_MODEL.md`. Se evita el antipatrón "`parent_company_id` resuelve todo": las relaciones comerciales (empresa principal ↔ tour centers) viven en `organization_relationships`, no en una columna de jerarquía única.

## 4. Deployment objetivo

```
feature branch → PR → CI (install/lint/typecheck/test/build) → merge
   → Vercel Preview (QA sobre Supabase staging)
   → Vercel Production (sobre Supabase production)
```

Entornos separados: Local / Staging (Preview) / Production, cada uno con su proyecto Supabase. Nunca usar la BD de producción en desarrollo. Migraciones aplicadas por CI, no a mano.

## Health de arquitectura (actual)

| Dimensión | /100 | Nota |
|---|---:|---|
| Separación de capas | 65 | Buena separación lib/UI; falta forzar que nada salte el data-access (84 callsites directos). |
| Portabilidad | 30 | Atado a Totalum (BD/auth/storage) y Cloudflare (hosting). |
| Integridad de datos | 25 | Sin FK, sin UNIQUE, sin transacciones en BD. |
| Preparación producción | 35 | Ver `PRODUCTION_READINESS_REPORT.md`. |

El objetivo de la migración es llevar Portabilidad → 90+ (controlado por nosotros) e Integridad → 85+ (constraints + transacciones + RLS).
