-- ═══════════════════════════════════════════════════════════════════════════
-- 0065 — QUE LA RECOGIDA DEJE DE SER UN TEXTO SUELTO
--
-- LO QUE HAY HOY
--
-- `hotel.pickup_offset_min` se pide en el formulario con esta ayuda literal:
-- «Minutos antes de la salida a los que pasa el transporte». Se guarda, se
-- pinta en dos pantallas… y ningún código lo lee nunca. La hora de recogida
-- que ve el cliente es la que tecleó quien vendió, a ojo. Es el mismo caso que
-- `cutoff_hours` antes de AUD-B07: un campo que la pantalla promete y la
-- operación no cumple.
--
-- Y las recogidas no se agrupan: `pickup.route_id` existe, pero nada lo llena.
-- `pickup_route.stops_count` y `pax_total` son números que alguien teclea y que
-- nadie vuelve a mirar. El conductor sale sin una lista ordenada de paradas.
--
-- LO QUE AÑADE ESTA MIGRACIÓN, Y POR QUÉ CADA COSA
--
-- `zone.pickup_offset_min` — el desfase por defecto de la zona. Sin esto, el
-- campo del hotel es inservible en la práctica: una operadora carga doscientos
-- hoteles y no va a poner el desfase uno por uno. La zona ya los agrupa por
-- dónde están, que es exactamente de lo que depende el desfase. El hotel manda
-- si tiene el suyo; si no, hereda el de su zona.
--
-- `pickup.planned_time` — la hora que CALCULA el motor, separada de
-- `pickup_time`, que es la hora PROMETIDA al cliente y ya impresa en su
-- voucher. Si el motor sobrescribiera, un cliente con un voucher que dice 07:15
-- pasaría a que lo recojan a las 07:00 sin que nadie se entere. Separadas, el
-- despacho ve la diferencia y decide: o avisa al cliente, o respeta lo pactado.
-- Cuando no hay nada prometido todavía, la calculada se copia a la prometida:
-- ahí no hay nada que romper.
--
-- `pickup.sequence` — el número de parada dentro de la ruta. Sin orden no hay
-- hoja de ruta: una lista de hoteles sin secuencia obliga al conductor a
-- decidir el recorrido en la calle.
--
-- `pickup_route.auto_key` — la huella de la ruta que armó el motor. Armar el
-- día tiene que poder repetirse: a media mañana entran reservas nuevas y hay
-- que rehacerlo. Sin una llave, cada clic duplicaría las rutas; borrando y
-- rehaciendo se perdería el conductor que el despacho asignó a mano. Con la
-- llave, rehacer ACTUALIZA la misma ruta y respeta lo que se tocó a mano.
--
-- `departure_resource.conflict_reason` — el estado 'conflict' ya existía en el
-- check desde 0010 y jamás se escribió. Ponerlo en rojo sin decir por qué
-- obliga a adivinar; el motivo va escrito al lado.
--
-- LO QUE DELIBERADAMENTE NO HACE
--
-- No añade orden de visita a la zona. El orden sale del propio desfase: a quien
-- se recoge con más antelación es a quien está más lejos, y esa es la primera
-- parada. Un segundo campo que dijera lo mismo acabaría contradiciendo al
-- primero.
--
-- No guarda distancias ni usa `latitude`/`longitude` para optimizar el
-- recorrido. Un optimizador de rutas de verdad necesita tráfico y calles
-- reales; uno de mentira, basado en la línea recta, daría recorridos peores que
-- los del conductor que lleva diez años haciéndolos. El motor ordena por hora,
-- que es lo que la operación ya usa.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── la zona presta su desfase a los hoteles que no tienen el suyo ───────────
alter table zone
  add column if not exists pickup_offset_min integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'zone_pickup_offset_min_check'
  ) then
    alter table zone
      add constraint zone_pickup_offset_min_check
      check (pickup_offset_min is null or (pickup_offset_min >= 0 and pickup_offset_min <= 600));
  end if;
end $$;

comment on column zone.pickup_offset_min is
  'Minutos antes de la salida a los que pasa el transporte por esta zona. El hotel manda sobre la zona.';

-- ── la recogida: hora calculada y número de parada ──────────────────────────
alter table pickup
  add column if not exists planned_time text,
  add column if not exists sequence     integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pickup_sequence_check') then
    alter table pickup
      add constraint pickup_sequence_check check (sequence is null or sequence >= 1);
  end if;
end $$;

comment on column pickup.planned_time is
  'Hora que calcula el motor (HH:MM). `pickup_time` es la prometida al cliente; el motor no la pisa.';
comment on column pickup.sequence is
  'Número de parada dentro de la ruta, empezando en 1.';

-- Las paradas de una ruta se leen siempre en orden.
create index if not exists pickup_route_sequence_idx
  on pickup (route_id, sequence)
  where route_id is not null;

-- ── la ruta armada por el motor se reconoce a sí misma ──────────────────────
alter table pickup_route
  add column if not exists auto_key text;

comment on column pickup_route.auto_key is
  'Huella de la ruta que armó el motor (salida + zona + nº de coche). Nula en las rutas hechas a mano.';

-- Rehacer el día actualiza la misma ruta en vez de duplicarla.
--
-- Es parcial por tamaño, no por corrección: a las rutas manuales no las protege
-- esta cláusula sino que Postgres considera distintos los nulos en un índice
-- único, así que dos rutas a mano de la misma salida y zona conviven igual con
-- `where` o sin él. Se filtra para no indexar filas que nunca se consultan por
-- esta llave.
create unique index if not exists pickup_route_auto_key_uidx
  on pickup_route (organization_id, departure_id, auto_key)
  where auto_key is not null;

-- ── el conflicto dice por qué lo es ─────────────────────────────────────────
alter table departure_resource
  add column if not exists conflict_reason text;

comment on column departure_resource.conflict_reason is
  'Por qué este recurso está en conflicto, en palabras que el despacho entiende. Nulo si no lo está.';

-- ═══════════════════════════════════════════════════════════════════════════
-- COMPROBACIÓN — que la migración falle aquí y no en producción
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  faltan text := '';
begin
  if not exists (select 1 from information_schema.columns
                 where table_name = 'zone' and column_name = 'pickup_offset_min')
    then faltan := faltan || 'zone.pickup_offset_min '; end if;

  if not exists (select 1 from information_schema.columns
                 where table_name = 'pickup' and column_name = 'planned_time')
    then faltan := faltan || 'pickup.planned_time '; end if;

  if not exists (select 1 from information_schema.columns
                 where table_name = 'pickup' and column_name = 'sequence')
    then faltan := faltan || 'pickup.sequence '; end if;

  if not exists (select 1 from information_schema.columns
                 where table_name = 'pickup_route' and column_name = 'auto_key')
    then faltan := faltan || 'pickup_route.auto_key '; end if;

  if not exists (select 1 from information_schema.columns
                 where table_name = 'departure_resource' and column_name = 'conflict_reason')
    then faltan := faltan || 'departure_resource.conflict_reason '; end if;

  if not exists (select 1 from pg_indexes
                 where indexname = 'pickup_route_auto_key_uidx')
    then faltan := faltan || 'índice pickup_route_auto_key_uidx '; end if;

  if faltan <> '' then
    raise exception '0065 incompleta, falta: %', faltan;
  end if;
end $$;
