-- 0092 — La lista negra del cliente: declarada desde 0004, sin cumplir desde
-- entonces.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ HABÍA, Y QUÉ NO
--
-- `customer.status` admite `blacklist` desde la primera migración, y el
-- formulario del directorio lo ofrece en un desplegable con su etiqueta «Lista
-- negra». Lo que NO existía en ninguna parte del sistema era alguien que lo
-- leyera: se podía marcar a una persona y seguía comprando por el mostrador,
-- por la web, por la API del socio y por la OTA exactamente igual.
--
-- O sea que no era una función a medias: era una casilla. Y de las peores,
-- porque quien la marca se queda convencido de que hizo algo.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ EL MOTIVO ES UNA COLUMNA Y NO UNA NOTA
--
-- Una lista negra sin motivo deja de servir en seis meses. El caso real es
-- siempre el mismo: el cliente aparece en el mostrador, el cajero ve «bloqueado»
-- y tiene que decidir en treinta segundos si lo sostiene o lo levanta, con la
-- persona delante. Sin el motivo, o lo levanta —y el bloqueo no valía nada— o
-- lo sostiene sin saber por qué, que es peor.
--
-- Por eso el motivo va en la ficha y no solo en la bitácora: la bitácora es para
-- reconstruir qué pasó, no para consultarla con un cliente esperando.
--
-- Y por eso hay un `check`: sin él, la aplicación puede exigir el motivo hoy y
-- el día que alguien escriba por SQL —o que aparezca un segundo camino— queda
-- otra vez una ficha bloqueada que nadie sabe explicar.

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
