-- 0096 · parte 2 de 7 — trozo 1 de 4 del texto de la función
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

insert into app.editor_sql_0096 (n, txt) values (1, $trozo$create or replace function public.dashboard_summary(
  p_org_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_previous_from timestamptz,
  p_previous_to timestamptz,
  p_base_currency text,
  p_timezone text,
  p_product_id uuid default null,
  p_branch_id uuid default null,
  p_seller_id uuid default null,
  p_partner_id uuid default null,
  p_channel text default null,
  p_rank_by text default 'sales',
  p_cash_user_id uuid default null
) returns jsonb
  language plpgsql
  stable
  security invoker
  set search_path = public, app
as $$
declare
  out jsonb;
begin
  if app.current_org_id() is null or app.current_org_id() <> p_org_id then
    raise exception 'dashboard organization is outside your tenant' using errcode = 'insufficient_privilege';
  end if;

  with
  -- A2: comisión variable atribuible por reserva (misma moneda base y estados
  -- que el KPI de comisiones). Las comisiones foráneas no se pueden convertir
  -- (no hay columna base ni tipo de cambio congelado), así que no restan margen.
  booking_commission as (
    select c.booking_id,
      sum(case when c.currency::text = p_base_currency then c.amount else 0 end) as commission_base
    from commission c
    where c.organization_id = p_org_id
      and c.status in ('pending','approved','held','disputed')
      and c.booking_id is not null
    group by c.booking_id
  ),
  current_booking as (
    select b.status, b.booking_date, b.channel, b.product_id, b.seller_id,
      b.partner_id, b.pax_total,
      case when b.status in ('confirmed','partially_paid','paid','checked_in','completed','no_show','partially_refunded') then
        greatest(0,
          coalesce(
            b.base_amount,
            case
              when b.currency::text = p_base_currency then b.total_amount
              when b.exchange_rate is not null and b.exchange_rate <> 1 then b.total_amount * b.exchange_rate
              else null
            end,
            0
          ) - coalesce(
            b.base_refund_amount,
            case
              when b.currency::text = p_base_currency then coalesce(b.refund_amount, 0)
              when b.exchange_rate is not null and b.exchange_rate <> 1 then coalesce(b.refund_amount, 0) * b.exchange_rate
              else null
            end,
            0
          )
        )
      else 0 end as sale_base,
      case when b.status in ('confirmed','partially_paid','paid','checked_in','completed','no_show','partially_refunded') then
        coalesce(
          b.base_cost_amount,
          case
            when b.currency::text = p_base_currency then b.cost_amount
            when b.exchange_rate is not null and b.exchange_rate <> 1 then b.cost_amount * b.exchange_rate
            else null
          end,
          0
        )
      else 0 end as cost_base,
      case when b.status in ('confirmed','partially_paid','paid','checked_in','completed','no_show','partially_refunded') then
        coalesce(bc.commission_base, 0)
      else 0 end as commission_base,
      case when b.status in ('confirmed','partially_paid','paid','checked_in','completed','no_show','partially_refunded') then
        (
          coalesce(
            b.base_amount,
            case
              when b.currency::text = p_base_currency then b.total_amount
              when b.exchange_rate is not null and b.exchange_rate <> 1 then b.total_amount * b.exchange_rate
              else null
            end
          ) is null
          or coalesce(
            b.base_cost_amount,
            case
              when b.currency::text = p_base_currency then b.cost_amount
              when b.exchange_rate is not null and b.exchange_rate <> 1 then b.cost_amount * b.exchange_rate
              else null
            end
          ) is null
        )
      else false end as incomplete_money
    from booking b
    left join booking_commission bc on bc.booking_id = b.id
    where b.organization_id = p_org_id
      and b.booking_date >= p_from and b.booking_date <= p_to
      and (p_product_id is null or b.product_id = p_product_id)
      and (p_branch_id is null or b.branch_id = p_branch_id)
      and (p_seller_id is null or b.seller_id = p_seller_id)
      and (p_partner_id is null or b.partner_id = p_partner_id)
      and (p_channel is null or b.channel::text = p_channel)
  ),
  previous_booking as (
    select
      case when b.status in ('confirmed','partially_paid','paid','checked_in','completed','no_show','partially_refunded') then
        greatest(0, coalesce(b.base_amount, case when b.currency::text = p_base_currency then b.total_amount when b.exchange_rate is not null and b.exchange_rate <> 1 then b.total_amount * b.exchange_rate else 0 end, 0) - coalesce(b.base_refund_amount, case when b.currency::text = p_base_currency then coalesce(b.refund_amount, 0) when b.exchange_rate is not null and b.exchange_rate <> 1 then coalesce(b.refund_amount, 0) * b.exchange_rate else 0 end, 0))
      else 0 end as sale_base
    from booking b
    where b.organization_id = p_org_id
      and b.booking_date >= p_previous_from and b.booking_date <= p_previous_to
      and (p_product_id is null or b.product_id = p_product_id)
      and (p_branch_id is null or b.branch_id = p_branch_id)
      and (p_seller_id is null or b.seller_id = p_seller_id)
      and (p_partner_id is null or b.partner_id = p_partner_id)
      and (p_channel is null or b.channel::text = p_channel)
  ),
  payment_base as (
    select p.payment_type,
      case when p.status = 'completed' and p.payment_type in ('payment','deposit','refund','credit_note') then
        coalesce(p.base_amount, case when p.currency::text = p_base_currency then p.amount when p.exchange_rate is not null and p.exchange_rate <> 1 then p.amount * p.exchange_rate else null end)
      else 0 end as amount_base,
$trozo$);

select count(*) as trozos_guardados, 1 as esperados from app.editor_sql_0096;
