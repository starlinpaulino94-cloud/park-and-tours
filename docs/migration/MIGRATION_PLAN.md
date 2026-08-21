# MIGRATION_PLAN.md — Totalum → Supabase (+ Cloudflare → Vercel)

> **Plan de migración por fases**, sin big-bang. Estrategia: *Audit → Replicate → Validate → Switch reads → Switch writes → Monitor → Remove Totalum*.
> El sistema actual se mantiene operativo hasta que Supabase esté validado como fuente de verdad.

## Estrategia general

Dos ejes de migración, secuenciados para minimizar riesgo:
1. **Datos/Auth/Storage: Totalum → Supabase** (el grande).
2. **Hosting: Cloudflare Workers → Vercel** (ligero, sin edge en rutas).

Se hace **primero Supabase sobre el hosting actual** (o en local) para desacoplar los riesgos, y **al final** el corte a Vercel. Alternativamente, si se prefiere, ambos a la vez en el cutover — pero se recomienda separarlos.

### Habilitador clave: el data-access está embudado
Como casi todo pasa por `src/lib/tenant.ts` (+ 84 callsites con la misma superficie de 4 métodos), la migración se hace **reimplementando el data-access con la misma firma**. Se puede introducir un **flag `DATA_BACKEND=totalum|supabase`** para conmutar lectura/escritura por entorno y hacer la validación en paralelo (dual-read/reconcile) antes del corte.

---

## FASE M1 — Provisión Supabase + esquema (Replicate) — ✅ ESQUEMA COMPLETO
Estado: **83 tablas, 83 con RLS, 326 FKs**. Las 15 migraciones (`0001`-`0015`) aplican limpio en Postgres 16 (validado). Núcleo (0001-0008) + tablas restantes (0009-0014) + RLS (0007, 0015). Falta: crear los proyectos Supabase (dev/staging/prod) y aplicar las migraciones (paso de ops del usuario).

### Detalle original
1. Crear proyectos Supabase: **development**, **staging**, **production**.
2. Traducir `scripts/setup-database.mjs` a **migraciones SQL** (Supabase CLI, versionadas en `supabase/migrations/`):
   - `REF` → `uuid` + FK + índice; `YN` → boolean; `OPT` → enum nativo (estables) / CHECK (máquinas de estado); `JSN` → jsonb; `FILE` → text/jsonb (path Storage); multi-opción → `text[]`.
   - UNIQUE constraints de `DATA_MODEL.md §5`; índices de `§4`.
   - Modelo organizacional (`organizations`/`memberships`/`relationships`) — puede introducirse en M1 o diferirse tras el corte inicial 1:1 (recomendado: 1:1 primero con `organization_id`, evolución org después).
3. Funciones RLS helper (`auth_org_id()`, `auth_role()`, `auth_partner_id()`) + políticas base por tabla.
4. Seeds repetibles (datos demo separados de datos reales).

**Gate M1:** migraciones aplican limpio en dev; RLS activa; `supabase db reset` reproducible.

## FASE M2 — Data-access layer sobre Supabase (Replicate) — EN PROGRESO
1. ✅ `src/lib/supabase/server.ts` (cliente con RLS vía `@supabase/ssr`) + `service.ts` (service_role, server-only, bypass RLS).
2. ✅ **Traductor de queries** `src/lib/supabase/query-translator.ts`: `_filter` Mongo→PostgREST (`eq/ne/gt/gte/lt/lte/in/nin/regex→ilike/_or`) + alias de campos (`_id→id`, `company→organization_id`, `partner→partner_id`…) + sort/paginación. **8 tests unit** con builder falso.
3. ✅ **Proveedor de datos** `src/lib/supabase/data-provider.ts` con las mismas firmas que `tenant.ts` (`spQuery/spCount/spFindOne/spCreate/spUpdate/spDelete`) — listo para conmutar por flag `DATA_BACKEND`.
4. ✅ **Reserva de cupo atómica** (`supabase/migrations/0008_capacity_txn.sql`, RPC `public.reserve_departure_capacity`): row-lock `FOR UPDATE` → **overbooking imposible** (validado con dos transacciones concurrentes: una gana, la otra recibe `false`). Cierra AUD-B01 de raíz.
5. ✅ **Switch en `tenant.ts` por flag** `DATA_BACKEND` (`src/lib/data-backend.ts`): los 6 helpers CRUD (`tenantQuery/Count/FindOne/Create/Update/Delete`) delegan al proveedor Supabase cuando `DATA_BACKEND=supabase`; **default `totalum` intacto** (cero cambios de comportamiento). Mapa de tablas (`company→organizations`). Test que fija el default seguro.
6. ⏳ Migrar los 84 callsites directos a los wrappers (con RLS/scoping ya no hay riesgo) y envolver `createOrderWithBookings` en transacción (RPC de cupo + inserts).

