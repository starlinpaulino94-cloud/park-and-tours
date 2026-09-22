-- ============================================================================
-- SEMBRADOR DE DEMOSTRACIÓN — PARTE 2 DE 3.  Ventas, reservas, cobros, facturas, comisiones, caja y encuestas.
--
-- Se ejecuta en el editor SQL de Supabase. Pégalo ENTERO (Ctrl+A, Run).
-- El archivo se partió en tres porque el editor trunca los pegados grandes.
-- EJECÚTALOS EN ORDEN: 1, luego 2, luego 3. Cada uno recrea lo que necesita.
-- Todo cuelga de la empresa `havelgo-demo-presentaciones` y es idempotente.
-- ============================================================================

-- Identificador determinista: md5 de un texto → uuid estable.
create or replace function pg_temp.d(text) returns uuid
  language sql immutable as $$ select md5('demo:' || $1)::uuid $$;

-- La empresa demo, creada si falta. Su slug es fijo.
insert into organizations (kind, name, slug, legal_name, company_type,
    subscription_status, modules_enabled, status, currency, timezone, country, metadata)
select 'tenant', 'Havelgo Demo Tours', 'havelgo-demo-presentaciones',
    'Havelgo Demo Tours SRL', 'mixed_operator', 'active',
    array['bookings','crm','commissions','settlements','payments','cash_pos','transport',
          'pickups','operations','b2b_portal','accounting','reports','audit'],
    'active', 'usd', 'America/Santo_Domingo', 'República Dominicana',
    jsonb_build_object('demo', true, 'purpose', 'client_presentations')
where not exists (select 1 from organizations where slug = 'havelgo-demo-presentaciones');

update organizations set tenant_org_id = id
 where slug = 'havelgo-demo-presentaciones' and tenant_org_id is null;

-- El id de la empresa demo, para no repetir la subconsulta.
create or replace function pg_temp.org() returns uuid
  language sql stable as $$
    select id from organizations where slug = 'havelgo-demo-presentaciones'
  $$;

-- Limpieza dirigida (solo lo de esta parte; salta tablas que aún no existan).
do $$
declare t text; orden text[] := array['guest_survey', 'expense', 'cash_movement', 'cash_session', 'cash_register', 'invoice_line', 'invoice', 'ncf_sequence', 'receivable', 'payment', 'booking_cost', 'commission', 'pickup', 'voucher', 'participant', 'booking', 'sales_order'];
begin
  foreach t in array orden loop
    if to_regclass('public.' || t) is not null then
      execute format('delete from %I where organization_id = pg_temp.org()', t);
    end if;
  end loop;
end $$;

-- ── VENTA Y SU RASTRO ───────────────────────────────────────────────────────
-- Una tabla auxiliar con las 60 ventas ya calculadas. Todo lo que sigue —orden,
-- reserva, pagos, factura, comisión— sale de aquí, así que los importes cuadran
-- entre módulos en vez de inventarse en cada uno.
--
-- Es una tabla NORMAL, no temporal, a propósito: el editor SQL de Supabase usa
-- un pool de conexiones y NO conserva las tablas temporales entre sentencias
-- («relation "v" does not exist»). Una tabla normal sí persiste; se borra al
-- final. El nombre lleva prefijo para no chocar con nada.
drop table if exists demo_seed_rows;
create table demo_seed_rows as
with base as (
  select
    n,
    1 + ((n - 1) % 8) as prod,
    1 + ((n - 1) % 40) as cust,
    1 + ((n - 1) % 4) as seller,
    (date_trunc('day', now()) + ((n - 30) || ' days')::interval)::date as travel_date,
    2 + (n % 3) as adults,
    (n % 2) as children,
    (array[89,75,120,65,95,55,99,110])[1 + ((n - 1) % 8)]::numeric as price,
    (array[38,32,54,28,40,22,44,49])[1 + ((n - 1) % 8)]::numeric as unit_cost
  from generate_series(1, 60) as n
), calc as (
  select b.*,
    (b.adults + b.children) as pax_total,
    (b.price * b.adults + round(b.price * 0.6) * b.children) as gross,
    case when b.n % 4 = 0 then round((b.price * b.adults + round(b.price * 0.6) * b.children) * 0.10) else 0 end as discount,
    (b.unit_cost * (b.adults + b.children)) as cost_amount
  from base b
), money as (
  select c.*,
    (c.gross - c.discount) as total,
    case c.n % 5 when 0 then 0
                 when 1 then round((c.gross - c.discount) * 0.5)
                 else (c.gross - c.discount) end as paid
  from calc c
)
select
  m.*,
  (m.travel_date < current_date) as pasada,
  case
    when m.paid = 0 then 'pending_payment'
    when m.paid < m.total then 'partially_paid'
    when m.travel_date < current_date then 'completed'
    else 'paid'
  end as estado,
  (array['web','walk_in','ota','phone','agency','direct','whatsapp','tour_center'])[1 + (m.n % 8)] as canal
