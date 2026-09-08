-- El check-in parcial estaba roto en la base.
--
-- `POST /api/bookings/:id/checkin` escribe `checkin_status = 'partial'` cuando
-- embarcan solo algunos pasajeros de una reserva de grupo, y `checked_in_pax`
-- guarda cuántos. El dominio lo modela en todas partes —la ruta, el tipo
-- `Booking.checkin_status` y el badge de la UI— menos en el check, que solo
-- admitía ('pending','done','no_show'): cada check-in parcial fallaba contra la
-- restricción. Se amplía el dominio en lugar de degradar la función.
--
-- Se aplica también a `participant` para que la misma columna no tenga dos
-- dominios distintos según la tabla.

alter table booking drop constraint if exists booking_checkin_status_check;
alter table booking add constraint booking_checkin_status_check
  check (checkin_status in ('pending','partial','done','no_show'));

alter table participant drop constraint if exists participant_checkin_status_check;
alter table participant add constraint participant_checkin_status_check
  check (checkin_status in ('pending','partial','done','no_show'));
