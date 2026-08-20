# Supabase — Esquema y migraciones (M1)

Migraciones SQL versionadas que reemplazan el esquema de Totalum. **Fase M1** del
`docs/migration/MIGRATION_PLAN.md`: núcleo crítico (auth/org + cadena
comercial-financiera) con FK, constraints, índices y **RLS**.

## Contenido

| Archivo | Qué crea |
|---|---|
| `0001_init_extensions_helpers.sql` | Extensiones, esquema `app`, helpers de RLS (`current_org_id`, `current_app_role`, `current_partner_id`, `can_read_partner`, `enable_tenant_rls`), trigger `updated_at` |
| `0002_organizations.sql` | `organizations`, `organization_memberships`, `organization_relationships` + `custom_access_token_hook` + RLS de tenancy |
| `0003_enums.sql` | Enums estables (currency, sales_channel, beneficiary_type, calc_type, payment_method, payment_kind, aging_bucket) |
| `0004_core_catalog_crm.sql` | `customer`, `cancellation_policy`, `product`, `product_modality`, `price_rule`, `departure` |
| `0005_core_sales.sql` | `seller`, `order`, `booking`, `participant`, `voucher` |
| `0006_core_finance.sql` | `cash_register`, `cash_session`, `commission_rule`, `settlement`, `commission`, `payment`, `receivable`, `payable` |
| `0007_rls_core.sql` | Habilita RLS en todas las tablas del núcleo (org-scoped; partner-scoped donde aplica) |

## Modelo de tenancy

- Cada tabla de negocio lleva `organization_id` → `organizations(id)` (el nodo `kind='tenant'`).
- El **JWT** lleva `org_id` (tenant root), `app_role` y `partner_id`, inyectados por `app.custom_access_token_hook` desde `organization_memberships` (se cablea en la Fase M3).
- **RLS** aísla por `organization_id`; las tablas partner-owned (order/booking/commission/settlement/payment/receivable/payable) además filtran por partner en lectura para el rol `partner`.
- Un usuario inactivo no recibe `org_id` en el claim → RLS niega todo (revocación inmediata, AUD-S02).
- `service_role` (solo servidor: superadmin, webhook, seed, team, impersonación auditada) **bypassa RLS**.

## Aplicar

Con Supabase CLI (recomendado):

```bash
supabase db reset          # aplica todas las migraciones en orden (entorno local/staging)
# o contra un proyecto:
supabase db push
```

Con psql directo (las funciones `auth.uid()`/`auth.jwt()` las provee Supabase):

```bash
for f in supabase/migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
```

### Wiring del hook de claims (M3)
En el dashboard de Supabase: Authentication → Hooks → Custom Access Token →
seleccionar `app.custom_access_token_hook`. Sin esto, los claims `org_id`/`app_role`
no se emiten y la RLS niega el acceso (comportamiento seguro por defecto).

## Validación local realizada
Estas migraciones se aplicaron contra Postgres 16 con stubs del esquema `auth`, y se
verificó: (1) las 7 migraciones aplican sin error; (2) Org A no ve datos de Org B y el
INSERT cross-tenant es rechazado por RLS; (3) un usuario `partner` solo ve las filas de
su partner mientras el staff ve todas las del tenant.

## Pendiente (siguientes fases)
- Tablas restantes fuera del núcleo (parque, inventario, mantenimiento, equipo, plataforma) — resto de M1.
- `seed.sql` repetible (datos demo separados de reales).
- Data-access layer sobre Supabase con estas tablas (M2) + transacciones.
- ETL Totalum → Supabase con reconciliación (M5).
