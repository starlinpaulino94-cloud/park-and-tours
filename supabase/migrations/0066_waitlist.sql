-- ═══════════════════════════════════════════════════════════════════════════
-- 0066 — LA LISTA DE ESPERA
--
-- LO QUE PASA HOY
--
-- Saona se llena el jueves. El viernes llama una familia de cuatro y la
-- respuesta es «lo siento, está lleno». Se van a la competencia y en el sistema
-- no queda ni rastro de que existieron: ni cuántos se quedaron fuera, ni a
-- quién avisar cuando alguien cancele el sábado.
--
-- `departure.waitlist_pax` existe desde 0030. Se escribe a cero en dos sitios y
-- no lo lee nadie. Es el mismo caso que `hotel.pickup_offset_min` antes de la
-- ola 9: un campo que promete una funcionalidad que no existe.
--
-- LA DECISIÓN QUE GOBIERNA TODO EL DISEÑO
--
-- Ofrecer una plaza CREA LA RESERVA DE VERDAD, con la retención que ya existe
-- (`order.hold_until` + `releaseExpiredHolds`, de la ola 3).
--
-- La alternativa —avisar al cliente y que venga a comprar— parece más simple y
-- es peor: entre el aviso y la llamada, cualquiera compra esa plaza en el
-- mostrador. El cliente llega habiendo sido avisado de algo que ya no existe,
-- que es exactamente la clase de mentira que estas olas vienen quitando.
--
-- Con una reserva real: el asiento está apartado de verdad, caduca solo por un
-- camino ya probado, y convertir es sencillamente cobrar. No hace falta ningún
-- mecanismo de retención nuevo ni tocar el motor de disponibilidad.
--
-- POR QUÉ EL CONTACTO VA SUELTO Y NO COMO CLIENTE
--
-- Apuntarse tiene que costar diez segundos con el cliente delante del
-- mostrador. Exigir una ficha de cliente convertiría el gesto en un alta, y el
-- vendedor no lo haría: se quedaría en el «lo siento, está lleno» de siempre.
-- Si hay ficha, se enlaza; si no, bastan un nombre y un teléfono.
--
-- LO QUE NO LLEVA, A PROPÓSITO
--
-- No hay prioridad ni orden manual. La cola es por orden de llegada, que es lo
-- único que un cliente acepta sin discutir y lo único que el vendedor puede
-- defender delante de él. Un campo de prioridad acabaría usándose para colar a
-- alguien, y entonces la lista deja de ser una lista.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists waitlist_entry (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,

  departure_id uuid not null references departure(id) on delete cascade,

  -- Quién espera. La ficha si la hay; si no, lo que el vendedor alcanzó a
  -- apuntar. Uno de los dos tiene que estar: una espera sin forma de avisar no
  -- sirve para nada, y eso lo exige el check de abajo.
  --
  -- `cascade` y no `set null`, por dos motivos que se descubrieron probándolo:
  --
  --  1. Con `set null`, borrar un cliente cuya espera no tenía teléfono propio
  --     dejaba la fila sin ninguna forma de contacto y Postgres rechazaba el
  --     borrado entero. O sea: una espera pendiente impedía borrar la ficha del
  --     cliente. Alguien que pide que borren sus datos no podría.
  --  2. Y es lo correcto además de lo práctico: una espera es un dato personal
  --     de esa misma persona —su nombre, su teléfono, qué quería comprar—, así
  --     que se va con su ficha. La espera de mostrador, que nunca tuvo ficha,
  --     no se ve afectada.
  customer_id   uuid references customer(id) on delete cascade,
  contact_name  text,
  contact_phone text,
  contact_email text,

  -- Quién la apuntó, para que la venta recuperada tenga dueño.
  seller_id  uuid references seller(id) on delete set null,
  partner_id uuid references organizations(id) on delete set null,

  pax integer not null check (pax >= 1),

  -- `waiting`   — en la cola, sin plaza apartada.
  -- `offered`   — se le creó la reserva y tiene hasta `offer_expires_at`.
  -- `converted` — pagó. Lo escribe el servicio al cobrarse su reserva.
  -- `expired`   — se le pasó el turno, o la salida ya salió.
  -- `cancelled` — se dio de baja, o el vendedor la quitó.
  status text not null default 'waiting' check (status in
           ('waiting','offered','converted','expired','cancelled')),

  offered_at        timestamptz,
  offer_expires_at  timestamptz,
  -- La reserva que salió de esta espera. Es lo que permite contestar la única
  -- pregunta que justifica el módulo: cuánta venta recuperó la lista.
  booking_id uuid references booking(id) on delete set null,

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'waitlist_entry_contactable_check') then
    alter table waitlist_entry
      add constraint waitlist_entry_contactable_check
      check (
        customer_id is not null
        or coalesce(nullif(btrim(contact_phone), ''), nullif(btrim(contact_email), '')) is not null
      );
  end if;
end $$;

comment on constraint waitlist_entry_contactable_check on waitlist_entry is
  'Una espera sin forma de avisar no sirve: o hay ficha de cliente, o hay teléfono o correo.';

-- La cola de una salida se lee siempre por orden de llegada.
create index if not exists waitlist_entry_queue_idx
  on waitlist_entry (organization_id, departure_id, status, created_at);

-- El barrido de ofertas vencidas solo mira las ofrecidas.
create index if not exists waitlist_entry_offer_idx
  on waitlist_entry (offer_expires_at)
  where status = 'offered';

create index if not exists waitlist_entry_booking_idx
  on waitlist_entry (booking_id)
  where booking_id is not null;

drop trigger if exists waitlist_entry_touch on waitlist_entry;
create trigger waitlist_entry_touch
before update on waitlist_entry
for each row execute function app.touch_updated_at();

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'waitlist_entry' and policyname = 'tenant_select') then
    perform app.enable_tenant_rls('public.waitlist_entry');
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- COMPROBACIÓN — que la migración falle aquí y no en producción
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  faltan text := '';
begin
  if not exists (select 1 from information_schema.tables
                 where table_name = 'waitlist_entry')
    then faltan := faltan || 'tabla waitlist_entry '; end if;

  if not exists (select 1 from pg_constraint where conname = 'waitlist_entry_contactable_check')
    then faltan := faltan || 'check de contacto '; end if;

  if not exists (select 1 from pg_indexes where indexname = 'waitlist_entry_queue_idx')
    then faltan := faltan || 'índice de la cola '; end if;

  if not exists (select 1 from pg_indexes where indexname = 'waitlist_entry_offer_idx')
    then faltan := faltan || 'índice de ofertas vencidas '; end if;

  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'waitlist_entry' and policyname = 'tenant_select')
    then faltan := faltan || 'RLS '; end if;

  if faltan <> '' then
    raise exception '0066 incompleta, falta: %', faltan;
  end if;
end $$;
