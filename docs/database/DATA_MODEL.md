# DATA_MODEL.md — Park & Tours (Database Audit + Modelo objetivo)

> **Fase 3 — Auditoría del modelo de datos** y diseño Postgres/Supabase.
> Fuentes de verdad: `scripts/setup-database.mjs` (tablas + relaciones), `src/lib/types.ts` (campos/enums), `src/lib/resources.ts` (writable/numeric/dates/expand).

## 0. Mecánica del esquema actual

- El array `TABLES` (`setup-database.mjs:76`) define cada tabla con helpers: `S/LINK`=string, `N`=number, `D`=date, `TXT`=long-string, `JSN`=long-string JSON, `FILE`=adjunto, `YN`=opción yes/no (booleano disfrazado), `OPT`=enum, `REF(name,label,target,rel)`=`objectReference`, `TENANT()`=`REF("company",…)` inyectado en toda tabla de negocio.
- Todas las props se crean con **`canRepeat:true` obligatorio** (Totalum trata la ausencia como UNIQUE y rompería las 1-N) → **consecuencia: cero constraints UNIQUE en toda la base**.
- Relaciones especiales: self-refs (`partner.parent_partner`, `seller.supervisor`, `branch.parent_branch`, `ledger_account.parent`); `user` (de better-auth, fuera de `TABLES`) extendida con `company_id`/`partner_id` (**nombre distinto** al `company` del resto); M2M (`partner/seller.authorized_products`, `promotion.products`).
- **Conteo:** 82 tablas en `TABLES` + `user` = **~83 entidades**. `stripe_event` es global (sin `TENANT()`).

## 1. Inventario de entidades por dominio

- **Core SaaS/plataforma:** plan, company (raíz tenant), user, subscription_invoice, audit_log, notification, stripe_event (global), integration, approval_request, document, document_ack.
- **Organización:** branch (+parent_branch), partner (+parent_partner, authorized_products m2m), seller (+supervisor, +partner, authorized_products m2m), staff, shift, attendance, certification.
- **Geografía:** zone, hotel.
- **Catálogo:** product_category, cancellation_policy, product, product_modality, price_rule, product_cost, promotion (products m2m), departure (status derivado), allotment.
- **CRM:** customer, lead, crm_activity, quote/quote_line, guest_case.
- **Reservas:** order (status derivado), booking (12 estados, derivado), participant, voucher (derivado), access_ticket, membership_plan/membership, gift_card/gift_card_movement, pickup_route, pickup, departure_resource.
- **Comisiones:** commission_rule (tiers jsonb), commission (snapshot inmutable), settlement.
- **Finanzas:** cash_register, cash_session, payment, cash_movement, receivable, supplier, payable, expense_category/expense, ledger_account (+parent), ledger_entry (inmutable), currency_rate, invoice (NCF/e-CF), tax_profile.
- **Inventario:** warehouse, inventory_item, stock_level (cache), stock_movement, purchase_order/purchase_order_line.
- **Parque/seguridad:** attraction, attraction_log (inmutable), waiver_template/waiver, incident, incident_action, inspection_template/inspection.
- **Mantenimiento/transporte:** asset, work_order, maintenance_plan, vehicle.
- **Tareas:** task.

## 2. Relaciones core (diagrama textual)

```
company (tenant root) ─ plan
company → partner (parent_partner self) · seller (supervisor self, +partner) · branch (parent_branch self)
user ──company_id──▶ company   user ──partner_id──▶ partner (portal B2B)
customer ──assigned_seller──▶ seller ;  customer.hotel → hotel → zone

ORDER (cabecera) 1──N BOOKING
  BOOKING → order, customer, product, departure(cupo), modality, seller, partner, pickup_hotel
     ├─ participant (N)      ├─ voucher (código único)
     ├─ payment → cash_session → cash_register → branch ; payment → cash_movement (N)
     └─ pickup → pickup_route
  BOOKING → COMMISSION → commission_rule  [snapshot inmutable]
     COMMISSION → SETTLEMENT → PAYABLE
  ORDER → RECEIVABLE (partner/customer, aging_bucket)
  ORDER → INVOICE → tax_profile
Contabilidad: order|payment|commission|settlement|expense|payable|receivable → ledger_entry → ledger_account (partida doble, entry_code)
```

## 3. Problemas del modelo actual (accionables)

| # | Problema | Sev | Fix en Postgres |
|---|---|---|---|
| D1 | `REF` = strings sin FK (ids huérfanos posibles) | **P1** | `uuid` + `FOREIGN KEY ... ON DELETE RESTRICT` |
| D2 | Cero UNIQUE (forzado por `canRepeat:true`) | **P1** | UNIQUE compuestos con `company_id` (ver §5) |
| D3 | `YN` "yes"/"no" en ~20 campos | P2 | `boolean` (convertir `'yes'→true`) |
| D4 | Enums replicados en 3 sitios sin fuente única | P2 | ENUM nativo (estables) + CHECK/lookup (máquinas de estado) |
| D5 | `user.company_id` vs `company` (nombre inconsistente) | P2 | Unificar en `organization_id` en toda la base |
| D6 | JSON como long-string (opaco, no indexable) | P2 | `jsonb` + validación (tipos ya en `types.ts`) |
| D7 | Saldos/estados derivados persistidos por app | P2 | Columnas mantenidas por trigger o vistas materializadas; máquina de estado en endpoints |
| D8 | Tenancy solo en app | **P0** | RLS por `organization_id` |

