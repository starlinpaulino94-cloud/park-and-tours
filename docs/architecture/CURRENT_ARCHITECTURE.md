# CURRENT_ARCHITECTURE.md — Park & Tours

> Arquitectura **real**, verificada en código. Fecha: 2026-08-20.
> Complementa `docs/architecture/ARCHITECTURE.md` (PR #2, escrito como arquitectura *objetivo*). Este documento describe lo que **hay**, no lo que se pretende.

## 1. Stack verificado

| Capa | Tecnología | Evidencia |
|---|---|---|
| Framework | Next.js **15.3.9** App Router, React **19.0.1** | `package.json` |
| Lenguaje | TypeScript 5.8.3 (`tsc --noEmit` ✅ limpio) | ejecutado |
| Hosting | **Cloudflare Workers** vía OpenNext 1.3.0 | `wrangler.jsonc`, `open-next.config.ts` |
| Datos (producción) | **Totalum** — BaaS propietario, CRUD registro a registro | `src/lib/totalum.ts`, `DATA_BACKEND` por defecto |
| Datos (migración) | **Supabase / Postgres** tras flag | `supabase/migrations/*`, `src/lib/supabase/*` |
| Auth (producción) | **better-auth 1.3.26** + adapter propio sobre Totalum | `src/lib/auth.ts`, `better-auth-totalum-adapter.ts` (592 líneas) |
| Auth (migración) | Supabase Auth tras `AUTH_BACKEND` | `src/lib/auth-backend.ts` |
| Storage | Supabase Storage (buckets `public-assets`/`private-docs`) | `supabase/migrations/0016_storage.sql` |
| Pagos | Stripe 19.1.0 (`constructEventAsync` + `cryptoProvider` para Workers) | `src/lib/stripe.ts` |
| UI | Tailwind v4 + shadcn/ui + Radix (24 paquetes) + lucide + sonner | `package.json` |
| Formularios | react-hook-form + zod 4 + `@hookform/resolvers` | `package.json` |
| Tests | Vitest 2.1.9 — **63 tests, 9 ficheros, todos verdes** | ejecutado |
| Cache | ❌ ninguna | grep vacío |
| Colas / Workers | ❌ ninguna | grep vacío |
| Cron / Scheduler | ❌ **ninguno** | `wrangler.jsonc` sin `triggers` |
| Observabilidad | ❌ ninguna en producción | ver §6 |

## 2. Capas

La separación existe y **se respeta de forma consistente** — es el mayor activo del proyecto:

```
UI            src/app/**/page.tsx  +  src/components/**
                    │  fetch JSON vía src/lib/api.ts (cliente uniforme)
Application   src/app/api/**/route.ts   ── authN/authZ, parseo, envelope {ok,data}
                    │
Domain        src/lib/{booking-service,pricing,commission-engine,availability,
                       ledger,cash,inventory,approvals,currency}.ts
                    │
Data Access   src/lib/tenant.ts   ── scope de tenant FORZADO, no opcional
                    │
Infra         totalum-api-sdk  |  supabase/{service,server,data-provider}.ts
```

**Invariante bien implementada:** `tenantQuery/tenantCreate/tenantUpdate/tenantDelete/tenantFindOne` fusionan `company` **al final**, de modo que el llamante no puede sobrescribir el scope. `tenantUpdate` descarta `company` del payload. Verificado línea a línea.

**Grietas reales:**
1. `src/lib/availability.ts`, `booking-service.ts`, `audit.ts` y varias rutas llaman `totalumSdk.crud.*` **directamente**, saltándose `tenant.ts`. En `recalculateDeparture` el filtro `company` se pasa a mano — funciona, pero la garantía pasa a depender de la disciplina del autor en cada callsite.
2. 80 de 95 páginas son `"use client"`: la lógica de presentación queda en el navegador y toda autorización recae en la API. Correcto por diseño, pero significa que **la UI no es una frontera** y hay que auditar 48 rutas, no 95 páginas.

## 3. Multi-tenancy

**Modelo:** tenant único por fila (`company` / `organization_id`), aislamiento **exclusivamente a nivel de aplicación**.

- Entre empresas: **sólido**. No se encontró ninguna ruta de fuga cross-tenant en la rama Totalum.
- Dentro del tenant (partner B2B): deny-by-default en `partnerScopeFor()`, verificado en lista y detalle.
- **En base de datos: inexistente.** Totalum no tiene RLS. El esquema Supabase la define pero **no la activa** (ver `DATABASE_AUDIT.md` `DB-001`).

Superadmin cruza tenants mediante cookie `totalum_impersonate_company` (httpOnly, 2 h) con escritura obligatoria en `audit_log` con severidad `critical`.

## 4. Autenticación y sesión

- Cookie de sesión better-auth, 7 días, `cookieCache` 30 s.
- `getTenantContext()` re-consulta el usuario en cada petición → un usuario desactivado pierde acceso de inmediato (no espera a que expire la sesión).
- **No hay reset de contraseña ni verificación de email** — el código está escrito y comentado en `auth.ts:46-92`.
- Rate limiting: `better-auth.rateLimit` con **store en memoria**. En Cloudflare Workers (isolates efímeros y distribuidos) esto es **casi inoperante**; el propio código lo reconoce en un comentario.

## 5. Frontera HTTP (middleware)

`src/middleware.ts` hace tres cosas y dos son problemáticas:

| Función | Estado |
|---|---|
| Gate de sesión para páginas | ⚠️ Sólo comprueba **presencia** de cookie, no validez. Excluye `/api/*` y cualquier ruta con `.`. Los layouts re-verifican (mitigación). |
| CORS | ⚠️ Credenciales permitidas a cualquier `*.totalum-project.com` / `*.webapp-project.com` y a **cualquier origen en desarrollo** |
| CSP | ❌ `frame-ancestors *` y `X-Frame-Options` **eliminado** → clickjacking habilitado en todo el ERP |

Además `next.config.ts` aplica `Cache-Control: no-cache, no-store, must-revalidate` a **`/:path*`** — todas las rutas, incluidos estáticos.

## 6. Observabilidad

**No existe en producción.** Evidencia:
- `instrumentation.ts` carga `backend-logger` **sólo si `process.env.NEXT_RUNTIME === 'nodejs'`** → en Cloudflare Workers no se ejecuta nunca. El logger estructurado (395 líneas) es código muerto en producción.
- 287 llamadas `console.*` sin formato estructurado ni correlación de petición.
- Sin Sentry / OTel / Datadog (`NEXT_PUBLIC_SENTRY_DSN` aparece comentado en `.env.example`, sin implementación).
- **Sin endpoint de health check.**
- Único observabilidad real: logs de invocación de Cloudflare (`wrangler.jsonc: observability.enabled`) — texto plano, sin alertas.
- `audit_log` de negocio sí existe y es bueno, pero sus fallos se tragan (`audit.ts` catch → `console.error`).

## 7. Despliegue

```
Git push → GitHub Actions CI (install · lint · typecheck · test · build · guard secretos)
                                   │
                                   ▼  ❌ sin gate de despliegue
                    Publicación manual desde la plataforma Totalum
                    (`develop` → auto-merge a `main` → deploy)
```

Sin staging, sin preview environment, sin migraciones aplicadas por CI, **sin rollback definido**.

## 8. Deuda arquitectónica declarada

| # | Deuda | Impacto |
|---|---|---|
| A1 | **Dual-backend simultáneo.** Toda operación de datos existe dos veces; sólo una está en producción y la otra es la que tiene tests. | Alto — superficie doble, deriva garantizada |
| A2 | **La fuente de verdad es un BaaS propietario sin transacciones, locks, constraints ni RLS.** | **Crítico** — techo estructural de integridad |
| A3 | **Sin observabilidad.** | Crítico — no se puede operar |
| A4 | **Sin cron/queue.** Trabajos periódicos y diferidos no tienen dónde ejecutarse. | Alto |
| A5 | **Middleware como frontera parcial** con CSP/CORS permisivos. | Alto |
| A6 | 77 recursos por CRUD genérico: cambiar una regla de escritura implica editar un registro de 1 018 líneas. | Medio |
| A7 | Lógica de dominio invoca el SDK directamente en algunos puntos, saltando `tenant.ts`. | Medio |

## 9. Decisión pendiente: ¿migrar o consolidar?

El proyecto está **a mitad de una migración de motor** (M1–M5 hechos, cutover no). Mantenerse a mitad es la peor posición: se paga el coste de dos arquitecturas y no se cobra el beneficio de ninguna.

### OPCIÓN A — Completar la migración a Postgres (Supabase) y retirar Totalum

| | |
|---|---|
| **Ventajas** | Transacciones, locks (`FOR UPDATE`), FK, UNIQUE, CHECK, índices, **RLS como frontera real**, migraciones versionadas, backups/PITR, `EXPLAIN`. Elimina el SPOF propietario y el techo A2. Resuelve por construcción `BIZ-001` (sobreventa), `BIZ-004` (idempotencia) y `DB-*`. |
| **Desventajas** | Cutover con riesgo de pérdida/deriva de datos; hay que corregir el esquema antes (RLS ausente); Auth y Storage migran a la vez; los 592 líneas del adapter se tiran. |
| **Complejidad** | Alta |
| **Coste de migración** | ETL ya escrito y testeado (`scripts/migrate/`, 9 tests). Estimación: 3–5 semanas incl. corrección de esquema, cutover ensayado y verificación. |
| **Riesgo** | Medio-alto, **acotable** con dual-run y reconciliación (ya implementada) |
| **Escalabilidad** | Alta — pooling, índices, réplicas |
| **Mantenibilidad** | Alta — una sola rama de datos |

### OPCIÓN B — Consolidar sobre Totalum y borrar la rama Supabase

| | |
|---|---|
| **Ventajas** | Sin cutover, sin riesgo de datos, entrega inmediata; se elimina la mitad de la superficie de código. |
| **Desventajas** | **La integridad queda con un techo permanente**: sin transacciones no hay saga fiable, sin UNIQUE no hay idempotencia real, sin RLS el aislamiento depende para siempre de la disciplina de código. Lock-in total en un proveedor sin SLA público ni backups verificables por el equipo. |
| **Complejidad** | Baja |
| **Coste de migración** | ~1 semana (borrado y limpieza) |
| **Riesgo** | Bajo hoy, **creciente** con el volumen |
| **Escalabilidad** | Baja — CRUD registro a registro sobre HTTP, sin índices controlables |
| **Mantenibilidad** | Media |

### Recomendación: **OPCIÓN A**, con esta condición

Este producto mueve **dinero y cupos con concurrencia real**. Los defectos P0/P1 que quedan abiertos (`BIZ-001`, `BIZ-004`, `BIZ-005`, `DB-002`) **no tienen solución correcta sobre Totalum** — sólo mitigaciones, y las mitigaciones ya se intentaron en PR #1 y siguen siendo mitigaciones. Postgres los resuelve por construcción.

**Condición innegociable:** la migración **no puede ejecutarse con el esquema actual**, porque `enable_tenant_rls()` no se invoca en ninguna tabla (`DB-001`). Hacer cutover hoy cambiaría un aislamiento débil-pero-consistente por **ninguno**. Corregir `DB-001`/`DB-002` es prerrequisito del cutover, no un paso posterior.

**No sobrearquitectar:** monolito modular sobre Next.js + Postgres. Sin microservicios, sin Kafka, sin Kubernetes, sin event sourcing, sin CQRS. Redis sólo si el rate limiting distribuido lo exige, y entonces basta Upstash o Cloudflare Rate Limiting.
