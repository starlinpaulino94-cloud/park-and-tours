-- LOS DOS SOCIOS DE LA DEMOSTRACIÓN — parte 2 de 2: tarifario neto, cupos y monedero prepago
--
-- Pégalo ENTERO en el editor SQL de Supabase (Ctrl+A, Run). Aguanta
-- ejecutarse dos veces. Requiere el resto del sembrador ya aplicado (necesita
-- la empresa `havelgo-demo-presentaciones` y sus productos).
--
-- PARA QUÉ. El portal del tour center, el contrato socio-producto, el
-- tarifario neto, los cupos garantizados y el monedero prepago salían vacíos
-- porque no había ni UN socio dado de alta. Esto los llena con dos socios que
-- trabajan de las dos formas que el sistema admite, que son excluyentes:
-- a comisión y a crédito, o a neto y prepago.
--
-- Las dos partes van EN ORDEN: la 2 necesita los socios que crea la 1.

-- ── el tarifario neto del socio que compra a neto (0078) ───────────────────
--
-- El neto sale del motor de precios con `partner_id` y canal `b2b_portal`: es
-- el MISMO camino que usa la reserva, así que el tarifario que se descarga y
-- lo que se cobra no pueden divergir. 22% por debajo del público.
insert into price_rule (id, organization_id, name, product_id, partner_id, channel,
    price_type, amount, currency, priority, status)
select md5('demo:' || ('pr:neto:' || n))::uuid,
    (select id from organizations where slug = 'havelgo-demo-presentaciones'),
    'Neto Punta Cana Excursions', md5('demo:' || ('product:' || n))::uuid,
    md5('demo:' || ('partner:2'))::uuid, 'b2b_portal',
    'per_person', round((p.base_price * 0.78)::numeric, 2), 'usd', 10, 'active'
from unnest(array[1, 2, 7, 8]) as n
join product p on p.id = md5('demo:' || ('product:' || n))::uuid
where not exists (select 1 from price_rule where id = md5('demo:' || ('pr:neto:' || n))::uuid);

-- ── el cupo garantizado del tour center (0054) ─────────────────────────────
--
-- Diez plazas reservadas por contrato en Isla Saona, que se liberan 2 días
-- antes si no las vende. Es lo que antes se llevaba en un Excel.
insert into allotment (id, organization_id, partner_id, product_id, allotment_type,
    seats, seats_used, release_days, valid_from, valid_to, status, notes)
select md5('demo:' || ('allot:1'))::uuid,
    (select id from organizations where slug = 'havelgo-demo-presentaciones'),
    md5('demo:' || ('partner:1'))::uuid, md5('demo:' || ('product:1'))::uuid,
    'guaranteed', 10, 4, 2, current_date - 30, current_date + 120, 'active',
    'Cupo garantizado por contrato anual. Se libera 2 días antes de cada salida.'
where not exists (select 1 from allotment where id = md5('demo:' || ('allot:1'))::uuid);

insert into allotment (id, organization_id, partner_id, product_id, allotment_type,
    seats, seats_used, release_days, valid_from, valid_to, status, notes)
select md5('demo:' || ('allot:2'))::uuid,
    (select id from organizations where slug = 'havelgo-demo-presentaciones'),
    md5('demo:' || ('partner:1'))::uuid, md5('demo:' || ('product:2'))::uuid,
    'on_request', 6, 0, 1, current_date - 30, current_date + 120, 'active',
    'Bajo petición: se confirma contra disponibilidad real.'
where not exists (select 1 from allotment where id = md5('demo:' || ('allot:2'))::uuid);

-- ── el monedero prepago del socio que paga por adelantado (0091) ───────────
--
-- Una recarga y dos consumos: el saldo se calcula SUMANDO los movimientos, no
-- guardando un número, para que no pueda quedarse desfasado.
insert into partner_wallet_movement (id, organization_id, partner_id, movement_type,
    amount, currency, reference, note, created_at)
select md5('demo:' || ('wal:1'))::uuid,
    (select id from organizations where slug = 'havelgo-demo-presentaciones'),
    md5('demo:' || ('partner:2'))::uuid, 'topup', 3000, 'usd',
    'TRF-88412', 'Transferencia bancaria recibida', now() - interval '40 days'
where not exists (select 1 from partner_wallet_movement where id = md5('demo:' || ('wal:1'))::uuid);

insert into partner_wallet_movement (id, organization_id, partner_id, movement_type,
    amount, currency, reference, note, created_at)
select md5('demo:' || ('wal:' || (1 + n)))::uuid,
    (select id from organizations where slug = 'havelgo-demo-presentaciones'),
    md5('demo:' || ('partner:2'))::uuid, 'consumption',
    (array[154.44, 187.20, 121.68])[n], 'usd',
    'ORD-DEMO-' || n, 'Consumo por reserva del portal', now() - ((40 - n * 9) || ' days')::interval
from generate_series(1, 3) as n
where not exists (select 1 from partner_wallet_movement where id = md5('demo:' || ('wal:' || (1 + n)))::uuid);
