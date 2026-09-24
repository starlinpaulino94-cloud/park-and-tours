-- 0087 — Aceptar o rechazar un servicio, con su plazo y su número.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ NO SE REUTILIZA `status`
--
-- `departure_resource.status` dice lo que la OPERADORA sabe del recurso:
-- previsto, confirmado, en conflicto, cancelado. Meter ahí la respuesta del
-- proveedor haría que «confirmado» quisiera decir dos cosas a la vez —«el
-- despacho lo dio por bueno» y «el transportista dijo que sí»— y la primera vez
-- que alguien tenga que decidir si sale la guagua, esa ambigüedad se resuelve a
-- favor de lo que le convenga al que mira.
--
-- Son dos ejes: uno es de la casa, el otro es de fuera. Van en dos columnas.
alter table departure_resource
  add column if not exists acceptance text not null default 'not_required';
alter table pickup_route
  add column if not exists acceptance text not null default 'not_required';

-- ─────────────────────────────────────────────────────────────────────────────
-- «LO DESCONOCIDO ES LO DE HOY»: `not_required`, NO `pending`
--
-- Hoy nadie pregunta nada, así que ninguna fila está esperando respuesta. Si la
-- columna naciera en `pending`, el despliegue convertiría de golpe cada recurso
-- histórico en un servicio «sin confirmar» y el tablero de despacho amanecería
-- en rojo por una migración.
--
-- `not_required` es además lo HONESTO para lo que ya pasó: no es que el
-- proveedor no contestara, es que nunca se le preguntó. Poner `accepted` sería
-- escribir en la base una conformidad que nadie dio.
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

-- Único dentro de la empresa, no global: dos operadoras distintas pueden emitir
-- el mismo número sin que eso confunda a nadie, y el índice parcial deja fuera
-- las filas sin número, que son casi todas.
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