### Cómo activar (paso de ops, requiere proyecto Supabase)
```
# 1. Crear proyecto Supabase y aplicar migraciones (supabase/README.md)
# 2. Env:
DATA_BACKEND=supabase
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...        # modo transición (service-role + scope explícito)
# 3. Tras migrar Auth (M3):
SUPABASE_USE_RLS=true                 # cambia al cliente con JWT → RLS aplica
```
Modo transición: el proveedor usa service-role con filtro `organization_id` explícito (réplica exacta del aislamiento actual) → la BD Supabase es usable ANTES de migrar Auth. `getTenantContext` (auth) permanece en el camino actual hasta M3.

**Gate M2:** typecheck ✅, build ✅, 41 tests ✅. Switch listo por flag. Falta: proyecto Supabase en vivo (ops), migración de callsites y transacción de orden.

## FASE M3 — Auth (Supabase Auth) — EN PROGRESO (detrás de flag)
1. ✅ Clientes Supabase Auth: `src/lib/supabase/client.ts` (browser, facade `supabaseAuth` con signUp/signIn/signOut/resetPassword) + `server.ts` ya existente.
2. ✅ **Resolución sesión→tenant desde el JWT**: `src/lib/supabase/auth-context.ts` (`getSupabaseTenantContext`) lee los claims `org_id/app_role/partner_id/status` (inyectados por `custom_access_token_hook`, migración 0002) — **sin query por request**. `getTenantContext` delega por flag `AUTH_BACKEND`. Revocación por `status` respetada (AUD-S02). Partes puras (`decodeJwtClaims`/`mapClaimsToContext`) con **7 tests**.
3. ✅ **Middleware** `src/lib/supabase/middleware.ts` (refresco de sesión) + rama guardada en `src/middleware.ts` que gatea por `getUser()` cuando el flag está activo.
4. ✅ **Switch `AUTH_BACKEND`** (`src/lib/auth-backend.ts`, default `better-auth`); login/register branch por `NEXT_PUBLIC_AUTH_BACKEND`.
5. ⏳ En el dashboard de Supabase: activar el hook `custom_access_token_hook`, verificación de email y reset de contraseña; configurar OAuth si se desea (paso de ops).
6. ⏳ Recrear **impersonación auditada** de superadmin con service_role (endpoint dedicado); portar `logout` del shell y `/api/team`/`/api/setup` a crear usuarios vía Supabase Admin API.

**Gate M3:** typecheck ✅, build ✅, 48 tests ✅. Switch listo por flag. Falta: proyecto Supabase con hook activado (ops), impersonación y creación de usuarios server-side.

### Cómo activar (con M2)
```
AUTH_BACKEND=supabase
NEXT_PUBLIC_AUTH_BACKEND=supabase   # login/register usan Supabase
SUPABASE_USE_RLS=true               # el data-provider pasa a cliente con JWT → RLS
```
Y en Supabase: Authentication → Hooks → Custom Access Token → `app.custom_access_token_hook`.

