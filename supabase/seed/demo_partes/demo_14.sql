-- SEMBRADOR DEMO - TROZO 14 de 14. Ejecutar EN ORDEN del 01 al 14.
-- Pegar entero (Ctrl+A, Run). Requiere las migraciones hasta 0099 aplicadas.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- EL BLOQUE DEL SOCIO: TOUR CENTERS Y AGENCIAS
--
-- POR QUÉ ESTE TROZO EXISTE
--
-- Medido sobre la base sembrada: `organizations` con `kind='partner'` tenía
-- CERO filas, y con ella se quedaban vacías `organization_relationships`,
-- `partner_product`, `allotment` y `partner_wallet_movement`. Es decir, las
-- fases 4, 5 y 6 enteras —portal del tour center, contrato socio-producto,
-- tarifario neto, cupos garantizados, monedero prepago— estaban construidas y
-- no había un solo dato con el que verlas funcionar.
--
-- Un módulo sin datos no se puede ni mirar: desde la pantalla no se distingue
-- «no hay nada» de «no funciona».
--
-- LOS DOS SOCIOS SON DISTINTOS A PROPÓSITO
--
-- El sistema admite dos formas EXCLUYENTES de trabajar con un canal externo, y
-- con una sola no se ve la diferencia:
--
--   · Caribe Tours Bávaro — a COMISIÓN y a CRÉDITO. Vende al precio público,
--     la operadora cobra al turista y le liquida su 18% después. Deja cuenta
--     por cobrar.
--   · Punta Cana Excursions — a NETO y PREPAGO. Compra a precio neto, cobra él
--     al turista y se queda el margen; no devenga comisión (sería cobrarlo dos
--     veces) y gasta de un saldo que recargó por adelantado.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── los dos socios ─────────────────────────────────────────────────────────
--
-- `tenant_org_id` apunta a la operadora: es lo que hace que el socio SEA de
-- esta empresa y no de otra, y de lo que cuelga todo el aislamiento.
insert into organizations (id, kind, tenant_org_id, name, slug, legal_name, email, phone,
    country, currency, timezone, status, brand_color, metadata)
select md5('demo:' || ('partner:1'))::uuid, 'partner',
    (select id from organizations where slug = 'havelgo-demo-presentaciones'),
    'Caribe Tours Bávaro', 'caribe-tours-bavaro', 'Caribe Tours Bávaro SRL',
    'reservas@caribetoursbavaro.do', '+1 809 555 0142', 'Republica Dominicana',
    'usd', 'America/Santo_Domingo', 'active', '#0ea5e9',
    jsonb_build_object('demo', true)
where not exists (select 1 from organizations where slug = 'caribe-tours-bavaro');

insert into organizations (id, kind, tenant_org_id, name, slug, legal_name, email, phone,
    country, currency, timezone, status, brand_color, metadata)
select md5('demo:' || ('partner:2'))::uuid, 'partner',
    (select id from organizations where slug = 'havelgo-demo-presentaciones'),
    'Punta Cana Excursions', 'punta-cana-excursions', 'Punta Cana Excursions EIRL',
    'ops@puntacanaexcursions.com', '+1 809 555 0177', 'Republica Dominicana',
    'usd', 'America/Santo_Domingo', 'active', '#f97316',
    jsonb_build_object('demo', true)
where not exists (select 1 from organizations where slug = 'punta-cana-excursions');

-- ── el contrato de cada uno ────────────────────────────────────────────────
--
-- `from_org_id` es la operadora y `to_org_id` el socio: esa dirección es la
-- que usa todo el código para resolver el ámbito.
--
-- Las condiciones ACEPTADAS (`terms_accepted_version` = `terms_version`) son
-- lo que deja al socio operar: con la versión sin aceptar, el portal le pide
-- firmarlas antes de dejarle reservar, que es justo lo que hay que poder
-- enseñar. Por eso uno las tiene aceptadas y el otro no.
insert into organization_relationships (id, from_org_id, to_org_id, relationship_type,
    default_commission_pct, credit_limit, credit_days, currency, status,
    contract_from, terms_version, terms_accepted_version, terms_accepted_at,
    pricing_model, payment_mode, collection_mode)
select md5('demo:' || ('rel:1'))::uuid,
    (select id from organizations where slug = 'havelgo-demo-presentaciones'),
    md5('demo:' || ('partner:1'))::uuid, 'tour_center',
    18, 5000, 15, 'usd', 'active',
    (current_date - 180), 1, 1, now() - interval '170 days',
    'commission', 'credit', 'operator_collects'
where not exists (select 1 from organization_relationships where id = md5('demo:' || ('rel:1'))::uuid);

insert into organization_relationships (id, from_org_id, to_org_id, relationship_type,
    default_commission_pct, credit_limit, credit_days, currency, status,
    contract_from, terms_version, terms_accepted_version, terms_accepted_at,
    pricing_model, payment_mode, collection_mode)
select md5('demo:' || ('rel:2'))::uuid,
    (select id from organizations where slug = 'havelgo-demo-presentaciones'),
    md5('demo:' || ('partner:2'))::uuid, 'agency',
    0, 0, 0, 'usd', 'active',
    (current_date - 60), 1, 1, now() - interval '55 days',
    'net', 'prepaid', 'pos_collects'
where not exists (select 1 from organization_relationships where id = md5('demo:' || ('rel:2'))::uuid);

-- ── qué productos tiene contratado cada uno (0077) ─────────────────────────
--
-- OJO: aquí NO se insertan filas. La 0077 le da a cada socio nuevo el catálogo
-- entero al darlo de alta, a propósito —un tour center que no pueda vender
-- nada hasta que alguien le autorice producto a producto parece un alta rota—.
--
-- Lo que hace falta enseñar es lo contrario: que el contrato ACOTA. Así que se
-- desactiva lo que cada uno no tiene contratado. Al vender, la venta comprueba
-- esta tabla, de modo que un producto desactivado aquí se rechaza de verdad.
update partner_product set status = 'inactive'
 where partner_id = md5('demo:' || ('partner:1'))::uuid
   and product_id not in (select md5('demo:' || ('product:' || n))::uuid from generate_series(1, 6) n);

update partner_product set status = 'inactive'
 where partner_id = md5('demo:' || ('partner:2'))::uuid
   and product_id not in (select md5('demo:' || ('product:' || n))::uuid from unnest(array[1, 2, 7, 8]) n);

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
