-- 0096 · parte 3 de 7 — trozo 2 de 4 del texto de la función
--
-- POR QUÉ ESTA MIGRACIÓN VA EN TROZOS Y LAS DEMÁS NO.
--
-- `dashboard_summary` son 20 kB de una sola sentencia: no se puede partir en
-- varias porque `create or replace function` es indivisible. El editor SQL de
-- Supabase trunca los pegados largos —ya pasó a los 7,3 kB, con «syntax error
-- at end of input» en la línea 0—, así que el texto de la función se deja en
-- una tabla auxiliar, trozo a trozo, y la última parte la ejecuta entera.
--
-- Las partes van EN ORDEN y ninguna se puede saltar. Si te paras a la mitad,
-- la función sigue siendo la de 0028 (correcta, solo que lenta) y la tabla
-- auxiliar se queda ahí: repetir desde la parte 1 la limpia.

insert into app.editor_sql_0096 (n, txt) values (2, $trozo$      case when p.status = 'completed' and p.payment_type in ('payment','deposit','refund','credit_note') then
        coalesce(p.base_amount, case when p.currency::text = p_base_currency then p.amount when p.exchange_rate is not null and p.exchange_rate <> 1 then p.amount * p.exchange_rate else null end) is null
      else false end as incomplete_money
    from payment p
    left join booking pb on pb.id = p.booking_id and pb.organization_id = p_org_id
    left join sales_order po on po.id = p.order_id and po.organization_id = p_org_id
    where p.organization_id = p_org_id
      and p.paid_at >= p_from and p.paid_at <= p_to
      -- M5: la caja acota la recaudación a los pagos que registró el cajero.
      and (p_cash_user_id is null or p.user_id = p_cash_user_id)
      and (p_product_id is null or pb.product_id = p_product_id)
      and (p_branch_id is null or coalesce(pb.branch_id, po.branch_id) = p_branch_id)
      and (p_seller_id is null or coalesce(pb.seller_id, po.seller_id) = p_seller_id)
      and (p_partner_id is null or coalesce(pb.partner_id, po.partner_id, p.partner_id) = p_partner_id)
      and (p_channel is null or coalesce(pb.channel::text, po.channel::text) = p_channel)
  ),
  previous_payment_base as (
    select p.payment_type,
      case when p.status = 'completed' and p.payment_type in ('payment','deposit','refund','credit_note') then
        coalesce(p.base_amount, case when p.currency::text = p_base_currency then p.amount when p.exchange_rate is not null and p.exchange_rate <> 1 then p.amount * p.exchange_rate else 0 end, 0)
      else 0 end as amount_base
    from payment p
    left join booking pb on pb.id = p.booking_id and pb.organization_id = p_org_id
    left join sales_order po on po.id = p.order_id and po.organization_id = p_org_id
    where p.organization_id = p_org_id
      and p.paid_at >= p_previous_from and p.paid_at <= p_previous_to
      and (p_cash_user_id is null or p.user_id = p_cash_user_id)
      and (p_product_id is null or pb.product_id = p_product_id)
      and (p_branch_id is null or coalesce(pb.branch_id, po.branch_id) = p_branch_id)
      and (p_seller_id is null or coalesce(pb.seller_id, po.seller_id) = p_seller_id)
      and (p_partner_id is null or coalesce(pb.partner_id, po.partner_id, p.partner_id) = p_partner_id)
      and (p_channel is null or coalesce(pb.channel::text, po.channel::text) = p_channel)
  ),
  commission_base as (
    select
      case when c.currency::text = p_base_currency then c.amount else null end as amount_base,
      c.currency::text <> p_base_currency as incomplete_money
    from commission c
    where c.organization_id = p_org_id
      and c.status in ('pending','approved','held','disputed')
      and (p_seller_id is null or c.seller_id = p_seller_id)
      and (p_partner_id is null or c.partner_id = p_partner_id)
  ),
  receivable_base as (
    select
      case when r.currency::text = p_base_currency then r.balance else null end as amount_base,
      r.currency::text <> p_base_currency as incomplete_money,
      -- M1: vencida = con fecha de vencimiento pasada (zona de la organización),
      -- independientemente de si el flag `status` se refrescó.
      (r.due_date is not null and r.due_date < (now() at time zone p_timezone)::date) as is_overdue
    from receivable r
    where r.organization_id = p_org_id and r.status in ('pending','partially_paid','overdue')
      and (p_partner_id is null or r.partner_id = p_partner_id)
  ),
  payable_base as (
    select
      case when p.currency::text = p_base_currency then p.balance else null end as amount_base,
      p.currency::text <> p_base_currency as incomplete_money
    from payable p
    where p.organization_id = p_org_id and p.status in ('pending','partially_paid')
      and (p_seller_id is null or p.seller_id = p_seller_id)
      and (p_partner_id is null or p.partner_id = p_partner_id)
  ),
  cash_base as (
    select cs.currency, cs.expected_cash,
      coalesce(cs.base_expected_cash, case when cs.currency::text = p_base_currency then cs.expected_cash when cs.exchange_rate is not null and cs.exchange_rate <> 1 then cs.expected_cash * cs.exchange_rate else null end) as amount_base,
      coalesce(cs.base_expected_cash, case when cs.currency::text = p_base_currency then cs.expected_cash when cs.exchange_rate is not null and cs.exchange_rate <> 1 then cs.expected_cash * cs.exchange_rate else null end) is null as incomplete_money
    from cash_session cs
    where cs.organization_id = p_org_id and cs.status = 'open'
      and (p_cash_user_id is null or cs.user_id = p_cash_user_id)
  ),
  current_summary as (
    select
      coalesce(sum(sale_base), 0) as net_sales,
      coalesce(sum(cost_base), 0) as cost,
      count(*) filter (where status in ('confirmed','partially_paid','paid','checked_in','completed','no_show','partially_refunded')) as bookings,
      coalesce(sum(pax_total) filter (where status in ('confirmed','partially_paid','paid','checked_in','completed','no_show','partially_refunded')), 0) as pax,
      count(*) filter (where status <> 'draft') as denominator,
      count(*) filter (where status = 'cancelled') as cancellations,
      count(*) filter (where status = 'refunded') as refunds,
      count(*) filter (where status = 'partially_refunded') as partial_refunds,
      count(*) filter (where status = 'no_show') as no_shows,
      coalesce(bool_or(incomplete_money), false) as incomplete
    from current_booking
  ),
  previous_summary as (
    select coalesce(sum(sale_base), 0) as net_sales from previous_booking
  ),
  payment_summary as (
    select
      coalesce(sum(case when payment_type in ('refund','credit_note') then -amount_base else amount_base end), 0) as collected,
      coalesce(bool_or(incomplete_money), false) as incomplete
$trozo$);

select count(*) as trozos_guardados, 2 as esperados from app.editor_sql_0096;