## FASE M4 — Storage — ✅ MECANISMO COMPLETO
1. ✅ Buckets `public-assets` (público) y `private-docs` (privado) — `supabase/migrations/0016_storage.sql`.
2. ✅ **RLS de `storage.objects`** por path `{org}/...` y `{org}/partners/{partner_id}/...`, con helpers `app.storage_org_ok/storage_partner_ok/storage_can_write`. **Validado en Postgres**: partner P1 solo ve su carpeta, P2 la suya, staff ve todo el org, Org A no ve Org B. URLs firmadas de 5-10 min para privado.
3. ✅ **Flujo de upload** (antes inexistente): `src/lib/supabase/storage.ts` (path derivado del org autenticado, sanitización de nombre, validación tamaño/MIME) + `POST /api/storage/upload` (multipart, path server-side, RLS de respaldo). 6 tests de rutas/validación.
4. ⏳ Migrar blobs existentes desde Totalum (parte del ETL M5); `TotalumFile.url` → path de Storage.
5. ⏳ Detalle importante hallado: los roles `authenticated/anon` necesitan `grant usage/execute` sobre el esquema `app` para evaluar RLS — añadido a `0001` (aplica a todas las políticas, no solo storage).

**Gate M4:** typecheck ✅, build ✅ (ruta `/api/storage/upload`), 54 tests ✅. Aislamiento por path **probado**. Falta: migración de blobs (M5) y cablear los formularios de la UI al endpoint.

## FASE M5 — ETL de datos (Validate + Reconcile) — ✅ FRAMEWORK LISTO
Estado: framework de ETL + reconciliación escrito y con transformaciones **testeadas** (9 tests). Falta ejecutarlo contra datos reales (paso de ops con credenciales) y extender `TABLE_SPECS` a todas las tablas.
- ✅ `scripts/migrate/transform.mjs`: `toUuid` (uuid v5 determinista → FKs sin tabla de mapeo, ETL idempotente), `ynToBool`, `parseJsonMaybe`, `refId`, `TABLE_SPECS` (núcleo comercial-financiero).
- ✅ `scripts/migrate/etl.mjs`: backup a JSON → extract paginado → transform → upsert `onConflict:id`. `company`→`organizations(kind='tenant')`.
- ✅ `scripts/migrate/reconcile.mjs`: conteos por tabla + **totales financieros al centavo** (`sum(payment.amount)`, `sum(booking.total_amount)`, `sum(commission.amount)`); exit≠0 ante discrepancia.
- ✅ `scripts/migrate/backup/` en `.gitignore` (datos de clientes, nunca a Git).
- ✅ **`TABLE_SPECS` completo: 80 tablas de negocio** (todas menos `organizations`/`partner`, que carga `loadOrganizations()`). Cada columna `ref/yn/json` **validada contra el esquema real** (`validate-specs.mjs` + `schema-columns.json` de las migraciones): 80 tablas, todas las columnas existen.
- ✅ **Filtrado por columnas** en `transformRecord`: descarta campos de Totalum sin columna en Postgres (evita fallos de upsert por columnas inexistentes). `etl.mjs` pasa las columnas reales por tabla desde `schema-columns.json`.
- ⏳ Cargar `partner`→org y `user`→memberships antes de las FKs; migrar blobs a Storage; refinar reconcile (organizations = tenants + partners).

**Gate M5:** transform con 9 tests ✅, scripts parsean ✅. La reconciliación real (conteos+totales cuadran) es el gate de cutover — requiere Totalum+Supabase en vivo.

### Detalle original
1. **Backup** completo de Totalum antes de tocar nada.
2. Inventario: por tabla → nº registros, relaciones, archivos, usuarios.
3. ETL **Extract → Transform → Validate → Load → Reconcile** (script idempotente, no copiar sin validar):
   - Mapa `old_totalum_id ↔ new_supabase_uuid` para no perder referencias históricas.
   - Transform: `'yes'→true`, strings→enums, JSON→jsonb, refs→uuid.
4. **Reconciliación**: comparar conteos y totales financieros (bookings, customers, payments, commissions, documents). No dar por terminada la migración hasta cuadrar (p.ej. `Totalum bookings = Supabase bookings`).

