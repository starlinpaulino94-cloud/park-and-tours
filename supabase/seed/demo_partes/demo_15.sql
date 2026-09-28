-- SEMBRADOR DEMO - TROZO 15 de 15. Ejecutar EN ORDEN del 01 al 15.
-- Pegar entero (Ctrl+A, Run). Requiere las migraciones hasta 0099 aplicadas.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- QUIÉN TRAJO AL CLIENTE, Y POR QUÉ ESTA COMISIÓN VALE MENOS
--
-- POR QUÉ ESTE TROZO EXISTE
--
-- Medido sobre la base sembrada: `seller_attribution` y `commission_adjustment`
-- tenían CERO filas. No porque faltara código —los dos caminos están enteros y
-- enchufados: el enlace corto escribe la visita, la venta escribe el paso de
-- reserva, el cobro completo escribe la compra, y la cancelación de una venta
-- ya pagada escribe el ajuste en negativo— sino porque el sembrador escribe
-- SQL directo y no pasa por el servicio que los escribiría.
--
-- Resultado: cuatro enlaces con QR y el embudo a cero, y un módulo de ajustes
-- que nadie ha visto nunca funcionar.
--
-- EL EMBUDO SE ESTRECHA, QUE ES DE LO QUE VA
--
-- El informe cuenta PERSONAS, no filas: agrupa por cliente y, cuando todavía no
-- hay cliente, por la cookie del visitante. Así que las visitas van anónimas
-- —con `visitor_id` y sin ficha, que es lo que hay cuando alguien escanea un
-- QR— y a partir del alta van con ficha. Sembrar las cuatro etapas con el mismo
-- reparto daría un embudo recto, que no enseña nada.
--
-- LOS DOS AJUSTES SON LOS DOS ARQUETIPOS
--
--   · Una RECUPERACIÓN: la venta se cayó después de haberle pagado la comisión.
--     La comisión sigue en `paid` a propósito —se pagó, y ponerle «anulada»
--     sería decir que nunca salió ese dinero—; lo que baja es el neto.
--   · Una CORRECCIÓN: se aplicó un porcentaje que no tocaba y se ajusta la
--     diferencia, sin reescribir la comisión original.
--
-- Los dos van enganchados a la liquidación LIQ-0002 (`settlement_id`), que es
-- la columna que dice QUÉ cierre se llevó el descuento, y los dos dejan el
-- `net_amount` de su comisión al día. Un ajuste que no mueva el neto sería
-- justo la incoherencia que este bloque viene a corregir.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. LAS VISITAS ─────────────────────────────────────────────────────────
-- Treinta por vendedor, anónimas y enganchadas a su enlace. La fecha se
-- reparte hacia atrás para que el informe de «últimos 30 días» tenga curva.
insert into seller_attribution (id, organization_id, seller_id, link_id, visitor_id, stage, channel, landing, campaign, created_at)
select md5('demo:' || ('attr:visit:' || s || ':' || v))::uuid,
    (select id from organizations where slug = 'havelgo-demo-presentaciones'),
    md5('demo:' || ('seller:' || s))::uuid,
    md5('demo:' || ('slink:' || s))::uuid,
    'visitante-' || s || '-' || lpad(v::text, 3, '0'),
    'visit',
    (array['qr','link','whatsapp','qr'])[s],
    '/e/vende-' || s,
    'temporada-alta',
    now() - ((v * 29 / 30.0) || ' days')::interval
from generate_series(1, 4) as s, generate_series(1, 30) as v
where not exists (
  select 1 from seller_attribution where id = md5('demo:' || ('attr:visit:' || s || ':' || v))::uuid
);

-- ── 2. LAS ALTAS ───────────────────────────────────────────────────────────
-- Ya con ficha: es el momento en que el visitante se convierte en cliente y la
-- atribución deja de colgar de una cookie.
insert into seller_attribution (id, organization_id, seller_id, link_id, customer_id, stage, channel, created_at)
select md5('demo:' || ('attr:signup:' || c.n))::uuid,
    (select id from organizations where slug = 'havelgo-demo-presentaciones'),
    md5('demo:' || ('seller:' || (1 + ((c.n - 1) % 4))))::uuid,
    md5('demo:' || ('slink:' || (1 + ((c.n - 1) % 4))))::uuid,
    md5('demo:' || ('cust:' || c.n))::uuid,
    'signup',
    (array['qr','link','whatsapp','qr'])[1 + ((c.n - 1) % 4)],
    now() - ((20 - (c.n % 18)) || ' days')::interval
from generate_series(1, 40) as c(n)
where exists (select 1 from customer where id = md5('demo:' || ('cust:' || c.n))::uuid)
  and not exists (
    select 1 from seller_attribution where id = md5('demo:' || ('attr:signup:' || c.n))::uuid
  );

