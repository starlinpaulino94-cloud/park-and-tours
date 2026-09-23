-- 0071 · PARTE 1 — el enlace de venta en autoservicio.
--
-- Pegar entero y ejecutar. Todo es re-ejecutable.
alter table seller_link
  add column if not exists created_by uuid references auth.users(id) on delete set null;

comment on column seller_link.created_by is
  'Quién dio de alta el enlace. Desde 0071 el vendedor puede crearse el suyo, '
  'así que ya no coincide necesariamente con seller_id.';

alter table seller_link
  add column if not exists hits integer not null default 0;

create or replace function app.seller_link_under_quota() returns trigger
  language plpgsql as $hook$
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
$hook$;

revoke execute on function app.seller_link_under_quota() from anon, public, authenticated;
grant execute on function app.seller_link_under_quota() to service_role;

drop trigger if exists seller_link_quota on seller_link;
create trigger seller_link_quota
  before insert or update of status, seller_id on seller_link
  for each row execute function app.seller_link_under_quota();

create index if not exists seller_link_activos_idx
  on seller_link (organization_id, seller_id)
  where status = 'active';