**Gate M5:** conteos y totales financieros coinciden 100%; referencias íntegras.

## FASE M6 — Switch reads → Switch writes → Monitor
1. `DATA_BACKEND=supabase` en **staging**: switch de lecturas; monitorizar discrepancias contra Totalum (dual-read).
2. Switch de escrituras en staging; validar flujos críticos (venta completa, check-in, comisión/settlement, refund, aislamiento A×B).
3. Monitor con Sentry + audit_log; ventana de observación.

**Gate M6:** flujos críticos verdes en staging durante la ventana; sin discrepancias.

## FASE M7 — Cutover a Vercel
1. Quitar OpenNext/Cloudflare (`open-next.config.ts`, `wrangler.jsonc`, scripts CF, init en `next.config.ts`, guardas `instrumentation.ts`, loader `totalum-source-tags`).
2. Ajustar Stripe a Node (`constructEvent` estándar).
3. Configurar Vercel: env vars (Supabase/Stripe/Sentry), Preview→Production, dominio.
4. GitHub → Vercel: `feature → PR → CI → merge → Preview → Production`. Nada de deploy manual.

**Gate M7:** Preview QA verde; producción desplegada; rollback probado (revert deploy + backup Supabase).

## FASE M8 — Remove Totalum (Cutover final)
Solo cuando M5/M6 estén validados:
1. Eliminar `totalum-api-sdk`, `better-auth`, adapter, env `TOTALUM_*`/`BETTER_AUTH_SECRET`.
2. Archivar `setup-database.mjs`/`fix-property-repeat.mjs` (histórico) o convertir a doc.
3. `grep -ri totalum src/ scripts/` → **0 dependencias activas**. Documentar cualquier residual (comentario/histórico).

**Gate M8 (auditoría final):** `ACTIVE TOTALUM DEPENDENCIES = 0`.

---

## Tabla de correspondencia funcional (resumen)

| Funcionalidad | Hoy (Totalum) | Destino (Supabase) |
|---|---|---|
| Usuarios / login | better-auth + adapter Totalum | Supabase Auth |
| Datos de negocio | `totalumSdk.crud.*` | Postgres + `tenant.ts` reescrito + RLS |
| Aislamiento | `tenantQuery` (app) | RLS por `organization_id` |
| Archivos | campos `FILE` Totalum | Supabase Storage (pub/priv) |
| Esquema | `setup-database.mjs` (API) | Migraciones SQL en Git |
| Transacciones | compensación manual | `BEGIN/COMMIT` / RPC |
| Hosting | Cloudflare Workers (OpenNext) | Vercel (Node) |
| Observabilidad | logger custom | Sentry + Vercel logs + audit_log |

## Riesgos y mitigaciones
| Riesgo | Mitigación |
|---|---|
| Pérdida de datos en ETL | Backup previo + mapa de ids + reconciliación por conteos/totales; sin big-bang |
| Fuga durante dual-run | RLS activa desde M1; service_role solo server-only |
| Regresión en flujos críticos | Tests (unit+integration+E2E) antes del switch; ventana de monitor |
| Overbooking durante transición | Transacciones en M2 antes de switch de escrituras |
| Downtime en cutover | Preview/staging validados; corte con rollback probado |

## Estimación de esfuerzo (orden de magnitud)
M1 esquema+RLS (alto) · M2 data-access+transacciones (alto) · M3 auth (medio) · M4 storage (medio) · M5 ETL+reconciliación (alto) · M6 switch (medio) · M7 Vercel (bajo-medio) · M8 remove (bajo). El grueso está en M1/M2/M5.

---

## Próximo paso
Este documento y los otros 6 son para tu **revisión**. Tras tu visto bueno, la implementación empieza por lo de **menor riesgo y mayor valor independiente** (tests base + Sentry + CI, `REMEDIATION_PLAN.md` S4-S6) y luego M1 (esquema Supabase), sin tocar los datos reales hasta tener backup y reconciliación.
