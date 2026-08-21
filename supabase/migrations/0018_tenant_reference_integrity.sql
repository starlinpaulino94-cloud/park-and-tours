-- ============================================================================
-- 0018 — Tenant-aware reference integrity for critical business tables
--
-- Plain foreign keys guarantee that the parent row exists, but they do not prove
-- that parent and child belong to the same tenant. These triggers fail future
-- writes that would connect rows across tenants while leaving existing migrated
-- data untouched. Run a separate data-quality report before converting any of
-- these checks into validated composite constraints.
-- ============================================================================

create or replace function app.enforce_same_tenant_refs()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
declare
  idx integer := 0;
  ref_column text;
  ref_table regclass;
  ref_value text;
  parent_org uuid;
begin
  if new.organization_id is null then
    raise exception 'organization_id is required for tenant reference validation'
      using errcode = '23514';
  end if;

  while idx < array_length(tg_argv, 1) loop
    ref_column := tg_argv[idx];
    ref_table := tg_argv[idx + 1]::regclass;
    ref_value := to_jsonb(new)->>ref_column;

    if ref_value is not null and ref_value <> '' then
      execute format('select organization_id from %s where id = $1', ref_table)
        into parent_org
        using ref_value::uuid;

      if parent_org is null then
        raise exception 'Referenced row %.% does not exist', ref_table::text, ref_value
          using errcode = '23503';
      end if;

      if parent_org <> new.organization_id then
        raise exception 'Cross-tenant reference rejected: %.% belongs to %, child belongs to %',
          ref_table::text, ref_value, parent_org, new.organization_id
          using errcode = '23514';
      end if;
    end if;

    idx := idx + 2;
  end loop;

  return new;
end;
$$;

drop trigger if exists sales_order_same_tenant_refs on sales_order;
create trigger sales_order_same_tenant_refs
before insert or update of organization_id, customer_id, seller_id on sales_order
for each row execute function app.enforce_same_tenant_refs(
  'customer_id', 'customer',
  'seller_id', 'seller'
);

drop trigger if exists booking_same_tenant_refs on booking;
create trigger booking_same_tenant_refs
before insert or update of organization_id, order_id, customer_id, product_id, departure_id, modality_id, seller_id on booking
for each row execute function app.enforce_same_tenant_refs(
  'order_id', 'sales_order',
  'customer_id', 'customer',
  'product_id', 'product',
  'departure_id', 'departure',
  'modality_id', 'product_modality',
  'seller_id', 'seller'
);

drop trigger if exists participant_same_tenant_refs on participant;
create trigger participant_same_tenant_refs
before insert or update of organization_id, booking_id on participant
for each row execute function app.enforce_same_tenant_refs(
  'booking_id', 'booking'
);

drop trigger if exists voucher_same_tenant_refs on voucher;
create trigger voucher_same_tenant_refs
before insert or update of organization_id, booking_id, order_id on voucher
for each row execute function app.enforce_same_tenant_refs(
  'booking_id', 'booking',
  'order_id', 'sales_order'
);

drop trigger if exists settlement_same_tenant_refs on settlement;
create trigger settlement_same_tenant_refs
before insert or update of organization_id, seller_id on settlement
for each row execute function app.enforce_same_tenant_refs(
  'seller_id', 'seller'
);

drop trigger if exists commission_same_tenant_refs on commission;
create trigger commission_same_tenant_refs
before insert or update of organization_id, booking_id, order_id, rule_id, settlement_id, seller_id on commission
for each row execute function app.enforce_same_tenant_refs(
  'booking_id', 'booking',
  'order_id', 'sales_order',
  'rule_id', 'commission_rule',
  'settlement_id', 'settlement',
  'seller_id', 'seller'
);

drop trigger if exists payment_same_tenant_refs on payment;
create trigger payment_same_tenant_refs
before insert or update of organization_id, order_id, booking_id, customer_id, cash_session_id on payment
for each row execute function app.enforce_same_tenant_refs(
  'order_id', 'sales_order',
  'booking_id', 'booking',
  'customer_id', 'customer',
  'cash_session_id', 'cash_session'
);

drop trigger if exists receivable_same_tenant_refs on receivable;
create trigger receivable_same_tenant_refs
before insert or update of organization_id, order_id, customer_id on receivable
for each row execute function app.enforce_same_tenant_refs(
  'order_id', 'sales_order',
  'customer_id', 'customer'
);

drop trigger if exists payable_same_tenant_refs on payable;
create trigger payable_same_tenant_refs
before insert or update of organization_id, settlement_id, seller_id on payable
for each row execute function app.enforce_same_tenant_refs(
  'settlement_id', 'settlement',
  'seller_id', 'seller'
);

drop trigger if exists cash_movement_same_tenant_refs on cash_movement;
create trigger cash_movement_same_tenant_refs
before insert or update of organization_id, cash_session_id, payment_id on cash_movement
for each row execute function app.enforce_same_tenant_refs(
  'cash_session_id', 'cash_session',
  'payment_id', 'payment'
);

drop trigger if exists pickup_same_tenant_refs on pickup;
create trigger pickup_same_tenant_refs
before insert or update of organization_id, booking_id, hotel_id, route_id on pickup
for each row execute function app.enforce_same_tenant_refs(
  'booking_id', 'booking',
  'hotel_id', 'hotel',
  'route_id', 'pickup_route'
);
