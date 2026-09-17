-- ═══════════════════════════════════════════════════════════════════════════
-- 0061 — COMBOS: VENDER UN PAQUETE DE VARIAS ACTIVIDADES
--
-- LO QUE NO SE PODÍA HACER
--
-- Un producto es atómico. «Saona + Buggy + Hoyo Azul, tres días, 180 dólares»
-- —que es el producto que más margen deja y el que una operadora pone en la
-- portada— no se puede vender. Lo que se hace hoy es teclear tres reservas
-- sueltas, cobrar a mano un precio que no es la suma, y rezar para que nadie
-- cancele una: el descuento del paquete vive en la cabeza de quien vendió.
--
-- ── POR QUÉ NO ES UN PRODUCTO CON UN PRECIO MÁS BARATO ────────────────────
--
-- Porque cada actividad del paquete tiene SU salida, SU cupo y SU check-in, en
-- días distintos. Si el combo fuera un producto suelto:
--
--  · el autobús de Saona del jueves no sabría que lleva a esa gente;
--  · el manifiesto del buggy del viernes no los tendría;
--  · y el cupo de las tres salidas no bajaría, así que se sobrevendería.
--
-- ── CÓMO SE MODELA, Y POR QUÉ ASÍ ────────────────────────────────────────
--
-- Una venta de combo son N+1 reservas en la misma orden:
--
--  · UNA CABECERA con el producto-combo y el PRECIO del paquete. No tiene
--    salida: el paquete no sale ningún día, salen sus actividades.
--  · N COMPONENTES, uno por actividad, cada uno con su salida real, sus
--    pasajeros y su check-in. Su importe es CERO — el dinero está en la
--    cabecera— pero consumen cupo y aparecen en su manifiesto.
--
-- La alternativa era repartir el precio entre los componentes. Se descartó: el
-- descuento del paquete no se puede repartir de una forma que no mienta, y el
-- día que el cliente cancele una sola actividad habría que decidir cuánto vale
-- esa parte de un precio que nunca fue por partes.
--
-- Con la cabecera, la respuesta es la que el negocio ya usa: se cancela el
-- paquete entero y se aplica su política, o no se cancela.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── el producto que es un paquete ──────────────────────────────────────────
alter table product
  -- Explícito y no derivado de `product_type`, que es texto libre y ya se usa
  -- para otras cosas ('excursion', 'transfer'). Una bandera que decide si un
  -- producto se puede vender solo no puede depender de cómo alguien escriba.
  add column if not exists is_bundle boolean not null default false,
  -- Minutos de margen entre dos actividades del paquete: el traslado, la cola,
  -- el almuerzo. Sin esto, un itinerario «válido» pondría a la gente saliendo
  -- de un sitio en el mismo minuto en que entra al siguiente.
  add column if not exists bundle_buffer_minutes integer not null default 30;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'product_bundle_buffer_check') then
    alter table product add constraint product_bundle_buffer_check
      check (bundle_buffer_minutes >= 0 and bundle_buffer_minutes <= 720);
  end if;
end $$;

create index if not exists product_bundle_idx
  on product (organization_id, is_bundle) where is_bundle;