-- ─────────────────────────────────────────────────────────────────────────────
-- EL PLAZO Y QUÉ PASA AL VENCER, DECLARADOS POR PROVEEDOR
--
-- Dos valores, y el tercero que el plan mencionaba NO está aquí a propósito:
--
--  · `alert`  — vence, se avisa a operaciones y el servicio sigue sin confirmar.
--               Es el valor por defecto porque es el único que no decide nada
--               en nombre de nadie.
--  · `tacit`  — quien calla otorga. Existe porque hay proveedores de toda la
--               vida con los que se trabaja así, pero obliga a un tercero que
--               no hizo nada, así que se declara uno por uno y nunca por
--               omisión.
--
-- `reassign` NO es un valor declarable. Reasignar no es una política, es una
-- función que no existe: habría que elegir otro vehículo, comprobar sus
-- documentos y sus conflictos, y avisar a dos proveedores. Ofrecerlo como una
-- casilla que en realidad no mueve nada sería peor que no ofrecerlo — y mover
-- una guagua de verdad sin que lo decida una persona, peor todavía.
alter table supplier
  add column if not exists acceptance_window_hours integer,
  add column if not exists on_deadline_expiry text not null default 'alert';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'supplier_deadline_expiry_ck') then
    alter table supplier add constraint supplier_deadline_expiry_ck
      check (on_deadline_expiry in ('alert','tacit'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'supplier_acceptance_window_ck') then
    alter table supplier add constraint supplier_acceptance_window_ck
      check (acceptance_window_hours is null or acceptance_window_hours > 0);
  end if;
end $$;

comment on column supplier.acceptance_window_hours is
  'Horas que tiene este proveedor para contestar (0087). Nula: el plazo por '
  'defecto de la operadora. El plazo REAL nunca pasa de la hora de la salida, '
  'porque un plazo que vence después de que el servicio ocurra no es un plazo.';

-- ─────────────────────────────────────────────────────────────────────────────
-- EL ENLACE DE UN SOLO USO
--
-- Se guarda el HASH, no el token. El token viaja en la URL que se le manda por
-- correo o WhatsApp y no vuelve a existir en ninguna parte nuestra: si esta
-- tabla se filtra entera, los enlaces que contiene no sirven para nada.
--
-- Es la diferencia con el token de la encuesta (0067), que sí se guarda a
-- secas, y es deliberada: aquel pone una nota a un viaje, este compromete a una
-- empresa a poner un autobús con cuarenta personas dentro.
create table if not exists supplier_response_token (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  supplier_id     uuid not null references supplier(id) on delete cascade,
  -- Atado al recurso, que es la mitad del encargo: este enlace contesta por
  -- ESTA fila y por ninguna otra. Sin esto, el enlace de un servicio serviría
  -- para aceptar el de la semana que viene.
  --
  -- `resource_id` no lleva clave foránea porque apunta a UNA DE DOS tablas, y
  -- Postgres no sabe expresar eso. Lo que sí se sostiene es el par
  -- (kind, id), y el borrado se lleva por el disparador de más abajo.
  resource_kind   text not null check (resource_kind in ('departure_resource','pickup_route')),
  resource_id     uuid not null,
  token_hash      text not null unique,
  -- Caducado con la salida: quien lo calcula pone aquí el menor entre el plazo
  -- de respuesta y la hora del servicio.
  expires_at      timestamptz not null,
  used_at         timestamptz,
  revoked_at      timestamptz,
  revoked_reason  text,
  -- Auditado en cada apertura. El recuento vive aquí para poder mirarlo de un
  -- vistazo; el rastro con hora, dirección y navegador va a `audit_log`, que es
  -- el sitio que nadie puede reescribir desde la aplicación.
  opened_count    integer not null default 0 check (opened_count >= 0),
  last_opened_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists supplier_response_token_resource_idx
  on supplier_response_token (organization_id, resource_kind, resource_id);
create index if not exists supplier_response_token_supplier_idx
  on supplier_response_token (organization_id, supplier_id);

create trigger supplier_response_token_touch before update on supplier_response_token
for each row execute function app.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Y ESTA TABLA NO LA LEE NADIE POR LA VÍA NORMAL
--
-- RLS encendida y CERO políticas, a propósito: no es la política de siempre con
-- un filtro más, es la ausencia de política. Lo único que entra aquí es el
-- cliente de servicio, que es quien verifica el enlace. Ni el proveedor, ni el
-- socio, ni el personal interno tienen nada que hacer leyendo material de
-- credenciales — lo que necesitan saber (si se aceptó, cuándo, con qué número)
-- está en la fila del recurso.
alter table supplier_response_token enable row level security;
alter table supplier_response_token force row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- ASIGNAR ES PREGUNTAR
--
-- El estado de aceptación no lo pone la pantalla que asigna: lo pone la base en
-- cuanto la fila cambia de proveedor. Dejarlo en manos de quien escribe
-- significa que el día que se asigne desde otro sitio —la mesa de despacho, una
-- importación, un arreglo a mano— el servicio saldría sin que nadie lo hubiera
-- pedido, y el proveedor se enteraría al llegar el autobús.
--
-- Y la respuesta anterior se BORRA. Es el caso que parece un detalle y no lo
-- es: si A había aceptado y el servicio pasa a B, conservar «aceptado» dejaría
-- una fila diciendo que hay conformidad de un proveedor que ya no tiene nada
-- que ver con ese viaje. El número de confirmación se va con ella.
create or replace function app.set_acceptance_on_assign()
returns trigger language plpgsql as $fn$
declare
  v_horas    integer;
  v_deadline timestamptz;
begin
  if tg_op = 'UPDATE' and new.supplier_id is not distinct from old.supplier_id then
    return new;
  end if;

  new.responded_at        := null;
  new.responded_by        := null;
  new.response_note       := null;
  new.responded_via       := null;
  new.confirmation_number := null;

  if new.supplier_id is null then
    -- Vuelve a ser de la casa: no hay a quién preguntarle.
    new.acceptance          := 'not_required';
    new.acceptance_deadline := null;
    return new;
  end if;

  select acceptance_window_hours into v_horas from supplier where id = new.supplier_id;
  -- Veinticuatro horas por defecto, y el mismo número está escrito en el
  -- dominio para que la pantalla pueda decir el plazo antes de guardar nada.
  v_deadline := now() + make_interval(hours => coalesce(v_horas, 24));

  -- EL PLAZO NUNCA PASA DE LA SALIDA. Un plazo que vence después de que el
  -- servicio ocurra no es un plazo: es un recordatorio para después del
  -- entierro. Y un servicio asignado con la salida encima nace con el plazo ya
  -- vencido, que es la verdad — no hay tiempo de contestar.
  if new.service_date is not null and new.service_date < v_deadline then
    v_deadline := new.service_date;
  end if;

  new.acceptance          := 'pending';
  new.acceptance_deadline := v_deadline;
  return new;
end;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- EL NOMBRE DEL DISPARADOR NO ES DECORACIÓN
--
-- Postgres dispara los `before` de una fila EN ORDEN ALFABÉTICO, y este tiene
-- que correr DESPUÉS del de 0085, que es el que calcula `supplier_id`. Con
-- cualquier otro nombre leería el proveedor viejo y no se enteraría del cambio.
--
-- Por eso se llama `..._supplier_acceptance`: comparte prefijo con
-- `..._supplier` y ordena detrás. Y como eso es exactamente la clase de detalle
-- que se rompe sin que nadie lo note, más abajo hay una comprobación que hace
-- fallar la migración si el orden deja de cumplirse.
drop trigger if exists departure_resource_supplier_acceptance on departure_resource;
create trigger departure_resource_supplier_acceptance
before insert or update on departure_resource
for each row execute function app.set_acceptance_on_assign();

drop trigger if exists pickup_route_supplier_acceptance on pickup_route;
create trigger pickup_route_supplier_acceptance
before insert or update on pickup_route
for each row execute function app.set_acceptance_on_assign();

do $orden$
declare
  t text;
begin
  foreach t in array array['departure_resource', 'pickup_route'] loop
    if (t || '_supplier_acceptance') <= (t || '_supplier') then
      raise exception 'El disparador de aceptación de % ordena ANTES que el que calcula el proveedor', t;
    end if;
    if not exists (
      select 1 from pg_trigger
       where tgrelid = t::regclass and tgname = t || '_supplier_acceptance'
    ) then
      raise exception 'Falta el disparador de aceptación en %', t;
    end if;
  end loop;
end $orden$;

-- ─────────────────────────────────────────────────────────────────────────────
-- REVOCABLE AL REASIGNAR
--
-- La otra mitad del enlace de un solo uso. Si el servicio pasa de A a B y el
-- enlace que ya le mandamos a A sigue vivo, A puede aceptar un servicio que
-- hace diez minutos dejó de ser suyo — y quedarían dos conformidades sobre la
-- misma guagua.
--
-- Va en un `after` y con `when`, no en el `before` de arriba: así se lee el
-- valor definitivo de la fila y no depende de ningún orden de disparo.
create or replace function app.revoke_supplier_tokens()
returns trigger language plpgsql as $fn2$
begin
  if tg_op = 'DELETE' then
    delete from supplier_response_token
     where resource_kind = tg_table_name and resource_id = old.id;
    return null;
  end if;

  update supplier_response_token
     set revoked_at = now(),
         revoked_reason = 'reasignado'
   where resource_kind = tg_table_name
     and resource_id = new.id
     and used_at is null
     and revoked_at is null;
  return null;
end;
$fn2$;

drop trigger if exists departure_resource_token_revoke on departure_resource;
create trigger departure_resource_token_revoke
after update on departure_resource
for each row when (new.supplier_id is distinct from old.supplier_id)
execute function app.revoke_supplier_tokens();

drop trigger if exists pickup_route_token_revoke on pickup_route;
create trigger pickup_route_token_revoke
after update on pickup_route
for each row when (new.supplier_id is distinct from old.supplier_id)
execute function app.revoke_supplier_tokens();

-- Y al borrarse la fila, el enlace se va con ella: `resource_id` no tiene clave
-- foránea que lo arrastre, así que lo arrastra esto.
drop trigger if exists departure_resource_token_cleanup on departure_resource;
create trigger departure_resource_token_cleanup
after delete on departure_resource
for each row execute function app.revoke_supplier_tokens();

drop trigger if exists pickup_route_token_cleanup on pickup_route;
create trigger pickup_route_token_cleanup
after delete on pickup_route
for each row execute function app.revoke_supplier_tokens();

-- ─────────────────────────────────────────────────────────────────────────────
-- LO QUE YA ESTÁ ASIGNADO Y TODAVÍA NO HA PASADO, SE PREGUNTA
--
-- Lo de después de ahora entra en `pending`: son servicios que alguien tiene
-- que prestar y de los que no hay conformidad de nadie. Lo anterior se queda en
-- `not_required`, que es la verdad — nunca se le preguntó.
--
-- AVISO PARA QUIEN LA EJECUTE: el primer día, cada proveedor verá de golpe
-- todos sus servicios futuros esperando respuesta. No es un fallo, es el
-- arranque de la función; conviene avisarles antes de correr esto.
update departure_resource dr
   set acceptance = 'pending',
       acceptance_deadline = least(dr.service_date,
                                  now() + make_interval(hours => coalesce(s.acceptance_window_hours, 24)))
  from supplier s
 where s.id = dr.supplier_id
   and dr.acceptance = 'not_required'
   and dr.service_date is not null
   and dr.service_date > now()
   and dr.status in ('planned', 'confirmed');

update pickup_route pr
   set acceptance = 'pending',
       acceptance_deadline = least(pr.service_date,
                                  now() + make_interval(hours => coalesce(s.acceptance_window_hours, 24)))
  from supplier s
 where s.id = pr.supplier_id
   and pr.acceptance = 'not_required'
   and pr.service_date is not null
   and pr.service_date > now()
   and pr.status in ('planned', 'confirmed');

-- ─────────────────────────────────────────────────────────────────────────────
-- CONTESTAR ES UNA SOLA ESCRITURA
--
-- Hay que gastar el enlace y escribir la respuesta, y las dos cosas tienen que
-- pasar juntas o ninguna. El cliente HTTP de esta aplicación no sabe abrir una
-- transacción —es la misma razón por la que la comisión retenida acabó en una
-- función en 0083—, y aquí partirlo en dos tiene dos formas de salir mal:
--
--  · marcar usado y fallar al escribir ⇒ el proveedor se queda sin poder
--    contestar y sin constar que contestó;
--  · escribir y fallar al marcar usado ⇒ el enlace sigue vivo y ya no es de un
--    solo uso, que es justo lo que el encargo pide que sea.
--
-- El `for update` sobre el enlace además SERIALIZA: dos clics seguidos —o el
-- reenvío del formulario— esperan aquí uno a otro, y el segundo encuentra el
-- enlace ya gastado.
create or replace function public.respond_to_supplier_service(
  p_token_hash   text,
  p_answer       text,
  p_note         text,
  p_confirmation text
) returns jsonb
  language plpgsql security definer set search_path = public, app
as $fn3$
declare
  v_role     text := coalesce(auth.jwt() ->> 'role', 'service_role');
  v_tok      record;
  v_estado   text;
  v_supplier uuid;
begin
  -- FALLA CERRADA: `security definer` se salta la RLS, y esta función acepta
  -- servicios en nombre de una empresa. Solo la llama el servidor.
  if v_role <> 'service_role' then
    raise exception 'Esta función solo la llama el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  if p_answer not in ('accepted', 'rejected') then
    raise exception 'La respuesta solo puede ser aceptada o rechazada'
      using errcode = 'check_violation';
  end if;

  select * into v_tok
    from supplier_response_token
   where token_hash = p_token_hash
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  -- Revocado y gastado se distinguen. No es una fuga —quien pregunta ya tiene
  -- el enlace— y es la diferencia entre «esto ya lo contestaste» y «este
  -- servicio se le dio a otro», que son dos llamadas de teléfono distintas.
  if v_tok.revoked_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'revoked');
  end if;
  if v_tok.used_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_used');
  end if;
  if v_tok.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  -- EL ESTADO DEL RECURSO SE MIRA ANTES DE GASTAR EL ENLACE. Si ya se contestó
  -- desde el portal, el enlace no se consume: el proveedor que lo abra después
  -- verá «ya contestado» y no «este enlace no sirve», y podrá volver a usarlo
  -- si alguien deshace la respuesta.
  execute format(
    'select acceptance, supplier_id from %I where id = $1 and organization_id = $2 for update',
    v_tok.resource_kind
  ) into v_estado, v_supplier using v_tok.resource_id, v_tok.organization_id;

  if v_estado is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  -- Y sigue siendo suyo. El disparador de reasignación revoca los enlaces,
  -- pero comprobarlo aquí también es lo que hace que esto no dependa de que
  -- aquel haya corrido.
  if v_supplier is distinct from v_tok.supplier_id then
    return jsonb_build_object('ok', false, 'reason', 'reassigned');
  end if;
  if v_estado <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'already_answered', 'state', v_estado);
  end if;

  execute format(
    'update %I set acceptance = $1, responded_at = now(), response_note = $2, '
    'responded_via = ''enlace'', confirmation_number = $3 where id = $4',
    v_tok.resource_kind
  ) using p_answer, p_note,
          case when p_answer = 'accepted' then p_confirmation else null end,
          v_tok.resource_id;

  update supplier_response_token set used_at = now() where id = v_tok.id;

  return jsonb_build_object(
    'ok', true,
    'resource_kind', v_tok.resource_kind,
    'resource_id', v_tok.resource_id,
    'answer', p_answer,
    'confirmation_number', case when p_answer = 'accepted' then p_confirmation else null end
  );
end;
$fn3$;

revoke execute on function public.respond_to_supplier_service(text, text, text, text)
  from anon, public, authenticated;
grant execute on function public.respond_to_supplier_service(text, text, text, text)
  to service_role;
