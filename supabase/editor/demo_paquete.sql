-- ═══════════════════════════════════════════════════════════════════════════
-- PAQUETE DE DEMOSTRACIÓN — «Gran Combo Punta Cana» (3 días, US$279)
--
-- Pegar entero en el editor SQL de Supabase y darle a Run. Se puede repetir:
-- borra lo suyo antes de volver a crearlo.
--
-- ───────────────────────────────────────────────────────────────────────────
-- POR QUÉ TRAE SUS PROPIAS SALIDAS
--
-- Las salidas de la demo se reparten entre 8 productos, una por día. Para tres
-- productos cualesquiera, sus días NO caen consecutivos: Saona sale mañana,
-- Buggies dentro de cinco días y Hoyo Azul dentro de dos. Un paquete de días
-- 0-1-2 sobre ese calendario no encontraría itinerario nunca, y parecería que
-- la función está rota cuando lo que falta son salidas.
--
-- Así que se crean salidas propias para las tres actividades en los próximos
-- diez días. Con eso, cualquier día de inicio entre mañana y dentro de una
-- semana arma un itinerario completo.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── limpieza, para poder repetirlo ─────────────────────────────────────────
delete from product_bundle_item where bundle_id = md5('demo:combo:1')::uuid;
delete from departure where id in (
  select md5('demo:combo:dep:' || p || ':' || d)::uuid
    from generate_series(1, 3) p, generate_series(1, 10) d
);
delete from product where id = md5('demo:combo:1')::uuid;

-- ── el producto que ES el paquete ──────────────────────────────────────────
-- `is_bundle` explícito: es lo que impide que se venda como una excursión
-- suelta (crearía una cabecera con precio y cero componentes: una venta que no
-- reserva ninguna plaza ni sale en ningún manifiesto).
insert into product (id, organization_id, code, name, product_type, category_id,
    base_price, base_cost, currency, duration_hours, default_capacity,
    location, meeting_point, deposit_type, published, status, sort_order,
    is_bundle, bundle_buffer_minutes, description)
select md5('demo:combo:1')::uuid,
  (select id from organizations where slug = 'havelgo-demo-presentaciones'),
  'COMBO-001', 'Gran Combo Punta Cana', 'tour',
  md5('demo:' || ('cat:1'))::uuid,
  279, 118, 'usd', NULL, NULL,
  'Punta Cana', 'Recogida en el lobby del hotel',
  'none', true, 'active', 0,
  true, 45,
  'Tres días: Isla Saona, Buggies y Hoyo Azul. Precio cerrado por persona.';

-- ── las tres actividades, una por día ──────────────────────────────────────
-- `day_offset` 0/1/2 es lo que convierte esto en un combo de tres días. Cada
-- actividad conserva SU salida, SU cupo y SU check-in.
insert into product_bundle_item (id, organization_id, bundle_id, product_id, day_offset, sort_order)
values
  (md5('demo:combo:it:1')::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'),
   md5('demo:combo:1')::uuid, md5('demo:' || ('product:7'))::uuid, 0, 1),
  (md5('demo:combo:it:2')::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'),
   md5('demo:combo:1')::uuid, md5('demo:' || ('product:3'))::uuid, 1, 2),
  (md5('demo:combo:it:3')::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'),
   md5('demo:combo:1')::uuid, md5('demo:' || ('product:8'))::uuid, 2, 3);

-- ── salidas para los próximos diez días ────────────────────────────────────
-- `available_pax` se rellena: es una caché, y dejarla nula hace que el sistema
-- dé la salida por agotada.
insert into departure (id, organization_id, product_id, departure_at, departure_time,
    capacity, booked_pax, available_pax, cutoff_hours, meeting_point, status)
select
  md5('demo:combo:dep:' || p.n || ':' || d)::uuid,
  (select id from organizations where slug = 'havelgo-demo-presentaciones'),
  p.producto,
  (date_trunc('day', now()) + (d || ' days')::interval + p.hora),
  p.etiqueta,
  p.cupo, 0, p.cupo,
  4, 'Recogida en el lobby del hotel', 'available'
from generate_series(1, 10) as d
cross join (values
  (1, md5('demo:' || ('product:7'))::uuid, interval '8 hours',  '08:00', 120),
  (2, md5('demo:' || ('product:3'))::uuid, interval '9 hours',  '09:00', 16),
  (3, md5('demo:' || ('product:8'))::uuid, interval '9 hours',  '09:00', 30)
) as p(n, producto, hora, etiqueta, cupo);

-- ── comprobación: ¿arma itinerario empezando MAÑANA? ───────────────────────
-- Replica el filtro que usa el sistema al buscar salidas servibles.
select 'Día ' || (i.day_offset + 1) as dia,
       pr.name as actividad,
       to_char(dep.departure_at, 'DD/MM HH24:MI') as salida,
       dep.available_pax as plazas
  from product_bundle_item i
  join product pr on pr.id = i.product_id
  left join lateral (
    select d.* from departure d
     where d.product_id = i.product_id
       and d.status in ('available', 'almost_full')
       and d.departure_at >= date_trunc('day', now()) + ((i.day_offset + 1) || ' days')::interval
       and d.departure_at <  date_trunc('day', now()) + ((i.day_offset + 2) || ' days')::interval
     order by d.departure_at limit 1
  ) dep on true
 where i.bundle_id = md5('demo:combo:1')::uuid
 order by i.day_offset;
