-- Panel ejecutivo — severidad BAJA B4: agrupación de canales en "Otros".
-- El gráfico de "Ventas por canal" tomaba los 6 canales con más ventas y
-- descartaba el resto, de modo que la suma de las porciones no cuadraba con las
-- ventas netas del centro del donut. Ahora se conservan los 5 principales y el
-- remanente se agrega en un canal sintético 'otros', de modo que las porciones
-- suman el total. (Reemplaza la definición de 0027, conservando A1/A2/A3 y
-- M1/M2/M3/M5.)

create or replace function public.dashboard_summary(
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
    select b.*,
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
    select b.*,
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
    select p.*,
      case when p.status = 'completed' and p.payment_type in ('payment','deposit','refund','credit_note') then
        coalesce(p.base_amount, case when p.currency::text = p_base_currency then p.amount when p.exchange_rate is not null and p.exchange_rate <> 1 then p.amount * p.exchange_rate else null end)
      else 0 end as amount_base,
      case when p.status = 'completed' and p.payment_type in ('payment','deposit','refund','credit_note') then
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
    select p.*,
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
    select c.*,
      case when c.currency::text = p_base_currency then c.amount else null end as amount_base,
      c.currency::text <> p_base_currency as incomplete_money
    from commission c
    where c.organization_id = p_org_id
      and c.status in ('pending','approved','held','disputed')
      and (p_seller_id is null or c.seller_id = p_seller_id)
      and (p_partner_id is null or c.partner_id = p_partner_id)
  ),
  receivable_base as (
    select r.*,
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
    select p.*,
      case when p.currency::text = p_base_currency then p.balance else null end as amount_base,
      p.currency::text <> p_base_currency as incomplete_money
    from payable p
    where p.organization_id = p_org_id and p.status in ('pending','partially_paid')
      and (p_seller_id is null or p.seller_id = p_seller_id)
      and (p_partner_id is null or p.partner_id = p_partner_id)
  ),
  cash_base as (
    select cs.*,
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
    from payment_base
  ),
  previous_payment_summary as (
    select coalesce(sum(case when payment_type in ('refund','credit_note') then -amount_base else amount_base end), 0) as collected
    from previous_payment_base
  ),
  -- A3: `count` solo cuenta las filas efectivamente sumadas (moneda base);
  -- `excluded_count` revela las foráneas sin conversión (antes se contaban en
  -- `count` pero su monto no entraba en `total`).
  commission_summary as (
    select coalesce(sum(amount_base), 0) as total,
           count(*) filter (where amount_base is not null) as count,
           count(*) filter (where amount_base is null) as excluded_count,
           coalesce(bool_or(incomplete_money), false) as incomplete
    from commission_base
  ),
  receivable_summary as (
    select coalesce(sum(amount_base), 0) as total,
           count(*) filter (where amount_base is not null) as count,
           count(*) filter (where amount_base is null) as excluded_count,
           coalesce(bool_or(incomplete_money), false) as incomplete,
           count(*) filter (where is_overdue) as overdue_count
    from receivable_base
  ),
  payable_summary as (
    select coalesce(sum(amount_base), 0) as total,
           count(*) filter (where amount_base is not null) as count,
           count(*) filter (where amount_base is null) as excluded_count,
           coalesce(bool_or(incomplete_money), false) as incomplete
    from payable_base
  ),
  cash_summary as (
    select coalesce(sum(amount_base), 0) as total, count(*) as count, coalesce(bool_or(incomplete_money), false) as incomplete from cash_base
  ),
  -- M2: desglose de efectivo por divisa física (sin colapsar a un único total).
  cash_currency_rows as (
    select cs.currency::text as currency,
           round(coalesce(sum(cs.expected_cash), 0)::numeric, 2) as amount,
           count(*) as sessions,
           round(coalesce(sum(cs.amount_base), 0)::numeric, 2) as amount_base,
           coalesce(bool_or(cs.incomplete_money), false) as incomplete
    from cash_base cs
    group by cs.currency::text
  ),
  series_rows as (
    select to_char(booking_date at time zone p_timezone, 'YYYY-MM-DD') as key,
           to_char(booking_date at time zone p_timezone, 'YYYY-MM-DD') as label,
           round(sum(sale_base)::numeric, 2) as sales,
           coalesce(sum(pax_total), 0) as pax,
           count(*) as bookings,
           round(sum(sale_base - cost_base - commission_base)::numeric, 2) as margin
    from current_booking
    where status in ('confirmed','partially_paid','paid','checked_in','completed','no_show','partially_refunded')
    group by 1
  ),
  channel_rows as (
    select coalesce(channel::text, 'direct') as key,
           coalesce(channel::text, 'direct') as label,
           round(sum(sale_base)::numeric, 2) as sales,
           coalesce(sum(pax_total), 0) as pax,
           count(*) as bookings,
           round(sum(sale_base - cost_base - commission_base)::numeric, 2) as margin
    from current_booking
    where status in ('confirmed','partially_paid','paid','checked_in','completed','no_show','partially_refunded')
    group by 1
  ),
  product_rows as (
    select b.product_id::text as key,
           coalesce(pr.name, 'Excursión') as label,
           round(sum(b.sale_base)::numeric, 2) as sales,
           coalesce(sum(b.pax_total), 0) as pax,
           count(*) as bookings,
           round(sum(b.sale_base - b.cost_base - b.commission_base)::numeric, 2) as margin
    from current_booking b left join product pr on pr.id = b.product_id and pr.organization_id = p_org_id
    where b.status in ('confirmed','partially_paid','paid','checked_in','completed','no_show','partially_refunded')
    group by b.product_id, pr.name
  ),
  seller_rows as (
    select b.seller_id::text as key,
           coalesce(nullif(trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), ''), 'Vendedor') as label,
           round(sum(b.sale_base)::numeric, 2) as sales,
           coalesce(sum(b.pax_total), 0) as pax,
           count(*) as bookings,
           round(sum(b.sale_base - b.cost_base - b.commission_base)::numeric, 2) as margin
    from current_booking b left join seller s on s.id = b.seller_id and s.organization_id = p_org_id
    where b.status in ('confirmed','partially_paid','paid','checked_in','completed','no_show','partially_refunded') and b.seller_id is not null
    group by b.seller_id, s.first_name, s.last_name
  ),
  partner_rows as (
    select b.partner_id::text as key,
           coalesce(nullif(o.legal_name, ''), o.name, 'Tour center/agencia') as label,
           round(sum(b.sale_base)::numeric, 2) as sales,
           coalesce(sum(b.pax_total), 0) as pax,
           count(*) as bookings,
           round(sum(b.sale_base - b.cost_base - b.commission_base)::numeric, 2) as margin
    from current_booking b left join organizations o on o.id = b.partner_id and o.tenant_org_id = p_org_id
    where b.status in ('confirmed','partially_paid','paid','checked_in','completed','no_show','partially_refunded') and b.partner_id is not null
    group by b.partner_id, o.legal_name, o.name
  ),
  upcoming_rows as (
    select
      d.id::text as _id,
      coalesce(pr.name, 'Salida') as product,
      d.departure_at,
      d.capacity,
      (d.booked_pax + d.pending_pax) as booked,
      d.pending_pax as pending,
      case when d.capacity > 0 then greatest(0, d.capacity - (d.booked_pax + d.pending_pax)) else 0 end as available,
      d.status,
      case when d.capacity > 0 then round(((d.booked_pax + d.pending_pax)::numeric / d.capacity) * 100)::int else 0 end as occupancy
    from departure d
    left join product pr on pr.id = d.product_id and pr.organization_id = p_org_id
    where d.organization_id = p_org_id
      and d.departure_at >= now()
      and d.departure_at <= now() + interval '14 days'
      and d.status not in ('cancelled', 'completed')
      and (p_product_id is null or d.product_id = p_product_id)
  )
  select jsonb_build_object(
    'net_sales', round(cs.net_sales::numeric, 2),
    'previous_net_sales', round(ps.net_sales::numeric, 2),
    'cost', round(cs.cost::numeric, 2),
    'collected', round(pay.collected::numeric, 2),
    'previous_collected', round(ppay.collected::numeric, 2),
    'commission_total', round(com.total::numeric, 2),
    'commission_count', com.count,
    'commission_excluded_count', com.excluded_count,
    'receivable_total', round(rec.total::numeric, 2),
    'receivable_count', rec.count,
    'receivable_excluded_count', rec.excluded_count,
    'receivable_overdue_count', rec.overdue_count,
    'payable_total', round(pab.total::numeric, 2),
    'payable_count', pab.count,
    'payable_excluded_count', pab.excluded_count,
    'cash_total', round(cash.total::numeric, 2),
    'cash_count', cash.count,
    'cash_by_currency', coalesce((select jsonb_agg(to_jsonb(x) order by x.amount_base desc) from cash_currency_rows x), '[]'::jsonb),
    'bookings', cs.bookings,
    'pax', cs.pax,
    'cancellations', cs.cancellations,
    'refunds', cs.refunds,
    'partial_refunds', cs.partial_refunds,
    'no_shows', cs.no_shows,
    'denominator', cs.denominator,
    'incomplete_financial_data', cs.incomplete or pay.incomplete or com.incomplete or rec.incomplete or pab.incomplete or cash.incomplete,
    'series', coalesce((select jsonb_agg(to_jsonb(x) order by x.key) from series_rows x), '[]'::jsonb),
    -- B4: top 5 canales + un bucket 'otros' con el remanente, para que las
    -- porciones del donut sumen las ventas netas.
    'by_channel', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.sales desc)
      from (
        with ranked as (select cr.*, row_number() over (order by cr.sales desc, cr.key) as rn from channel_rows cr)
        select key, label, sales, pax, bookings, margin from ranked where rn <= 5
        union all
        select 'otros', 'otros',
               round(sum(sales)::numeric, 2), coalesce(sum(pax), 0), coalesce(sum(bookings), 0), round(sum(margin)::numeric, 2)
        from ranked where rn > 5
        having count(*) > 0
      ) x
    ), '[]'::jsonb),
    'top_products', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from product_rows order by case p_rank_by when 'margin' then margin when 'bookings' then bookings when 'pax' then pax else sales end desc limit 6) x), '[]'::jsonb),
    'top_sellers', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from seller_rows order by case p_rank_by when 'margin' then margin when 'bookings' then bookings when 'pax' then pax else sales end desc limit 6) x), '[]'::jsonb),
    'top_partners', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from partner_rows order by case p_rank_by when 'margin' then margin when 'bookings' then bookings when 'pax' then pax else sales end desc limit 6) x), '[]'::jsonb),
    -- M3: próximas salidas en orden cronológico (la ocupación crítica se avisa aparte).
    'upcoming_departures', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from upcoming_rows order by departure_at asc, occupancy asc limit 8) x), '[]'::jsonb)
  ) into out
  from current_summary cs, previous_summary ps, payment_summary pay, previous_payment_summary ppay,
       commission_summary com, receivable_summary rec, payable_summary pab, cash_summary cash;

  return out;
end;
$$;

revoke execute on function public.dashboard_summary(uuid, timestamptz, timestamptz, timestamptz, timestamptz, text, text, uuid, uuid, uuid, uuid, text, text, uuid) from anon, public;
grant execute on function public.dashboard_summary(uuid, timestamptz, timestamptz, timestamptz, timestamptz, text, text, uuid, uuid, uuid, uuid, text, text, uuid) to authenticated, service_role;
