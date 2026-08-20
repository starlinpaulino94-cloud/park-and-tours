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

## FASE M1 — Provisión Supabase + esquema (Replicate)
1. Crear proyectos Supabase: **development**, **staging**, **production**.
2. Traducir `scripts/setup-database.mjs` a **migraciones SQL** (Supabase CLI, versionadas en `supabase/migrations/`):
   - `REF` → `uuid` + FK + índice; `YN` → boolean; `OPT` → enum nativo (estables) / CHECK (máquinas de estado); `JSN` → jsonb; `FILE` → text/jsonb (path Storage); multi-opción → `text[]`.
   - UNIQUE constraints de `DATA_MODEL.md §5`; índices de `§4`.
   - Modelo organizacional (`organizations`/`memberships`/`relationships`) — puede introducirse en M1 o diferirse tras el corte inicial 1:1 (recomendado: 1:1 primero con `organization_id`, evolución org después).
3. Funciones RLS helper (`auth_org_id()`, `auth_role()`, `auth_partner_id()`) + políticas base por tabla.
4. Seeds repetibles (datos demo separados de datos reales).

**Gate M1:** migraciones aplican limpio en dev; RLS activa; `supabase db reset` reproducible.

## FASE M2 — Data-access layer sobre Supabase (Replicate)
1. `src/lib/supabase/{server,client}.ts` con `@supabase/ssr` (service_role solo server-only).
2. Reescribir `src/lib/tenant.ts` **conservando firmas** (`tenantQuery/Create/Update/Delete/FindOne/Count/Aggregate`): traductor de `_filter` Mongo→PostgREST/SQL (`eq/ne/lte/gte/in/nin/regex→ilike/_or`), expansión de relaciones → `select=...(*)`, `_aggregate:{_count}` → `count`.
3. Reescribir `src/lib/totalum.ts` → cliente Supabase (o eliminarlo).
4. Migrar los **84 callsites directos** a los wrappers o al cliente Supabase (con RLS ya no hay riesgo de omitir el scope).
5. **Transacciones reales** en `booking-service.ts` (orden→bookings→vouchers→commissions→receivable en un `BEGIN/COMMIT` o RPC `SECURITY DEFINER`) — cierra el overbooking y elimina la compensación manual.

**Gate M2:** typecheck/build; tests de integración de flujos críticos pasan contra Supabase dev.

## FASE M3 — Auth (Supabase Auth)
1. Sustituir better-auth + adapter por **Supabase Auth** (`@supabase/ssr`): signup/login/logout/session/refresh nativos.
2. **Custom claims** (`custom_access_token_hook`): `org_id`, `role`, `partner_id`, `status` desde `organization_memberships` → el JWT lleva el tenant (elimina la 2ª query por request de `tenant.ts:49-53`).
3. Activar **verificación de email** y **reset de contraseña** (hoy comentados); OAuth Google/GitHub si se desea.
4. Reescribir `getTenantContext/requireTenant` para leer del JWT + memberships; recrear **impersonación auditada** con service_role.
5. Actualizar `middleware.ts` (nombre de cookie `sb-<ref>-auth-token` / `getUser()`), `auth-client.ts`, `/api/auth`.

**Gate M3:** login/logout/refresh/reset funcionan; revocación por `status` inmediata; impersonación auditada.

## FASE M4 — Storage
1. Buckets **public** (logos, imágenes producto) y **private** (contratos, PDFs liquidación, recibos, documentos, waivers, fotos).
2. RLS de Storage por path `{organization_id}/...` (y `{org}/partners/{partner_id}/...`); URLs firmadas cortas para privado.
3. **Construir el flujo de upload** (rutas API / cliente con RLS) — hoy inexistente.
4. Migrar blobs existentes desde Totalum; `TotalumFile.url` → path de Storage.

**Gate M4:** un partner no puede descargar archivos de otro (probado); upload/download funcionan.

## FASE M5 — ETL de datos (Validate + Reconcile)
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