from money m;

-- Evita que el editor de Supabase inyecte su propio ALTER ... ENABLE RLS
-- al final (caería tras el DROP de abajo). Como somos dueños, no nos bloquea.
alter table demo_seed_rows enable row level security;

insert into sales_order (id, organization_id, order_number, customer_id, seller_id, channel, status,
    currency, exchange_rate, subtotal, discount_total, tax_total, total, paid_total, balance, order_date)
select pg_temp.d('order:' || v.n), pg_temp.org(), 'ORD-' || lpad(v.n::text, 4, '0'),
    pg_temp.d('cust:' || v.cust), pg_temp.d('seller:' || v.seller), v.canal::sales_channel, v.estado,
    'usd'::currency, 1, v.gross, v.discount, 0, v.total, v.paid, v.total - v.paid,
    (v.travel_date - 3)::date
from demo_seed_rows v;

insert into booking (id, organization_id, booking_number, order_id, customer_id, product_id, departure_id,
    modality_id, seller_id, travel_date, adults, children, pax_total, gross_amount, discount_amount,
    tax_amount, total_amount, paid_amount, balance_amount, cost_amount, margin_amount, currency,
    channel, status, checkin_status, hotel_id, exchange_rate, unit_price, booking_date)
select pg_temp.d('book:' || v.n), pg_temp.org(), 'RES-' || lpad(v.n::text, 4, '0'),
    pg_temp.d('order:' || v.n), pg_temp.d('cust:' || v.cust), pg_temp.d('product:' || v.prod),
    pg_temp.d('dep:' || v.n), pg_temp.d('mod:' || v.prod || ':ad'), pg_temp.d('seller:' || v.seller),
    v.travel_date, v.adults, v.children, v.pax_total, v.gross, v.discount, 0, v.total, v.paid,
    v.total - v.paid, v.cost_amount, v.total - v.cost_amount, 'usd'::currency, v.canal::sales_channel,
    case when v.pasada then 'completed' when v.paid = 0 then 'pending_payment'
         when v.paid < v.total then 'partially_paid' else 'paid' end,
    case when v.pasada then 'done' else 'pending' end,
    pg_temp.d('hotel:' || (1 + (v.n % 5))), 1, v.price, (v.travel_date - 3)::date
from demo_seed_rows v;

-- Participantes: el titular por reserva, más un acompañante en la mitad.
insert into participant (id, organization_id, booking_id, full_name, checkin_status)
select pg_temp.d('part:' || v.n || ':1'), pg_temp.org(), pg_temp.d('book:' || v.n),
    'Titular reserva ' || v.n, case when v.pasada then 'done' else 'pending' end
from demo_seed_rows v
union all
select pg_temp.d('part:' || v.n || ':2'), pg_temp.org(), pg_temp.d('book:' || v.n),
    'Acompañante ' || v.n, case when v.pasada then 'done' else 'pending' end
from demo_seed_rows v where v.children > 0 or v.n % 2 = 0;

-- Un voucher por reserva.
insert into voucher (id, organization_id, booking_id, code, status)
select pg_temp.d('vou:' || v.n), pg_temp.org(), pg_temp.d('book:' || v.n),
    'VCH-' || lpad(v.n::text, 5, '0'),
    case when v.pasada then 'used' else 'valid' end
from demo_seed_rows v;

-- Recogidas de las reservas futuras confirmadas.
insert into pickup (id, organization_id, booking_id, hotel_id, status, pickup_time)
select pg_temp.d('pick:' || v.n), pg_temp.org(), pg_temp.d('book:' || v.n),
    pg_temp.d('hotel:' || (1 + (v.n % 5))),
    case when v.pasada then 'picked_up' else 'confirmed' end,
    '07:00'
from demo_seed_rows v where v.paid > 0;

-- ── DINERO ──────────────────────────────────────────────────────────────────
-- Un pago por cada venta con algo cobrado.
insert into payment (id, organization_id, order_id, customer_id, reference, payment_type, method, status,
    amount, currency, exchange_rate, paid_at)
select pg_temp.d('pay:' || v.n), pg_temp.org(), pg_temp.d('order:' || v.n), pg_temp.d('cust:' || v.cust),
    'PAY-' || lpad(v.n::text, 5, '0'), 'payment'::payment_kind,
    (array['cash','card','transfer','link','card']::payment_method[])[1 + (v.n % 5)], 'completed',
    v.paid, 'usd'::currency, 1, (v.travel_date - 2)::timestamptz
