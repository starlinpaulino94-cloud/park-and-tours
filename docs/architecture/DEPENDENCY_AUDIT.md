# DEPENDENCY_AUDIT.md — Park & Tours

> **Fase 1 — Inventario de dependencias.** Auditoría orientada a la migración **Totalum + Cloudflare Workers → Supabase + Vercel**.
> Fecha: 2026-08-20 · Rama: `claude/project-comprehensive-audit-uxp38i` · Método: lectura de `package.json`, lockfile, `wrangler.jsonc`, `next.config.ts`, `tsconfig.json` + grep de uso real en `src/`.

## Resumen del stack

| Aspecto | Valor | Evidencia |
|---|---|---|
| Framework | **Next.js 15.3.9** (App Router) | `package.json`, `src/app/**` |
| React | **19.0.1** (pinned) | `package.json` |
| TypeScript | **5.8.3**, `strict:false`, alias `@/* → src/*` | `tsconfig.json` |
| Package manager | **npm** (único lockfile `package-lock.json` v3) | raíz |
| Runtime actual | **Cloudflare Workers** vía OpenNext (`workerd`, `nodejs_compat`) | `wrangler.jsonc`, `next.config.ts` |
| Runtime edge en rutas | **Ninguno** (`export const runtime` no aparece) | grep vacío |
| Capa de datos | **Totalum** (API REST SaaS) es "la base de datos" | `src/lib/totalum.ts` |
| Auth | **better-auth** + **adapter custom sobre Totalum** | `src/lib/auth.ts`, `src/lib/better-auth-totalum-adapter.ts` |
| Pagos | **Stripe** (config específica de Workers) | `src/lib/stripe.ts` |
| Estilos | **Tailwind v4** + shadcn/ui + Radix | `postcss.config.mjs` |

**Conclusión de runtime:** la app **no usa APIs de edge**; migra limpiamente a **funciones serverless Node de Vercel**. El único acoplamiento real a Workers está en la config OpenNext/Wrangler y en dos llamadas del cliente Stripe.

## Clasificación por dependencia

### Núcleo de migración

| Nombre | Ver. | Propósito | Dónde se usa | Acopl. | Riesgo | Alternativa | Acción |
|---|---|---|---|---|---|---|---|
| `totalum-api-sdk` | 3.0.8 | La "BD" (todo el acceso a datos) | `lib/totalum.ts`, adapter, +27 rutas, `setup-database.mjs` | **ALTO** | **CRÍTICO** | `@supabase/supabase-js` + Postgres; reescribir `lib/totalum.ts`/`tenant.ts` | **REPLACE** |
| `better-auth` | 1.3.26 | Auth (email/pass, sesiones, bearer) | `auth.ts`, `auth-client.ts`, `/api/auth/[...all]`, `middleware.ts` | ALTO | Medio | **Supabase Auth** (objetivo del usuario) | **REPLACE** |
| `better-auth-totalum-adapter` (local) | — | Adapter better-auth ↔ Totalum | `better-auth-totalum-adapter.ts` (593 líneas) | ALTO | **CRÍTICO** | N/A (lo cubre Supabase Auth) | **REMOVE** |
| `stripe` | 19.1.0 | Pagos/checkout/portal/webhooks | `lib/stripe.ts`, 5 rutas `api/stripe/*` | Medio | Bajo | Igual (quitar config Workers) | **KEEP** (ajustar) |
| `zod` | 4.1.11 | Validación | 2 rutas Stripe | Bajo | — | Igual (ampliar uso) | **KEEP** |

### Infra Cloudflare (a eliminar)

| Nombre | Ver. | Dónde | Acción |
|---|---|---|---|
| `@opennextjs/cloudflare` | 1.3.0 | `open-next.config.ts`, `next.config.ts`, scripts CF | **REMOVE** |
| `wrangler` | 4.21.2 (dev) | scripts `cf-typegen`, `env.d.ts` | **REMOVE** |

### Dependencias muertas confirmadas (grep sin referencias en `src/`+`scripts/`)

`jsonwebtoken` (+`@types`), `bcrypt` (+`@types`), `pino`, `pino-pretty`, `ai`, `cookies-next`, `kill-port`, `date-fns` → **REMOVE** (10 paquetes). Reduce superficie de ataque y bundle.

### UNKNOWN (boilerplate shadcn sin consumidores)

`react-hook-form`, `@hookform/resolvers`, `react-day-picker` → viven en componentes de plantilla no importados. **Decisión del equipo**: eliminar ahora, o conservar si se planean formularios/calendarios (recomendado conservar `react-hook-form` para la validación zod client-side de la Fase 11).

### KEEP (agnósticas de plataforma)

24 paquetes `@radix-ui/*`, `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `cmdk`, `sonner`, `next-themes`, Tailwind, ESLint, TypeScript, `@types/*`. Sin cambios.

## Bindings Cloudflare a reemplazar en Vercel

| Servicio CF | Config | Reemplazo |
|---|---|---|
| Assets binding `ASSETS` | `wrangler.jsonc` | Nativo en Vercel (`/public` + CDN) |
| Observability / logs | `wrangler.jsonc` | Vercel Logs / **Sentry** |
| `upload_source_maps` | `wrangler.jsonc` | Sentry sourcemaps |
| Compat flags `nodejs_compat` | `wrangler.jsonc` | Innecesario (Node real) |
| `initOpenNextCloudflareForDev()` | `next.config.ts` | Eliminar |
| **KV / D1 / R2 / DO / rate-limit** | **NO EXISTEN** | N/A |

**Ausencias relevantes:** sin KV/D1/R2/Durable Objects/Queues, sin cron, sin binding de rate-limit. Toda la persistencia es Totalum → Supabase. Migración de infraestructura **ligera**.

## Ajustes puntuales de código (archivo:línea)

- `src/lib/stripe.ts:33` — `Stripe.createFetchHttpClient()` (solo Workers) → quitar.
- `src/lib/stripe.ts:50` + `api/stripe/webhook/route.ts` — `createSubtleCryptoProvider`/`constructEventAsync` → `constructEvent` estándar de Node.
- `next.config.ts` — loader webpack `totalum-source-tags.js` + bootstrap OpenNext → eliminar.
- `instrumentation.ts` — guardas Workers → simplificar; punto natural para inicializar **Sentry**.

## Acciones totales

**REPLACE 2** (`totalum-api-sdk`, `better-auth`) · **REMOVE** infra CF 2 + adapter local + 10 muertas · **UNKNOWN 3** · **KEEP** el resto.
