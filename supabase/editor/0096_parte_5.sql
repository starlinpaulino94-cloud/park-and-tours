-- 0096 · parte 5 de 7 — trozo 4 de 4 del texto de la función
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

insert into app.editor_sql_0096 (n, txt) values (4, $trozo$      and d.departure_at >= now()
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
$$;$trozo$);

select count(*) as trozos_guardados, 4 as esperados from app.editor_sql_0096;