from demo_seed_rows v where v.paid > 0;

-- Cuenta por cobrar por cada venta con saldo.
insert into receivable (id, organization_id, order_id, customer_id, document_number, amount, paid_amount,
    balance, currency, status, issue_date, due_date)
select pg_temp.d('rec:' || v.n), pg_temp.org(), pg_temp.d('order:' || v.n), pg_temp.d('cust:' || v.cust),
    'CxC-' || lpad(v.n::text, 5, '0'), v.total, v.paid, v.total - v.paid, 'usd'::currency,
    case when v.travel_date < current_date then 'overdue' else 'pending' end,
    (v.travel_date - 3)::date, (v.travel_date + 7)::date
from demo_seed_rows v where v.total - v.paid > 0;

-- La secuencia de NCF de consumo.
insert into ncf_sequence (id, organization_id, ncf_type, status) values
  (pg_temp.d('ncfseq:b02'), pg_temp.org(), 'b02', 'active');

-- Factura emitida para cada venta pagada por completo.
insert into invoice (id, organization_id, number, ncf, ncf_type, invoice_type, status, issued_at,
    subtotal, tax, tax_rate, discount, total, paid_amount, currency, exchange_rate,
    customer_name, customer_tax_id, customer_id, order_id)
select pg_temp.d('inv:' || v.n), pg_temp.org(), 'FAC-' || lpad(v.n::text, 5, '0'),
    'B02' || lpad(v.n::text, 8, '0'), 'b02', 'sale', 'paid', (v.travel_date - 2)::timestamptz,
    round(v.total / 1.18, 2), round(v.total - v.total / 1.18, 2), 18, v.discount, v.total, v.total,
    'usd'::currency, 1, 'Cliente ' || v.cust, NULL, pg_temp.d('cust:' || v.cust), pg_temp.d('order:' || v.n)
from demo_seed_rows v where v.paid >= v.total and v.paid > 0;

insert into invoice_line (id, organization_id, invoice_id, description, quantity, unit_price, total)
select pg_temp.d('invl:' || v.n), pg_temp.org(), pg_temp.d('inv:' || v.n),
    'Excursión ' || v.prod || ' — ' || v.pax_total || ' pax', v.pax_total, v.price, v.total
from demo_seed_rows v where v.paid >= v.total and v.paid > 0;

-- Comisión del vendedor por cada reserva.
insert into commission (id, organization_id, booking_id, order_id, seller_id, beneficiary_type,
    calc_type, base_amount, percentage, amount, currency, status, beneficiary_name)
select pg_temp.d('com:' || v.n), pg_temp.org(), pg_temp.d('book:' || v.n), pg_temp.d('order:' || v.n),
    pg_temp.d('seller:' || v.seller), 'seller'::beneficiary_type, 'percentage'::calc_type,
    v.total, (array[8,8,6,12])[v.seller], round(v.total * (array[8,8,6,12])[v.seller] / 100.0, 2),
    'usd'::currency,
    case when v.travel_date < current_date then 'approved' else 'pending' end,
    'Vendedor ' || v.seller
from demo_seed_rows v;

-- Coste del proveedor de transporte por reserva (lo que se liquida los viernes).
insert into booking_cost (id, organization_id, booking_id, supplier_id, concept, cost_type, quantity,
    unit_cost, amount, currency, status)
select pg_temp.d('bcost:' || v.n), pg_temp.org(), pg_temp.d('book:' || v.n), pg_temp.d('sup:1'),
    'Transporte terrestre', 'per_group', 1, v.cost_amount, v.cost_amount, 'usd'::currency,
    case when v.travel_date < current_date then 'confirmed' else 'accrued' end
from demo_seed_rows v;

-- Caja: dos registradoras, sesiones y movimientos de los pagos en efectivo.
insert into cash_register (id, organization_id, name, code, currency, status, branch_id) values
  (pg_temp.d('reg:1'), pg_temp.org(), 'Caja Bávaro', 'CJ-BAV', 'usd', 'active', pg_temp.d('branch:1')),
  (pg_temp.d('reg:2'), pg_temp.org(), 'Caja Marina', 'CJ-MAR', 'usd', 'active', pg_temp.d('branch:2'));

insert into cash_session (id, organization_id, cash_register_id, opening_amount, sales_total, status,
    opened_at, closed_at, currency, exchange_rate) values
  (pg_temp.d('csess:1'), pg_temp.org(), pg_temp.d('reg:1'), 200, 0, 'closed',
     (now() - interval '2 days')::timestamptz, (now() - interval '2 days' + interval '9 hours')::timestamptz, 'usd', 1),
  (pg_temp.d('csess:2'), pg_temp.org(), pg_temp.d('reg:1'), 200, 0, 'open',
     date_trunc('day', now()) + interval '7 hours', NULL, 'usd', 1);

