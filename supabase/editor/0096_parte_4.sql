-- 0096 · parte 4 de 7 — trozo 3 de 4 del texto de la función
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

insert into app.editor_sql_0096 (n, txt) values (3, $trozo$    from payment_base
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
$trozo$);

select count(*) as trozos_guardados, 3 as esperados from app.editor_sql_0096;
