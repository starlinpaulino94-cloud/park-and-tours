-- 0087 · parte 3 de 5 — La tabla del enlace de un solo uso.
--
-- Ejecuta las partes 1 y 2 ANTES que esta.
--
-- QUÉ HACE
--  · Crea `supplier_response_token`. Se guarda el HASH y nunca el enlace: el
--    token viaja en la URL que se le manda por correo o WhatsApp y no vuelve a
--    existir en ninguna parte nuestra. Si esta tabla se filtra entera, los
--    enlaces que contiene no sirven para nada.
--  · RLS encendida y CERO políticas, a propósito. No es la política de siempre
--    con un filtro más: es la ausencia de política. Aquí solo entra el cliente
--    de servicio, que es quien verifica el enlace.
--
-- AVISO SOBRE EL EDITOR: este trozo NO lleva ningún bloque $$. El editor de
-- Supabase inyecta su propio `enable row level security` detrás de un
-- `create table`, y si eso cae dentro de un bloque $$ revienta con
-- «unterminated dollar-quoted string». Por eso las funciones van en las partes
-- 4 y 5, y no aquí.
--
-- NO borra ni cambia ninguna fila.

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

alter table supplier_response_token enable row level security;
alter table supplier_response_token force row level security;

-- ── VERIFICACIÓN ───────────────────────────────────────────────────────────
-- Tiene que salir `rowsecurity = true` y CERO políticas: si aparece alguna, el
-- editor metió la suya y hay que borrarla.
select c.relrowsecurity as rls_encendida,
       c.relforcerowsecurity as rls_forzada,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = 'supplier_response_token') as politicas
  from pg_class c
 where c.oid = 'public.supplier_response_token'::regclass;
