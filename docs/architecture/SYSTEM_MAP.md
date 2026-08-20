# SYSTEM_MAP.md — Park & Tours

> Mapa de superficie verificado por conteo mecánico. Fecha: 2026-08-20.
> Sustituye/actualiza `docs/audit/system-map.md` (PR #1, previo a la migración M1–M5).

## Métricas del repositorio

| Área | Ficheros | Líneas |
|---|---:|---:|
| `src/app/api` (48 rutas) | 48 | 4 285 |
| `src/app/dashboard` (95 páginas) | 96 | 9 159 |
| `src/app/superadmin` | 5 | 1 437 |
| `src/components` | 56 | 6 084 |
| `src/lib` | 51 | 9 715 |
| `supabase/migrations` | 16 | 2 520 |
| `scripts` | 7 | 2 055 |
| **Total `src` (TS/TSX)** | **280** | **34 306** |

Ficheros mayores: `src/lib/resources.ts` (1 018), `src/lib/nav.ts` (820), `dashboard/configuracion/page.tsx` (792), `dashboard/pos/page.tsx` (750), `components/tf/app-shell.tsx` (694), `src/lib/booking-service.ts` (649).

## Flujo de una petición

```
Navegador
   │
   ├─ Página (95)  ── 80/95 son "use client" ──► fetch  /api/…
   │                    15/95 Server Components
   ▼
middleware.ts   (Edge)  ── cookie de sesión, CORS, CSP ── NO cubre /api/*
   │
   ▼
Route Handler (48)  ── requireTenant() / requireSuperadmin()
   │                   requireAtLeast(rol) · sanitizePayload(allowlist)
   ▼
Capa de dominio  src/lib/*  (booking-service · pricing · commission-engine ·
   │              availability · ledger · cash · inventory · approvals)
   ▼
Capa de datos  src/lib/tenant.ts   ◄── ÚNICO punto de scope de tenant
   │                │
   │      DATA_BACKEND=totalum (DEFECTO)      DATA_BACKEND=supabase (flag)
   │                │                                 │
   ▼                ▼                                 ▼
           totalum-api-sdk (HTTP)          supabase/data-provider.ts
                     │                          │        │
                     ▼                     service-role  cliente RLS
              Totalum SaaS                      └───► Postgres/Supabase
              (fuente de verdad hoy)
```

**Layouts como frontera secundaria:** `src/app/dashboard/layout.tsx` y `src/app/superadmin/layout.tsx` re-verifican el contexto en servidor y redirigen. Esto es lo que evita que un bypass de middleware (ver `SEC-004`) sea catastrófico para las páginas.

## Rutas API por dominio (48)

| Dominio | Endpoints |
|---|---|
| CRUD genérico | `erp/[resource]`, `erp/[resource]/[id]` — **77 recursos** |
| Reservas | `bookings/[id]/checkin`, `bookings/[id]/cancel`, `departures/generate`, `checkin/lookup`, `orders`, `pricing/quote` |
| Finanzas | `payments`, `cash/sessions`, `cash/sessions/[id]/close`, `cash/movements`, `commissions/bulk`, `settlements/generate`, `settlements/[id]/pay`, `ledger/post`, `ledger/chart`, `ledger/trial-balance`, `reports/aging`, `reports/profitability` |
| Operación | `operations/dispatch`, `attractions/status`, `assets/[id]/status`, `inventory/movement`, `inventory/low-stock` |
| Plataforma | `setup`, `setup/demo`, `company`, `team`, `me`, `approvals`, `approvals/[id]/decide`, `dashboard`, `pos/context`, `maintenance/reconcile-drafts` |
| B2B | `portal/catalog`, `portal/summary` |
| Superadmin | `superadmin/{stats,companies,plans,audit,impersonate}` |
| Auth / Pagos / Storage | `auth/[...all]`, `stripe/{webhook,create-checkout-session,customer-portal,products}`, `storage/upload` |

## Módulos canónicos de dominio (`src/lib`)

| Módulo | Responsabilidad | Tests |
|---|---|:--:|
| `tenant.ts` | Scope multi-tenant, RBAC, impersonación | ❌ |
| `booking-service.ts` | Write-path único de venta (saga + compensación) | ❌ |
| `availability.ts` | Guardia de cupo (`assertCapacity`) | ❌ |
| `pricing.ts` | Precio canónico | ✅ 9 |
| `commission-engine.ts` | Comisión canónica | ✅ 10 |
| `ledger.ts` / `ledger-events.ts` | Partida doble | ❌ |
| `cash.ts` | Sesiones y arqueo de caja | ❌ |
| `inventory.ts` | Movimientos de stock | ❌ |
| `approvals.ts` | Flujo four-eyes | ❌ |
| `audit.ts` | Rastro de auditoría | ❌ |
| `codes.ts` | Códigos CSPRNG | ✅ 4 |
| `currency.ts` | Tipo de cambio server-side | ❌ |
| `resources.ts` | Registro de 77 recursos + allowlists | ❌ |
| `supabase/query-translator.ts` | Traductor de filtros Totalum→PostgREST | ✅ 7 |
| `supabase/auth-context.ts` | Contexto de tenant desde JWT | ✅ 7 |
| `supabase/storage.ts` | Rutas y validación de subida | ✅ 6 |

## Superficie duplicada (coste del dual-backend)

Cada operación de datos existe **dos veces**: rama Totalum y rama Supabase dentro de `tenant.ts`, más `auth.ts` vs `supabase/auth-context.ts`, más `better-auth-totalum-adapter.ts` (592 líneas) vs Supabase Auth. **Sólo la rama Totalum está en producción; sólo la rama Supabase tiene tests.**

## Integraciones externas

| Servicio | Uso | Criticidad | Timeout |
|---|---|---|---|
| **Totalum** | Base de datos actual (todo) | **P0 — SPOF total** | ❌ ninguno |
| **Stripe** | Suscripción SaaS | P0 | SDK por defecto |
| **Supabase** | Destino de migración (DB, Auth, Storage) | P0 (futuro) | ❌ ninguno |
| **Cloudflare Workers** | Hosting vía OpenNext | P0 | n/a |

`grep 'AbortSignal|AbortController|signal:' src/` → **0 resultados**. Ninguna llamada externa tiene timeout explícito.
