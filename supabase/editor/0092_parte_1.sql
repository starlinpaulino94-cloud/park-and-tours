-- 0092 parte 1 de 2 — la lista negra del cliente.
-- Pegar ENTERO en el editor SQL de Supabase y ejecutar. Luego la parte 2.
--
-- Qué arregla: `customer.status` admitía `blacklist` desde la primera migración
-- y el formulario lo ofrecía en un desplegable, pero NADIE lo leía. Se podía
-- marcar a una persona y seguía comprando por el mostrador, por la web, por la
-- API del socio y por la OTA exactamente igual.
--
-- El motivo va en la ficha y no solo en la bitácora porque el cajero decide con
-- el cliente delante: sin el motivo, o levanta el bloqueo —y no valía nada— o lo
-- sostiene sin saber por qué. El `check` lo hace obligatorio también para quien
-- escriba por SQL.

alter table customer
  add column if not exists blocked_reason text,
  add column if not exists blocked_at     timestamptz,
  add column if not exists blocked_by     uuid references auth.users(id) on delete set null;

comment on column customer.blocked_reason is
  'Por qué está en la lista negra (0092). Obligatorio cuando el estado es '
  'blacklist: el cajero decide con el cliente delante y sin el motivo no puede.';

-- Si alguna ficha ya estaba marcada —se podía desde el desplegable, sin pedir
-- nada— se le pone un motivo que dice la verdad: que no se anotó ninguno. Sin
-- esto el `check` de abajo no se puede añadir, y quitarle el bloqueo a esas
-- fichas para que entre sería decidir por la operadora que ya no lo quiere.
update customer
   set blocked_reason = 'Motivo no registrado: la ficha se bloqueó antes de que el motivo fuera obligatorio (0092).'
 where status = 'blacklist'
   and (blocked_reason is null or btrim(blocked_reason) = '');

alter table customer drop constraint if exists customer_blacklist_needs_reason;
alter table customer add constraint customer_blacklist_needs_reason
  check (status <> 'blacklist' or (blocked_reason is not null and btrim(blocked_reason) <> ''));

-- El listado de «a quién tenemos bloqueado» es una pantalla que se mira entera,
-- no una búsqueda: parcial, para que el índice pese lo que pesa la lista y no
-- lo que pesa la cartera.
create index if not exists customer_blacklist_idx
  on customer (organization_id, blocked_at desc)
  where status = 'blacklist';
