-- ============================================================================
-- 0033 — El cierre de una salida
--
-- Una salida se vendía, se despachaba… y ahí se acababa. No había dónde escribir
-- cuánta gente viajó DE VERDAD, que es un número distinto del vendido —un
-- no-show se cobró pero no ocupó asiento— y es del que salen la ocupación real,
-- la rentabilidad por salida y la comisión del guía. Tampoco había dónde anotar
-- lo que pasó: el pinchazo, la lluvia, el cliente que se cayó. Esa información
-- terminaba en el WhatsApp del coordinador y no volvía nunca al sistema.
--
-- `status` ya admitía 'completed' desde 0004; lo que faltaba era el contenido de
-- ese estado. Todo es aditivo.
-- ============================================================================

alter table departure
  add column if not exists closed_at      timestamptz,
  add column if not exists closed_by      uuid references auth.users(id) on delete set null,
  add column if not exists departed_at    timestamptz,
  add column if not exists returned_at    timestamptz,
  add column if not exists actual_pax     integer check (actual_pax   is null or actual_pax   >= 0),
  add column if not exists no_show_pax    integer check (no_show_pax  is null or no_show_pax  >= 0),
  add column if not exists incident_notes text,
  add column if not exists guide_notes    text;

comment on column departure.actual_pax is
  'Plazas efectivamente embarcadas. NO es booked_pax: un no-show se vendió y no viajó, y confundirlos infla la ocupación de la que salen los informes.';
comment on column departure.departed_at is
  'Hora real de salida, frente a `departure_at` que es la programada. La diferencia entre las dos es el retraso, que es lo que el cliente recuerda.';

-- El cierre se consulta por día para los informes de operación.
create index if not exists departure_closed_idx on departure (organization_id, closed_at)
  where closed_at is not null;
