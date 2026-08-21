# SECURITY_MULTITENANCY_AUDIT.md — Park & Tours

> **Fase 5 — Auditoría de seguridad y multi-tenancy** en el contexto de la migración a Supabase.
> Complementa `../audit/AUDIT_REPORT.md` y `../audit/VALIDATION.md` (auditoría funcional previa, ya remediada en `main`). Este documento se centra en lo que la migración cambia y en los gates que faltan.

## Resumen ejecutivo

Tras la remediación previa (PR #1, en `main`), los defectos funcionales P0/P1 están cerrados: escalada a superadmin, RBAC de lectura/escritura, aislamiento del portal B2B (deny-by-default), idempotencia de pagos, máquina de estados, etc. **Pero el aislamiento sigue siendo aplicativo, no de base de datos.** La migración a Supabase es la oportunidad —y la obligación— de llevarlo a **RLS**, que es defensa en profundidad real.

## 1. Estado actual del aislamiento multi-tenant

| Mecanismo | Dónde | Fortaleza | Debilidad |
|---|---|---|---|
| Filtro `company` forzado | `tenant.ts:160-254` (`tenantQuery/Create/Update/Delete`) | El caller no puede sobrescribir `company`; `tenantUpdate` descarta `company` entrante | **Solo aplica si se usa el wrapper.** 84 callsites directos a `totalumSdk.crud.*` lo omiten |
| RBAC servidor | `requireAtLeast`, `readRole`, `partnerScopeFor` | Deny-by-default para partner; lecturas financieras gated | Depende de disciplina en cada ruta |
| RLS de BD | — | — | **No existe** (Totalum no lo soporta) |

**Conclusión (P0 para la migración):** el aislamiento debe pasar a RLS por `organization_id`. Con RLS, los callsites directos dejan de ser un agujero: la BD rechaza cualquier fila fuera del tenant del claim.

## 2. Diseño de seguridad objetivo (Supabase)

### 2.1 RLS centralizado y reutilizable
Evitar cientos de policies inmantenibles con **funciones helper**:
```sql
-- Claims del JWT (poblados por custom_access_token_hook desde organization_memberships)
create function auth_org_id() returns uuid language sql stable as
  $$ select (auth.jwt() ->> 'org_id')::uuid $$;
create function auth_role() returns text language sql stable as
  $$ select auth.jwt() ->> 'role' $$;
create function auth_partner_id() returns uuid language sql stable as
  $$ select nullif(auth.jwt() ->> 'partner_id','')::uuid $$;

-- Política base reutilizable en toda tabla de negocio:
--   USING (organization_id = auth_org_id())
-- Política de partner (tablas partner-owned):
--   USING (organization_id = auth_org_id() AND partner_id = auth_partner_id())
```
Conceptos con helper reutilizable: **current org**, **membership**, **org hierarchy** (relationships), **role/capability**, **partner scope**, **branch scope**, **seller scope**.

### 2.2 Service role
- `SUPABASE_SERVICE_ROLE_KEY` **jamás** en browser/client components/bundle/env pública. Solo en Route Handlers / Server Actions server-only.
- Uso restringido y auditado: superadmin cross-tenant, webhook Stripe, seed, `/api/team`, **impersonación auditada**.
- Auditar en CI que `SUPABASE_SERVICE_ROLE_KEY` no aparezca bajo `NEXT_PUBLIC_*` ni en componentes cliente (grep gate).

### 2.3 Impersonación de superadmin
RLS por claim no deja ver otro tenant sin bypass. Se recrea como: endpoint server-only con `service_role`, que fija el `organization_id` objetivo en el contexto y **escribe `audit_log` con severidad `critical`** en cada acción (como hoy, `tenant.ts:86-97`). Cookie `impersonate` conservable, pero el bypass es explícito.

### 2.4 Revocación inmediata (usuario desactivado)
Hoy `tenant.ts:64-67` niega acceso si `status != 'active'` en cada request. En Supabase: el `custom_access_token_hook` no emite claims válidos para memberships inactivas, y/o una política sobre `organization_memberships (status='active')` respalda el check. Considerar `updateAge`/rotación de sesión corta para que el desactivar surta efecto pronto.

## 3. Checklist de auditoría de seguridad (Fase 20)

| Vector | Estado actual | Acción en migración |
|---|---|---|
| **Authentication** | better-auth (email/pass, sin verificación de email ni reset activos) | Supabase Auth: activar verificación de email + reset; MFA opcional |
| **Authorization** | RBAC servidor OK | Conservar + reforzar con RLS |
| **RLS** | inexistente | **Implementar** (P0) |
| **IDOR** | mitigado en app (`tenantFindOne`, `partnerScopeFor`) | RLS lo hace estructural; probar `/bookings/<de otra org>` etc. |
| **XSS** | sin `dangerouslySetInnerHTML` | mantener; CSP revisar `frame-ancestors *` |
| **CSRF** | cookies `SameSite`; acciones sensibles server-side | Supabase Auth + verificación de origen |
| **SQL injection** | N/A (API Mongo) | Con Postgres: **usar parámetros/PostgREST**, nunca SQL string interpolado |
| **File upload** | inexistente en la app | Construir con RLS por path `{org_id}/...`, tamaño/tipo validados |
| **Rate limiting** | app-level en memoria (parcial) | Supabase Auth rate limit + límite en Vercel para `/api/checkin/*`, `/api/payments` |
| **Secrets** | sin secretos en repo; `.env*` gitignored | `.env.example` sin valores; **rotar** cualquier secreto que haya pasado por vibe coding |
| **Webhooks** | Stripe firma obligatoria en prod + idempotencia | Conservar; simplificar crypto a Node |

## 4. Secretos y rotación (Fase 13)

- Verificado: **sin secretos hardcodeados en `src/`**, sin `.env` versionado (`.gitignore` cubre `.env`, `.envProd`, `.env*.local`).
- Acción: crear `.env.example` documentado (sin valores). **Rotar** `TOTALUM_API_KEY`, `BETTER_AUTH_SECRET`, claves Stripe si alguna vez estuvieron en un prompt, chat, o entorno compartido durante el desarrollo inicial — no basta con borrarlas del archivo actual.
- Nuevos secretos: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `DATABASE_URL`, `SENTRY_AUTH_TOKEN` — solo en Vercel/entorno seguro, nunca en Git.

## 5. Storage — aislamiento de archivos (Fase 5)

- Buckets: **public** (logos, imágenes de producto) y **private** (contratos, PDFs de liquidación, recibos, documentos de participantes, waivers, fotos de mantenimiento).
- RLS de Storage por prefijo de path `{organization_id}/...`; para partners, `{organization_id}/partners/{partner_id}/...`. URLs firmadas de corta duración para lo privado.
- Regla dura: **un Tour Center nunca descarga archivos privados de otro** (ni de otros partners, employees, customers, organizaciones). Verificable con la policy de path + `auth_partner_id()`.

## Health de seguridad

| Dimensión | Actual /100 | Post-migración objetivo |
|---|---:|---:|
| Authentication | 60 | 90 (verificación email + reset + MFA) |
| Authorization | 75 | 90 |
| Tenant isolation | 55 (solo app) | 92 (RLS + app + UI) |
| Secrets | 80 | 95 (rotados + gate CI) |
| Storage security | 20 (inexistente) | 88 |
| **Global seguridad** | **58** | **90** |
