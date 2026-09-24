-- 0087 · parte 1 de 5 — Aceptar o rechazar: las columnas del recurso.
--
-- Pégalo entero en el editor SQL de Supabase y ejecútalo. Luego la parte 2.
--
-- QUÉ HACE
--  · `acceptance` y lo que la acompaña, en `departure_resource` y en
--    `pickup_route`. El eje del proveedor va APARTE del de la operadora:
--    `status` dice lo que sabe la casa, esto dice lo que contestó él. Con una
--    sola columna, «confirmado» querría decir dos cosas a la vez.
--  · Nace en `not_required`, no en `pending`: hoy nadie pregunta nada, y con
--    `pending` el tablero de despacho amanecería en rojo por una migración.
--
-- NO borra ni cambia ninguna fila.

alter table departure_resource
  add column if not exists acceptance text not null default 'not_required';
alter table pickup_route
  add column if not exists acceptance text not null default 'not_required';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'departure_resource_acceptance_ck') then
    alter table departure_resource add constraint departure_resource_acceptance_ck
      check (acceptance in ('not_required','pending','accepted','rejected','expired'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pickup_route_acceptance_ck') then
    alter table pickup_route add constraint pickup_route_acceptance_ck
      check (acceptance in ('not_required','pending','accepted','rejected','expired'));
  end if;
end $$;

alter table departure_resource
  add column if not exists acceptance_deadline timestamptz,
  add column if not exists responded_at        timestamptz,
  add column if not exists responded_by        uuid references auth.users(id) on delete set null,
  add column if not exists response_note       text,
  -- Por dónde contestó. No es adorno: una conformidad dada desde el portal
  -- lleva detrás una sesión con contraseña; una dada por el enlace, solo a
  -- quien tuviera el enlace; y `tacito` quiere decir que NO contestó nadie y lo
  -- dio por bueno una política. El día que se discuta si el proveedor aceptó de
  -- verdad, esa diferencia es todo lo que hay.
  add column if not exists responded_via       text,
  add column if not exists confirmation_number text;
alter table pickup_route
  add column if not exists acceptance_deadline timestamptz,
  add column if not exists responded_at        timestamptz,
  add column if not exists responded_by        uuid references auth.users(id) on delete set null,
  add column if not exists response_note       text,
  -- Por dónde contestó. No es adorno: una conformidad dada desde el portal
  -- lleva detrás una sesión con contraseña; una dada por el enlace, solo a
  -- quien tuviera el enlace; y `tacito` quiere decir que NO contestó nadie y lo
  -- dio por bueno una política. El día que se discuta si el proveedor aceptó de
  -- verdad, esa diferencia es todo lo que hay.
  add column if not exists responded_via       text,
  add column if not exists confirmation_number text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'departure_resource_via_ck') then
    alter table departure_resource add constraint departure_resource_via_ck
      check (responded_via is null or responded_via in ('portal','enlace','tacito'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pickup_route_via_ck') then
    alter table pickup_route add constraint pickup_route_via_ck
      check (responded_via is null or responded_via in ('portal','enlace','tacito'));
  end if;
end $$;

comment on column departure_resource.confirmation_number is
  'El número que el proveedor canta por teléfono (0087). Se genera AL ACEPTAR '
  'y no antes: un número emitido con la petición no prueba nada, porque lo '
  'tendría igual quien nunca contestó.';

create unique index if not exists departure_resource_confirmation_uq
  on departure_resource (organization_id, confirmation_number)
  where confirmation_number is not null;
create unique index if not exists pickup_route_confirmation_uq
  on pickup_route (organization_id, confirmation_number)
  where confirmation_number is not null;

-- Lo que el portal y el barrido de vencimientos consultan: lo que está
-- esperando respuesta, por plazo.
create index if not exists departure_resource_acceptance_idx
  on departure_resource (organization_id, acceptance, acceptance_deadline)
  where acceptance = 'pending';
create index if not exists pickup_route_acceptance_idx
  on pickup_route (organization_id, acceptance, acceptance_deadline)
  where acceptance = 'pending';

-- ── VERIFICACIÓN ───────────────────────────────────────────────────────────
select table_name, column_name
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('departure_resource','pickup_route')
   and column_name in ('acceptance','acceptance_deadline','responded_at',
                       'responded_by','response_note','responded_via',
                       'confirmation_number')
 order by table_name, column_name;