## 4. Mapeo a Postgres — decisiones

- **1 tabla Totalum → 1 tabla Postgres** (sin cambio de dominio en el primer corte; migración de motor, no de modelo).
- **`REF` → `uuid` + FK + índice.** Índices prioritarios (hoy inexistentes): `company_id`/`organization_id` en toda tabla; compuestos `(organization_id, status)`, `(organization_id, created_at desc)`, `(organization_id, partner_id)`, `(organization_id, seller_id)`, `(organization_id, customer_id)`, `(order_id)`, `(booking_id)`, `(departure_id)`, `(organization_id, product_id)`.
- **Enums:** nativos para estables (`currency`, `channel`, `lang`, `module_key`, `beneficiary_type`, `calc_type`, `aging_bucket`, `payment_method`); **CHECK o lookup** para máquinas de estado que evolucionan (`order/booking/commission/settlement/payment/departure/voucher/receivable.status`) — evita la rigidez de `ALTER TYPE ADD VALUE`.
- **`YN` → boolean**; **`JSN`/snapshots → jsonb**; **multi-opción → `text[]`**; **`FILE` → text/jsonb** con path de Supabase Storage.
- **Derivados por trigger:** `departure.available_pax`, `stock_level.quantity`, `receivable.balance`, `order.paid_total/balance` — mantenidos por trigger/función; la máquina de estado sigue en endpoints dedicados.
- **CHECK de validación** (reemplaza parte de `sanitizePayload`): `amount >= 0`, `discount_percent BETWEEN 0 AND 100`, `pax = trunc(pax)`.

## 5. UNIQUE constraints a crear (hoy en `unique.ts` best-effort)

- Global: `company.slug`, `user.email`, `stripe_event.event_id`.
- Compuestos con tenant: `order.order_number`, `booking.booking_number`, `voucher.code`, `access_ticket/gift_card/membership/settlement/quote/purchase_order/incident/work_order.code`, `product.code`, `product_modality.code`, `seller.code`, `branch.code` → `UNIQUE (organization_id, <code>)`.
- Fiscal: `invoice` → `UNIQUE (organization_id, series, ncf)`.
- Derivados: `stock_level` → `UNIQUE (organization_id, warehouse_id, inventory_item_id)`; `currency_rate` → `UNIQUE (organization_id, currency_from, currency_to, rate_date)`.

Esto **elimina `src/lib/unique.ts`** (existe solo porque Totalum no permite UNIQUE).

## 6. Modelo organizacional objetivo

```sql
organizations (
  id uuid pk, kind text check (kind in ('tenant','partner','branch')),
  parent_org_id uuid references organizations(id),   -- reemplaza parent_partner/parent_branch
  tenant_org_id uuid references organizations(id),    -- root del tenant (scoping rápido)
  name, slug unique (cuando kind='tenant'), legal_name, tax_id, country, currency, status,
  -- atributos hoy en company/partner
)
organization_memberships (
  id uuid pk, user_id uuid → auth.users, organization_id uuid → organizations,
  role text, status text, is_primary bool,
  unique (user_id, organization_id)
)
organization_relationships (       -- empresa principal ↔ partners (M:N con atributos)
  id uuid pk, from_org_id → organizations, to_org_id → organizations,
  relationship_type text, default_commission_pct, credit_limit, credit_days, currency,
  contract_from, contract_to, status,
  unique (from_org_id, to_org_id, relationship_type)
)
```

### Ruta de migración del `company`/`company_id`/`partner_id`
1. `company` → `organizations(kind='tenant', tenant_org_id=id)`.
2. `partner` → `organizations(kind='partner', tenant_org_id=org(partner.company))`; `credit_*`/`default_commission_pct`/`contract_*` → `organization_relationships(from=company_org, to=partner_org)`; `parent_partner` → `parent_org_id`.
3. `branch`: mantener como ubicación física que referencia `organization_id` (no inflar `organizations`).
4. `user.company_id` → `organization_memberships(user, org=company_org, role, status, is_primary=true)`.
5. `user.partner_id` no nulo → `membership(user, org=partner_org, role='partner')`.
6. Añadir `organization_id` (= tenant root) a cada tabla de negocio, poblado desde el `company` viejo; sustituir `tenantQuery(_filter.company)` por `organization_id` + RLS.
7. Deprecar `partner.company`, `user.company_id/partner_id` y self-refs.

Nota: `seller` se conserva como **perfil comercial** (metas, comisión, sucursal); su vínculo usuario↔empresa se expresa como membership `role='seller'`.

## Health de base de datos (actual)

| Dimensión | /100 | Justificación |
|---|---:|---|
| Integridad referencial | 15 | Sin FK; refs son strings. |
| Constraints/unicidad | 15 | Cero UNIQUE; suplido por app best-effort. |
| Índices | 20 | Sin índices declarados (Totalum los gestiona opaco). |
| Migraciones/versionado | 10 | Script imperativo, no DDL versionado. |
| Modelado de dominio | 70 | El dominio está bien pensado; el problema es el motor. |
| RLS | 0 | No existe (Totalum no lo soporta). |

Objetivo tras migración: todas ≥ 80, RLS ≥ 90.