-- ── 3. LA RESERVA ──────────────────────────────────────────────────────────
-- Un paso por cada venta real, con su orden y su reserva dentro: es lo que
-- escribe `recordTouch` al cerrar la venta, y lo que permite ir del informe a
-- la venta concreta.
insert into seller_attribution (id, organization_id, seller_id, customer_id, stage, channel, order_id, booking_id, created_at)
select md5('demo:' || ('attr:book:' || n))::uuid,
    b.organization_id, b.seller_id, b.customer_id, 'booking', o.channel::text, o.id, b.id,
    (b.travel_date - interval '3 days')
from generate_series(1, 60) as n
join booking b on b.id = md5('demo:' || ('book:' || n))::uuid
join sales_order o on o.id = b.order_id
where b.seller_id is not null
  and not exists (
    select 1 from seller_attribution where id = md5('demo:' || ('attr:book:' || n))::uuid
  );

-- ── 4. LA COMPRA ───────────────────────────────────────────────────────────
-- Solo las cobradas del todo. Una reserva que nadie paga no es una compra, y
-- contarla como tal inflaría el cierre de quien deja reservas colgadas por
-- encima del que cobra.
insert into seller_attribution (id, organization_id, seller_id, customer_id, stage, channel, order_id, created_at)
select md5('demo:' || ('attr:buy:' || n))::uuid,
    o.organization_id, o.seller_id, o.customer_id, 'purchase', o.channel::text, o.id,
    o.order_date::timestamptz + interval '2 hours'
from generate_series(1, 60) as n
join sales_order o on o.id = md5('demo:' || ('order:' || n))::uuid
where o.seller_id is not null
  and o.status in ('paid', 'completed')
  and not exists (
    select 1 from seller_attribution where id = md5('demo:' || ('attr:buy:' || n))::uuid
  );

-- ── 5. LA RECUPERACIÓN ─────────────────────────────────────────────────────
-- La venta se cayó después de haberle pagado la comisión. La comisión NO se
-- anula: se pagó. Lo que baja es el neto, y el motivo queda escrito.
insert into commission_adjustment (id, organization_id, commission_id, amount, currency, reason, reason_code, booking_id, settlement_id, created_at)
select md5('demo:' || ('cadj:1'))::uuid, c.organization_id, c.id,
    -c.amount, c.currency,
    'La reserva se canceló después de haberse pagado la comisión: se recupera en la próxima liquidación',
    'clawback', c.booking_id, md5('demo:' || ('setl:2'))::uuid,
    now() - interval '6 days'
from commission c
where c.id = md5('demo:' || ('com:4'))::uuid
  and not exists (select 1 from commission_adjustment where id = md5('demo:' || ('cadj:1'))::uuid);

-- ── 6. LA CORRECCIÓN ───────────────────────────────────────────────────────
-- Se aplicó un porcentaje que no tocaba. No se reescribe la comisión original
-- —el histórico diría que siempre fue otra cifra—: se ajusta la diferencia.
insert into commission_adjustment (id, organization_id, commission_id, amount, currency, reason, reason_code, booking_id, settlement_id, created_at)
select md5('demo:' || ('cadj:2'))::uuid, c.organization_id, c.id,
    -round(c.amount * 0.25, 2), c.currency,
    'Se liquidó al 8% una venta que iba al 6%: se ajusta la diferencia',
    'correction', c.booking_id, md5('demo:' || ('setl:2'))::uuid,
    now() - interval '3 days'
from commission c
where c.id = md5('demo:' || ('com:8'))::uuid
  and round(c.amount * 0.25, 2) <> 0
  and not exists (select 1 from commission_adjustment where id = md5('demo:' || ('cadj:2'))::uuid);

-- ── 7. EL NETO AL DÍA ──────────────────────────────────────────────────────
-- Lo que hace `syncCommissionNet` después de cada ajuste. Sin esto, la demo
-- enseñaría un ajuste escrito y un neto que no se ha enterado — que es
-- exactamente el descuadre que este bloque corrige en el código.
update commission c
   set adjustment_total = s.total,
       net_amount = greatest(0, round(c.amount + s.total, 2))
  from (
    select commission_id, sum(amount) as total
      from commission_adjustment
     where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones')
     group by commission_id
  ) s
 where c.id = s.commission_id
   and c.adjustment_total is distinct from s.total;

-- La comisión que se recuperó estaba PAGADA: es la mitad de la historia.
update commission
   set status = 'paid'
 where id = md5('demo:' || ('com:4'))::uuid
   and status <> 'paid';
