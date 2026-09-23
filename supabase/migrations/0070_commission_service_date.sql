-- 0070 — La fecha del SERVICIO en la comisión.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ HACE FALTA UNA COLUMNA Y NO BASTA CON LA UNIÓN
--
-- El mercado liquida las comisiones por la fecha del TOUR, no por la de la
-- venta: TrekkSoft calcula sobre la salida, Rezdy libera el pago 14 días
-- después del servicio, Viator paga el mes siguiente al viaje. Y tiene sentido
-- —una excursión vendida en marzo para agosto no se cobra en marzo—.
--
-- `commission` solo tenía `created_at`. La fecha de salida vive dos tablas más
-- allá (`booking` → `departure`), y la capa de consulta de la aplicación NO
-- filtra por columna de una tabla unida: no es una limitación que se pueda
-- rodear con más código, es cómo está construida. Así que cortar períodos,
-- ordenar o sumar por fecha de tour exige tener la fecha AQUÍ.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- SE COPIA UNA VEZ Y NO SE VUELVE A MIRAR
--
-- Es una desnormalización deliberada. La fecha del servicio de una comisión ya
-- devengada no debe seguir a la reserva si esta se reprograma: la comisión se
-- calculó sobre un servicio concreto, y moverle la fecha después cambiaría el
-- período de liquidación de un dinero que quizá ya se pagó. El relleno de abajo
-- es el único momento en que se mira la reserva.
--
-- Queda NULL cuando la reserva no tiene salida —un paquete cabecera, un
-- servicio sin fecha—: null es «no aplica», y el que consulta lo distingue de
-- una fecha, que es justo lo que un `coalesce` a la fecha de venta impediría.

alter table commission
  add column if not exists service_date date;

comment on column commission.service_date is
  'Fecha del servicio sobre el que se devengó, copiada de la salida al crear. '
  'No sigue a la reserva si esta se reprograma: el período de liquidación de un '
  'dinero ya devengado no puede moverse solo.';

-- Relleno del histórico, desde la salida de la reserva.
update commission c
   set service_date = coalesce(d.departure_at::date, b.travel_date::date)
  from booking b
  left join departure d on d.id = b.departure_id
 where c.booking_id = b.id
   and c.service_date is null;

-- El índice que sostiene la pantalla del vendedor: lo suyo, por período.
create index if not exists commission_seller_service_idx
  on commission (organization_id, seller_id, service_date)
  where seller_id is not null;