-- ── de qué se compone ──────────────────────────────────────────────────────
create table if not exists product_bundle_item (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  -- El paquete.
  bundle_id  uuid not null references product(id) on delete cascade,
  -- La actividad que va dentro. `restrict` y no `cascade`: borrar una excursión
  -- que está dentro de un paquete vendido tiene que doler, no pasar en silencio.
  product_id uuid not null references product(id) on delete restrict,
  modality_id uuid references product_modality(id) on delete set null,

  -- En qué día del paquete. 0 = el mismo día que empieza. Es lo que hace que un
  -- combo de tres días sea posible.
  day_offset integer not null default 0,
  -- Orden dentro del día, para el itinerario y para el voucher.
  sort_order integer not null default 0,
  -- Hora fija pactada ('09:00'), cuando la actividad solo sale a esa hora en
  -- este paquete. Vacío = se elige la salida que encaje.
  fixed_time text,
  -- Actividades que SÍ pueden solaparse: un pase de día a un parque no compite
  -- con una excursión de dos horas dentro de ese mismo parque.
  allow_overlap boolean not null default false,
  -- Opcional: el cliente elige si la quiere. No consume cupo si no la toma.
  is_optional boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bundle_id, product_id, day_offset)
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'bundle_item_day_offset_check') then
    alter table product_bundle_item add constraint bundle_item_day_offset_check
      check (day_offset >= 0 and day_offset <= 60);
  end if;
  -- Formato de hora, no texto libre: 'por la mañana' no lo puede ordenar nadie.
  if not exists (select 1 from pg_constraint where conname = 'bundle_item_fixed_time_check') then
    alter table product_bundle_item add constraint bundle_item_fixed_time_check
      check (fixed_time is null or fixed_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  end if;
  -- UN PAQUETE NO SE CONTIENE A SÍ MISMO. Sin esto, resolver el itinerario
  -- entraría en un bucle infinito la primera vez que alguien se equivoque al
  -- elegir en el desplegable.
  if not exists (select 1 from pg_constraint where conname = 'bundle_item_not_self_check') then
    alter table product_bundle_item add constraint bundle_item_not_self_check
      check (bundle_id <> product_id);
  end if;
end $$;

create index if not exists bundle_item_bundle_idx
  on product_bundle_item (organization_id, bundle_id, day_offset, sort_order);
create index if not exists bundle_item_product_idx on product_bundle_item (product_id);

drop trigger if exists bundle_item_touch on product_bundle_item;
create trigger bundle_item_touch before update on product_bundle_item
for each row execute function app.touch_updated_at();

drop trigger if exists bundle_item_same_tenant on product_bundle_item;
create trigger bundle_item_same_tenant
before insert or update of organization_id, bundle_id, product_id, modality_id
on product_bundle_item
for each row execute function app.enforce_same_tenant_refs(
  'bundle_id', 'product',
  'product_id', 'product',
  'modality_id', 'product_modality'
);

-- ── UN PAQUETE NO METE OTRO PAQUETE DENTRO ─────────────────────────────────
--
-- El `check` de arriba impide que se contenga a sí mismo directamente. Esto
-- impide el ciclo de dos pasos —A contiene a B, B contiene a A— y, de paso,
-- que un paquete contenga cualquier paquete.
--
-- Se prohíbe anidar a propósito y no por pereza: un paquete de paquetes
-- multiplica el itinerario por combinaciones que ningún vendedor puede revisar
-- antes de cobrar, y el día que uno de los dos cambie de horario nadie sabría
-- qué venta quedó rota.
create or replace function app.bundle_item_no_nesting()
returns trigger
language plpgsql
as $$
declare
  hijo_es_paquete boolean;
begin
  select is_bundle into hijo_es_paquete from product where id = new.product_id;
  if coalesce(hijo_es_paquete, false) then
    raise exception 'un paquete no puede contener otro paquete (producto %)', new.product_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists bundle_item_no_nesting on product_bundle_item;
create trigger bundle_item_no_nesting
before insert or update of product_id on product_bundle_item
for each row execute function app.bundle_item_no_nesting();

-- ── la reserva de un componente ────────────────────────────────────────────
alter table booking
  -- La cabecera del paquete al que pertenece este componente. Nulo en una
  -- reserva normal, que es la inmensa mayoría.
  add column if not exists bundle_booking_id uuid references booking(id) on delete cascade,
  -- Qué componente del paquete es. Sirve para el voucher y para saber qué
  -- reconstruir si el paquete se reprograma.
  add column if not exists bundle_item_id uuid references product_bundle_item(id) on delete set null;

create index if not exists booking_bundle_idx
  on booking (organization_id, bundle_booking_id) where bundle_booking_id is not null;

drop trigger if exists booking_bundle_same_tenant on booking;
create trigger booking_bundle_same_tenant
before insert or update of organization_id, bundle_booking_id, bundle_item_id on booking
for each row execute function app.enforce_same_tenant_refs(
  'bundle_booking_id', 'booking',
  'bundle_item_id', 'product_bundle_item'
);

-- ── UN COMPONENTE NO ES CABECERA DE NADIE ──────────────────────────────────
--
-- Solo dos niveles: la cabecera y sus componentes. Si un componente pudiera ser
-- cabecera, cancelar el paquete tendría que recorrer un árbol de profundidad
-- desconocida, y el día que ese recorrido se quede a medias habría plazas
-- bloqueadas en una salida sin ninguna reserva que las explique.
create or replace function app.booking_bundle_depth()
returns trigger
language plpgsql
as $$
declare
  padre_es_componente uuid;
begin
  if new.bundle_booking_id is null then return new; end if;

  if new.bundle_booking_id = new.id then
    raise exception 'una reserva no puede ser su propia cabecera de paquete (id=%)', new.id
      using errcode = '23514';
  end if;

  select bundle_booking_id into padre_es_componente
    from booking where id = new.bundle_booking_id;
  if padre_es_componente is not null then
    raise exception 'un componente de paquete no puede ser cabecera de otro (id=%)', new.id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists booking_bundle_depth on booking;
create trigger booking_bundle_depth
before insert or update of bundle_booking_id on booking
for each row execute function app.booking_bundle_depth();

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'product_bundle_item' and policyname = 'tenant_select') then
    perform app.enable_tenant_rls('public.product_bundle_item');
  end if;
end $$;
