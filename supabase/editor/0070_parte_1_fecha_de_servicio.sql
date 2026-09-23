-- 0070 · PARTE 1 — la columna y el relleno del histórico.
--
-- Pegar entero y ejecutar. El `update` puede tardar si hay muchas comisiones;
-- es idempotente (solo toca las que están en null), así que se puede repetir.
alter table commission
  add column if not exists service_date date;

comment on column commission.service_date is
  'Fecha del servicio sobre el que se devengó, copiada de la salida al crear. '
  'No sigue a la reserva si esta se reprograma: el período de liquidación de un '
  'dinero ya devengado no puede moverse solo.';

update commission c
   set service_date = coalesce(d.departure_at::date, b.travel_date::date)
  from booking b
  left join departure d on d.id = b.departure_id
 where c.booking_id = b.id
   and c.service_date is null;

create index if not exists commission_seller_service_idx
  on commission (organization_id, seller_id, service_date)
  where seller_id is not null;
