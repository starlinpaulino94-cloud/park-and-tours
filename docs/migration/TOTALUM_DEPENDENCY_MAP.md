# TOTALUM_DEPENDENCY_MAP.md — Park & Tours

> **Fase 1 — Mapa exhaustivo de dependencias de Totalum.** El documento más crítico de la migración: qué hace Totalum hoy, dónde, y su reemplazo en Supabase.
> Fecha: 2026-08-20. Objetivo final: `grep -ri totalum` sin dependencias activas de producción.

## Resumen ejecutivo

Totalum es el **backend completo**: base de datos (Postgres oculto tras una API tipo Mongo), motor de esquema y almacén de archivos. La superficie es **estrecha en métodos, ancha en callsites**:

- **90 callsites `totalumSdk.crud.*`** en `src/` — **84 directos** (omiten los wrappers de tenant) + 6 dentro de `tenant.ts`, en **24 archivos**.
- Solo **4 métodos**: `crud.query` (38), `crud.editRecordById` (40), `crud.createRecord` (10), `crud.deleteRecordById` (2).
- **Storage solo declarativo** (9 campos `FILE`, sin código de upload en la app).
- **Aislamiento multi-tenant 100% en la aplicación** (no en BD) — el punto más crítico para RLS.
- **Sin transacciones** → `booking-service.ts` hace compensación manual.

## Tabla por funcionalidad

| Funcionalidad | Qué de Totalum | Archivos / callsites | Alternativa Supabase | Complejidad | Riesgo |
|---|---|---|---|---|---|
| **BD / CRUD** | SDK `crud.{query,createRecord,editRecordById,deleteRecordById}` API tipo Mongo, sin transacciones | `lib/totalum.ts`, 84 callsites; `booking-service.ts` (9), `stripe/webhook` (8), `superadmin/*` (~20) | `@supabase/supabase-js` + Postgres; reimplementar `tenant.ts` con la misma firma | **Alta** (volumen) | **Alto** |
| **Autenticación** | `better-auth` + adapter propio (593 líneas) mapeando user/session/account/verification a tablas Totalum | `auth.ts`, `better-auth-totalum-adapter.ts` | **Supabase Auth nativo** (elimina el adapter entero) | Media | Medio |
| **Sesiones** | Cookie better-auth 7d; impersonación vía cookie `totalum_impersonate_company` | `auth.ts`, `tenant.ts:41-100`, `superadmin/impersonate` | Supabase Auth (JWT). Impersonación auditada = custom (service_role + auditoría) | Media | Medio |
| **Storage** | Declarativo: 9 campos `FILE()`. `TotalumFile={name,url?}`. **Sin upload/download en la app** | `types.ts`, `setup-database.mjs` | **Supabase Storage** (buckets pub/priv). **Construir el flujo de upload inexistente** + migrar blobs | Baja-Media | Bajo (código) / Medio (blobs) |
| **Aislamiento multi-tenant** | **App, no BD**: `tenantQuery` inyecta `company: companyId` en `_filter` (`tenant.ts:165-166`) | `tenant.ts` (núcleo), `resources.ts`, rutas | **RLS Postgres** por `organization_id` + claim JWT | Alta | **Muy alto** |
| **Provisión de esquema** | `setup-database.mjs` crea ~82 tablas vía API Totalum (`/api/v1/data-structure`) | `setup-database.mjs` (1345 líneas) | Migraciones SQL (Supabase CLI). `objectReference`→FK, `options`→enum/CHECK, `file`→text/jsonb | Alta | Alto |
| **Filtros (Mongo-like)** | `_filter`: `eq/ne/lte/gte/in/nin/regex/_or`. **`gt`/`lt` degradados a gte/lte** | `better-auth-totalum-adapter.ts:181-190`, filtros inline | SQL/PostgREST: `regex`→`ILIKE`, `in`→`IN`, `_or`→`OR`, `gt`/`lt` **reales** (mejora) | Media | Medio |
| **Agregación / count** | `_aggregate:{_count:true}` y `_count:true`. Sin SUM/GROUP BY (se agrega en JS) | `tenant.ts:171-192`, `superadmin/stats` | SQL `COUNT/SUM/GROUP BY` nativo | Baja-Media | Bajo (mejora) |
| **Auditoría** | `audit_log` vía `createRecord` directo | `audit.ts` | Tabla Postgres + insert (o triggers) | Baja | Bajo |

