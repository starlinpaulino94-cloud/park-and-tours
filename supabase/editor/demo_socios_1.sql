-- LOS DOS SOCIOS DE LA DEMOSTRACIÓN — parte 1 de 2: los socios, su contrato y qué pueden vender
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
