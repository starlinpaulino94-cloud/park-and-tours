-- ============================================================================
-- 0008 — Concurrency-safe capacity reservation (closes AUD-B01 overbooking).
-- Totalum had no locks/transactions, so the booking flow did check-then-act and
-- compensated by hand. Here a single atomic function row-locks the departure and
-- reserves seats, so two concurrent sales of the last seat cannot both succeed.
-- ============================================================================

-- Reserves `pax` seats on a departure. Returns true if reserved, false if it
-- would oversell (unless capacity = 0, meaning unlimited, or override = true).
-- SECURITY DEFINER + explicit org check so it can run under the caller while
-- still honouring tenant isolation.
create or replace function public.reserve_departure_capacity(
  p_departure_id uuid,
  p_pax integer,
  p_override boolean default false
) returns boolean
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  d record;
begin
  if p_pax is null or p_pax < 1 then
    raise exception 'pax must be >= 1 (got %)', p_pax using errcode = 'check_violation';
  end if;

  -- Row lock: concurrent callers serialise here on the same departure.
  select id, organization_id, capacity, booked_pax, pending_pax, status
    into d
    from departure
   where id = p_departure_id
   for update;

  if not found then
    raise exception 'departure % not found', p_departure_id using errcode = 'no_data_found';
  end if;

  -- Tenant isolation: the departure must belong to the caller's org (the SECURITY
  -- DEFINER context bypasses RLS, so we enforce it explicitly). service_role
  -- callers set org via the JWT claim too.
  if app.current_org_id() is not null and d.organization_id <> app.current_org_id() then
    raise exception 'departure % is outside your organization', p_departure_id using errcode = 'insufficient_privilege';
  end if;

  if d.status in ('cancelled','closed','completed') then
    raise exception 'departure % is % and cannot take bookings', p_departure_id, d.status using errcode = 'check_violation';
  end if;

  -- capacity 0 = unlimited. Otherwise reject when it would exceed capacity.
  if d.capacity > 0 and not p_override
     and (d.booked_pax + d.pending_pax + p_pax) > d.capacity then
    return false;
  end if;

  update departure
     set booked_pax = booked_pax + p_pax,
         status = case
           when capacity > 0 and (booked_pax + p_pax + pending_pax) >= capacity then 'full'
           when capacity > 0 and (booked_pax + p_pax + pending_pax) >= capacity * 0.8 then 'almost_full'
           else status end,
         updated_at = now()
   where id = p_departure_id;

  return true;
end;
$$;

-- Releasing seats (on cancellation) is the mirror operation.
create or replace function public.release_departure_capacity(
  p_departure_id uuid,
  p_pax integer
) returns void
  language plpgsql security definer set search_path = public, app
as $$
begin
  update departure
     set booked_pax = greatest(0, booked_pax - p_pax),
         status = case when status = 'full' then 'available' else status end,
         updated_at = now()
   where id = p_departure_id;
end;
$$;