-- Cada pago en efectivo mueve la caja.
insert into cash_movement (id, organization_id, cash_session_id, payment_id, movement_type, amount,
    currency, concept, movement_at)
select pg_temp.d('cmov:' || v.n), pg_temp.org(), pg_temp.d('csess:1'), pg_temp.d('pay:' || v.n),
    'sale', v.paid, 'usd'::currency, 'Venta ' || v.n, (v.travel_date - 2)::timestamptz
from demo_seed_rows v where v.paid > 0 and (v.n % 5) not in (0, 1) and (v.n % 5) = 2;

-- Gastos del mes, algunos con NCF para el 606.
insert into expense (id, organization_id, category_id, supplier_id, concept, amount, currency,
    expense_date, payment_method, status, ncf, ncf_type, supplier_rnc, itbis_amount, goods_service_type)
select pg_temp.d('exp:' || n), pg_temp.org(),
    pg_temp.d('exc:' || (1 + (n % 3))), pg_temp.d('sup:' || (1 + (n % 4))),
    (array['Diésel flota','Repuestos van','Comisión OTA','Peajes','Lavado vehículos',
           'Aceite y filtros','Combustible catamarán','Cargo pasarela','Mantenimiento buggies',
           'Uniformes guías','Agua y hielo','Publicidad redes'])[1 + ((n - 1) % 12)],
    (array[1200,450,890,120,80,340,600,210,520,300,90,450])[1 + ((n - 1) % 12)],
    'usd'::currency, (current_date - (n * 2))::date,
    (array['cash','transfer','card']::payment_method[])[1 + (n % 3)], 'approved',
    'B01' || lpad(n::text, 8, '0'), 'b01', '13' || lpad(n::text, 7, '0'),
    round((array[1200,450,890,120,80,340,600,210,520,300,90,450])[1 + ((n - 1) % 12)] * 0.18, 2), '09'
from generate_series(1, 12) as n;


-- Encuestas post-tour (dependen de la tabla auxiliar, por eso van aquí).
do $$
begin
  -- guest_survey es de la migración 0067; si la base va por detrás no existe,
  -- y el SQL estático dentro de un IF no tomado ni se planifica, así que no
  -- rompe el sembrado. Lo demás se carga igual.
  if to_regclass('public.guest_survey') is not null then
  -- Encuestas: respondidas para salidas pasadas (con NPS y notas), pendientes para las próximas.
  insert into guest_survey (id, organization_id, booking_id, departure_id, product_id, customer_id,
      guide_staff_id, token, status, asked_at, answered_at, nps, rating_guide, rating_transport,
      rating_value, comment, language)
  select pg_temp.d('surv:' || v.n), pg_temp.org(), pg_temp.d('book:' || v.n), pg_temp.d('dep:' || v.n),
      pg_temp.d('product:' || v.prod), pg_temp.d('cust:' || v.cust), pg_temp.d('staff:1'),
      'TOK-' || lpad(v.n::text, 6, '0'),
      'answered', (v.travel_date + 1)::timestamptz, (v.travel_date + 1)::timestamptz,
      (array[10,9,8,10,7,9,10,6,9,8])[1 + (v.n % 10)],
      (array[5,5,4,5,4,5,5,3,4,5])[1 + (v.n % 10)],
      (array[5,4,4,5,3,5,4,3,5,4])[1 + (v.n % 10)],
      (array[5,4,5,5,4,4,5,3,4,5])[1 + (v.n % 10)],
      (array['¡Excelente día!','Muy recomendable','El guía fue genial','Repetiremos','Todo perfecto'])[1 + (v.n % 5)],
      'es'
  from demo_seed_rows v where v.travel_date < current_date and v.n % 2 = 0;

  insert into guest_survey (id, organization_id, booking_id, departure_id, product_id, customer_id,
      token, status, asked_at, expires_at, language)
  select pg_temp.d('survp:' || v.n), pg_temp.org(), pg_temp.d('book:' || v.n), pg_temp.d('dep:' || v.n),
      pg_temp.d('product:' || v.prod), pg_temp.d('cust:' || v.cust),
      'TOKP-' || lpad(v.n::text, 6, '0'), 'pending', now(), now() + interval '7 days', 'es'
  from demo_seed_rows v where v.travel_date >= current_date and v.n % 3 = 0;
  else
    raise warning 'guest_survey no existe (falta la migración 0067): se omiten las encuestas.';
  end if;
end $$;

-- La tabla auxiliar ya cumplió su función.
drop table if exists demo_seed_rows;
