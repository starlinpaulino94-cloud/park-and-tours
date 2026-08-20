-- ============================================================================
-- 0007 — Row Level Security on every core business table.
-- Org-scoped by default; partner-owned tables also filter by partner on read.
-- service_role (server-only: superadmin, webhook, seed, team) bypasses RLS.
-- Writes additionally pass the application RBAC layer (requireAtLeast/writeRole).
-- ============================================================================

-- Org-scoped only
select app.enable_tenant_rls('public.customer');
select app.enable_tenant_rls('public.cancellation_policy');
select app.enable_tenant_rls('public.product');
select app.enable_tenant_rls('public.product_modality');
select app.enable_tenant_rls('public.price_rule');
select app.enable_tenant_rls('public.departure');
select app.enable_tenant_rls('public.seller');
select app.enable_tenant_rls('public.participant');
select app.enable_tenant_rls('public.voucher');
select app.enable_tenant_rls('public.cash_register');
select app.enable_tenant_rls('public.cash_session');
select app.enable_tenant_rls('public.commission_rule');

-- Partner-owned (partner-role users see only their own partner's rows)
select app.enable_tenant_rls('public.sales_order',   true);
select app.enable_tenant_rls('public.booking',    true);
select app.enable_tenant_rls('public.commission', true);
select app.enable_tenant_rls('public.settlement', true);
select app.enable_tenant_rls('public.payment',    true);
select app.enable_tenant_rls('public.receivable', true);
select app.enable_tenant_rls('public.payable',    true);

-- NOTE: participant/voucher are org-scoped only for now. Partner-level filtering
-- (via their booking) is a follow-up once the join pattern is validated.
