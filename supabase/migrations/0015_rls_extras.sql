-- ============================================================================
-- 0015 — RLS for the remaining tables (0009-0014). Org-scoped by default;
-- partner-owned tables also filter by partner on read. Globals handled apart.
-- ============================================================================

-- Org-scoped only
select app.enable_tenant_rls('public.subscription_invoice');
select app.enable_tenant_rls('public.zone');
select app.enable_tenant_rls('public.branch');
select app.enable_tenant_rls('public.supplier');
select app.enable_tenant_rls('public.staff');
select app.enable_tenant_rls('public.shift');
select app.enable_tenant_rls('public.attendance');
select app.enable_tenant_rls('public.certification');
select app.enable_tenant_rls('public.hotel');
select app.enable_tenant_rls('public.audit_log');
select app.enable_tenant_rls('public.approval_request');
select app.enable_tenant_rls('public.integration');
select app.enable_tenant_rls('public.document');
select app.enable_tenant_rls('public.document_ack');
select app.enable_tenant_rls('public.product_category');
select app.enable_tenant_rls('public.product_cost');
select app.enable_tenant_rls('public.promotion');
select app.enable_tenant_rls('public.departure_resource');
select app.enable_tenant_rls('public.crm_activity');
select app.enable_tenant_rls('public.quote_line');
select app.enable_tenant_rls('public.guest_case');
select app.enable_tenant_rls('public.membership_plan');
select app.enable_tenant_rls('public.membership');
select app.enable_tenant_rls('public.access_ticket');
select app.enable_tenant_rls('public.gift_card');
select app.enable_tenant_rls('public.gift_card_movement');
select app.enable_tenant_rls('public.pickup_route');
select app.enable_tenant_rls('public.pickup');
select app.enable_tenant_rls('public.expense_category');
select app.enable_tenant_rls('public.expense');
select app.enable_tenant_rls('public.cash_movement');
select app.enable_tenant_rls('public.ledger_account');
select app.enable_tenant_rls('public.ledger_entry');
select app.enable_tenant_rls('public.currency_rate');
select app.enable_tenant_rls('public.tax_profile');
select app.enable_tenant_rls('public.warehouse');
select app.enable_tenant_rls('public.inventory_item');
select app.enable_tenant_rls('public.stock_level');
select app.enable_tenant_rls('public.stock_movement');
select app.enable_tenant_rls('public.purchase_order');
select app.enable_tenant_rls('public.purchase_order_line');
select app.enable_tenant_rls('public.attraction');
select app.enable_tenant_rls('public.vehicle');
select app.enable_tenant_rls('public.asset');
select app.enable_tenant_rls('public.attraction_log');
select app.enable_tenant_rls('public.waiver_template');
select app.enable_tenant_rls('public.waiver');
select app.enable_tenant_rls('public.incident');
select app.enable_tenant_rls('public.incident_action');
select app.enable_tenant_rls('public.inspection_template');
select app.enable_tenant_rls('public.maintenance_plan');
select app.enable_tenant_rls('public.work_order');
select app.enable_tenant_rls('public.inspection');
select app.enable_tenant_rls('public.task');

-- Partner-owned (partner-role users see only their own partner's rows)
select app.enable_tenant_rls('public.notification', true);
select app.enable_tenant_rls('public.allotment',    true);
select app.enable_tenant_rls('public.lead',         true);
select app.enable_tenant_rls('public.quote',        true);
select app.enable_tenant_rls('public.invoice',      true);

-- ── Globals ─────────────────────────────────────────────────────────────────
-- plan: readable by any authenticated user; writes via service_role only.
alter table plan enable row level security;
alter table plan force row level security;
create policy plan_read on plan for select using (true);

-- stripe_event: service_role only (the webhook). RLS on with NO policy denies
-- every non-service-role caller.
alter table stripe_event enable row level security;
alter table stripe_event force row level security;