## Superficie EXACTA del SDK a reimplementar

El nuevo data-access layer (`lib/supabase.ts` + `lib/tenant.ts` reescrito) solo debe replicar:

1. `query(table, {_filter, _limit, _offset, _sort, _select, _count, _aggregate, <ref>:true})` — con **expansión de relaciones** por clave (`company_id:true`, `voucher:{_limit:10}`).
2. `createRecord(table, data)` → registro creado.
3. `editRecordById(table, id, data)` → registro actualizado.
4. `deleteRecordById(table, id)`.

**Operadores de `_filter`** a traducir a SQL: valor desnudo=`eq`, `{ne}`, `{lte}`, `{gte}`, `{in}`, `{nin}`, `{regex,options}`, `_or:[...]`. Nota: `gt`/`lt` **no existen** en Totalum (degradados) — revisar la lógica que dependía del comportamiento inclusivo.
**Agregación**: `_aggregate:{_count:true}` → `row._aggregate._count`; `_count:true` → `items[0]._count._total`.

## Callsites directos — distribución (24 archivos)

`booking-service.ts` (9), `demo-seed.ts` (6), `pricing.ts` (4), `availability.ts` (3), `audit.ts` (1), `cash.ts` (1), `commission-engine.ts` (1); rutas: `stripe/webhook` (8), `superadmin/plans` (7), `superadmin/stats` (6), `superadmin/companies` (6), `team` (5), `setup` (5), `settlements/generate` (4), `bookings/[id]/cancel` (4), `bookings/[id]/checkin` (4), `settlements/[id]/pay` (3), `cash/sessions/[id]/close` (2), `commissions/bulk` (1), `superadmin/audit` (1), `me` (1), `superadmin/impersonate` (1), `company` (1), `payments` (1). Más el adapter de auth (`client.crud.*`).

## Aislamiento multi-tenant y RLS — implicación central

El aislamiento vive en `tenantQuery` (aplicación), **no en la BD**. Los 84 callsites directos dependen de disciplina manual: si alguien llama `totalumSdk.crud.query` sin el filtro, **no hay aislamiento** (los `superadmin/*` lo omiten a propósito, por ser cross-tenant).

**Con Supabase RLS esto pasa a ser seguro por defecto:**
1. `organization_id` (= tenant root) como **custom claim** del JWT (Auth Hook `custom_access_token_hook`).
2. Política `USING (organization_id = (auth.jwt()->>'org_id')::uuid)` en cada tabla de negocio.
3. **`service_role`** (server-only) para operaciones **cross-tenant** legítimas: superadmin, webhook Stripe, seed, team.
4. **Impersonación auditada** = override explícito con `service_role` + escritura en `audit_log` (RLS por claim no permite ver otro tenant sin bypass).
5. La revocación por `status != 'active'` (`tenant.ts:64-67`) se replica en el hook de JWT o en una política sobre `memberships`.

## Variables de entorno Totalum

- Runtime (retirar): `TOTALUM_API_KEY`, `TOTALUM_API_URL` (`totalum.ts:5-6`, `setup-database.mjs`).
- Build/editor visual (retirar): `TOTALUM_SOURCE_TAGS` (`next.config.ts`).
- Solo en docs: `TOTALUM_MCP_DOCS`, `TOTALUM_AUTO_FIELDS`.

## Notas destacadas para la migración

- **Sin transacciones**: `booking-service.ts` construye orden→bookings→vouchers→commissions→receivables con rollback manual por compensación. Postgres permite envolverlo en `BEGIN/COMMIT` real — **simplificación importante y cierre definitivo del overbooking**.
- El `user` de Totalum mezcla auth (email/pass) con negocio (`role`, `company_id`, `partner_id`, `status`). En Supabase: auth → `auth.users`; negocio → `organization_memberships`.
- Tipos a traducir: `options`→enum/CHECK/`text[]`, `long-string json`→`jsonb`, `file`→text/jsonb con path de Storage, `objectReference`→FK.

## Criterio de "hecho"

Al terminar la migración: **`grep -ri totalum src/ scripts/` = 0 dependencias activas**. Referencias residuales permitidas solo en: documentación histórica (`/docs`), comentarios de migración claramente marcados, y archivos ETL de un solo uso archivados.
