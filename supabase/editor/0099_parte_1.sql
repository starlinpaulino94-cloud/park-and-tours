-- 0099 · parte 1 de 4 — la columna de la retención
--
-- QUÉ ARREGLA. Treinta ventas simultáneas de una plaza contra una salida de
-- capacidad 10, por el camino que usaba la aplicación: 19 reservas. Nueve
-- pasajeros con asiento que no existe. La venta leía el cupo, decidía fuera y
-- escribía después, sin nada que serializara.
--
-- Ahora la plaza se COGE con cerrojo de fila antes de venderla, y la retención
-- caduca sola a los dos minutos para que una venta muerta no cierre la salida.
--
-- Las partes van EN ORDEN. Aplicar solo la 1 no rompe nada (la columna es
-- aditiva); parar antes de la 4 deja la pantalla sin saber de las retenciones.

alter table departure
  add column if not exists hold_pax   integer     not null default 0,
  add column if not exists hold_until timestamptz;

comment on column departure.hold_pax is
  'Plazas RETENIDAS por una venta en curso que todavia no escribio su reserva. Ocupan sitio mientras `hold_until` no haya pasado. El reconciliador NO las toca: las escribe reserve_departure_capacity y las suelta release_departure_capacity.';
comment on column departure.hold_until is
  'Cuando caducan las retenciones de `hold_pax`. Pasada esta hora cuentan como cero aunque nadie las haya limpiado: una venta que muere a medias no puede cerrar la salida para siempre.';
