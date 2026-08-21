# System Map — Park & Tours

## Entradas

- Browser users: staff, admin, partner, superadmin.
- Stripe webhooks.
- ETL scripts ejecutados desde terminal.
- Supabase/Totalum APIs.

## Rutas Principales

| Area | Rutas | Estado |
|---|---|---|
| Public/Auth | `/`, `/login`, `/register`, legal, stripe success/cancel | PARTIAL |
| Dashboard | `/dashboard/**` | PARTIAL |
| Portal B2B | `/portal/**` | PARTIAL |
| Superadmin | `/superadmin/**` | PARTIAL |
| API ERP | `/api/erp/[resource]` | PARTIAL |
| Payments | `/api/payments`, `/api/stripe/**` | PARTIAL |
| Storage | `/api/storage/upload` | PARTIAL |
| Setup/demo | `/api/setup/demo` | RISKY/PARTIAL |

## Capas Reales

```text
Pages / Client Components
  ↓
Route Handlers + Server Components
  ↓
src/lib domain helpers and mixed service functions
  ↓
tenant wrappers OR direct totalumSdk OR Supabase provider
  ↓
Totalum default / Supabase migration target
```

## Data Paths

### Totalum Default

```text
API/Page
  ↓
requireTenant / tenantQuery / direct totalumSdk
  ↓
Totalum API
```

### Supabase Transition

```text
DATA_BACKEND=supabase
  ↓
tenant.ts delegates to src/lib/supabase/data-provider.ts
  ↓
service_role unless SUPABASE_USE_RLS=true
  ↓
Postgres with explicit organization_id filter
```

### Supabase RLS Target

```text
AUTH_BACKEND=supabase + SUPABASE_USE_RLS=true
  ↓
Supabase session JWT with org_id/app_role/partner_id
  ↓
RLS policies
```

## Critical Flows

| Flow | Entry | Core files | Risk |
|---|---|---|---|
| Create order/booking | `/api/orders`, POS | `booking-service.ts`, `availability.ts` | transaction/concurrency |
| Register payment | `/api/payments` | `payments/route.ts`, `cash.ts`, `ledger-events.ts` | idempotency/partial failure |
| Stripe subscription | `/api/stripe/*` | Stripe routes/webhook | forged metadata/public checkout |
| Upload file | `/api/storage/upload` | `storage.ts`, upload route | resource authorization |
| Portal partner | `/portal`, `/api/portal/*` | portal routes | partner isolation |
| ETL migration | `scripts/migrate/*` | transform/etl/reconcile | data loss/secrets |

## Trust Boundaries

- Browser to API.
- API to Totalum.
- API to Supabase service role.
- Supabase JWT/RLS.
- Stripe webhook signature.
- Local `.env.*` files.

## Unverified Areas

- Real production deployment target.
- Restore test.
- Load test.
- Runtime logs/alerts.
- Full Supabase cutover.
