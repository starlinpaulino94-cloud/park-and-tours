-- 0071 — El enlace de venta, cuando lo crea el propio vendedor.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- QUIÉN LO CREÓ
--
-- Hasta ahora los enlaces los daba de alta gerencia, así que «de quién es» y
-- «quién lo creó» eran la misma persona. En cuanto el vendedor puede crearse el
-- suyo dejan de serlo, y hace falta saberlo: un enlace es una dirección pública
-- que reparte atribución —o sea, dinero—, y el día que aparezcan veinte de la
-- nada la pregunta es quién los hizo.
alter table seller_link
  add column if not exists created_by uuid references auth.users(id) on delete set null;

comment on column seller_link.created_by is
  'Quién dio de alta el enlace. Desde 0071 el vendedor puede crearse el suyo, '
  'así que ya no coincide necesariamente con seller_id.';

-- ─────────────────────────────────────────────────────────────────────────────
-- CUÁNTAS VECES SE HA ABIERTO
--
-- El embudo cuenta VISITAS en `seller_attribution`, que es el histórico bueno.
-- Esto es otra cosa: un contador barato en la propia fila para poder decir «no
-- se ha abierto nunca» sin recorrer el histórico, que es la única pregunta que
-- la pantalla del vendedor hace cada vez que carga.
alter table seller_link
  add column if not exists hits integer not null default 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- EL TECHO DE ENLACES POR VENDEDOR
--
-- Sin tope, una cuenta puede fabricar miles de slugs. No es un problema de
-- espacio: el slug es ÚNICO EN TODO EL SISTEMA, así que fabricarlos en masa es
-- ocupar el espacio de nombres de las demás empresas alojadas aquí.
--
-- Se cuenta solo lo activo: un enlace retirado no ocupa sitio en el techo, y
-- así quien llegue al límite puede desactivar los que ya no usa en vez de
-- pedirle permiso a nadie.
create or replace function app.seller_link_under_quota() returns trigger
  language plpgsql as $$
declare
  vivos integer;
  techo constant integer := 25;
begin
  if new.status is distinct from 'active' then
    return new;
  end if;
  select count(*) into vivos
    from seller_link
   where organization_id = new.organization_id
     and seller_id = new.seller_id
     and status = 'active'
     and id is distinct from new.id;
  if vivos >= techo then
    raise exception 'Este vendedor ya tiene % enlaces activos. Desactiva alguno antes de crear otro.', techo
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function app.seller_link_under_quota() from anon, public, authenticated;
grant execute on function app.seller_link_under_quota() to service_role;

drop trigger if exists seller_link_quota on seller_link;
create trigger seller_link_quota
  before insert or update of status, seller_id on seller_link
  for each row execute function app.seller_link_under_quota();

-- El índice que sostiene esa cuenta y la pantalla del vendedor.
create index if not exists seller_link_activos_idx
  on seller_link (organization_id, seller_id)
  where status = 'active';
