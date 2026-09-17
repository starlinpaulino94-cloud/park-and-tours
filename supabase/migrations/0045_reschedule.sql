-- ═══════════════════════════════════════════════════════════════════════════
-- 0045 — REPROGRAMAR UNA RESERVA
--
-- POR QUÉ
--
-- Mover una reserva de fecha solo se podía haciendo cancelar + vender otra vez,
-- y eso no es lo mismo: se pierde el historial, el voucher que el cliente ya
-- tiene deja de valer, las comisiones se anulan y se vuelven a generar (con el
-- precio de HOY, no el que se vendió), y al cliente le llega un aviso de
-- cancelación por algo que no canceló.
--
-- En una operadora esto pasa todas las semanas: llueve, el cliente cambia de
-- hotel, le mueven el vuelo. Que la única salida sea «cancelar y volver a
-- vender» es la razón por la que estas cosas terminan arregladas por WhatsApp y
-- sin pasar por el sistema — y entonces el manifiesto del día miente.
--
-- QUÉ GUARDA EL ESQUEMA
--
-- La reserva mantiene su identidad (su número y su voucher) y gana su historia:
-- de dónde vino, cuándo se movió, por qué y cuántas veces. El contador no es
-- adorno: una reserva movida cinco veces es una conversación de reembolso, no
-- una reprogramación, y sin contarlas nadie lo nota.
-- ═══════════════════════════════════════════════════════════════════════════

alter table booking
  -- La salida anterior: permite reconstruir el movimiento y ver el patrón de un
  -- cliente que mueve su excursión cada semana.
  add column if not exists previous_departure_id uuid references departure(id) on delete set null,
  add column if not exists rescheduled_at timestamptz,
  add column if not exists reschedule_reason text,
  add column if not exists reschedule_count integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'booking_reschedule_count_check') then
    alter table booking add constraint booking_reschedule_count_check
      check (reschedule_count >= 0);
  end if;
end $$;

-- Para la pregunta que se hace en operaciones: «¿qué se movió esta semana?».
create index if not exists booking_rescheduled_idx
  on booking (organization_id, rescheduled_at desc)
  where rescheduled_at is not null;
