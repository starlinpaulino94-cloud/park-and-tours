-- ============================================================================
-- 0037 — La factura deja de teclearse a mano
--
-- El módulo de facturación era un formulario: el NCF se escribía a mano, y
-- también el subtotal, el impuesto y el total. Una empresa dominicana no puede
-- operar así — no por comodidad, sino porque un comprobante fiscal tecleado
-- rompe de tres formas que la DGII ve:
--
--   · NCF repetido. Dos cajeros facturando a la vez escriben el mismo número, y
--     dos comprobantes con el mismo NCF invalidan los dos.
--   · Huecos en la secuencia. Un número que se salta hay que justificarlo en el
--     606/607; nadie se acuerda de cuál fue tres meses después.
--   · Totales que no cuadran con la venta. El impuesto tecleado no coincide con
--     el de la orden y la declaración sale mal.
--
-- Esta migración trae lo que faltaba para que la factura la EMITA el sistema:
--
--   · `ncf_sequence`: una secuencia por TIPO de comprobante, que es como la
--     autoriza la DGII. Un solo `tax_profile.ncf_next` no servía — B01 (crédito
--     fiscal), B02 (consumo) y B04 (nota de crédito) tienen rangos distintos y
--     se agotan por separado.
--   · `app.next_ncf`: consume el número de forma ATÓMICA, con los límites del
--     rango y la fecha de vencimiento dentro de la misma sentencia. Comprobar
--     antes y actualizar después deja la ventana por la que se cuelan los
--     duplicados.
--   · `invoice_line`: el desglose. Una factura sin líneas no se puede sostener
--     ante una inspección ni reimprimir.
--   · El enlace de la nota de crédito con la factura que anula, que es lo que
--     la DGII exige declarar (NCF modificado).
-- ============================================================================

-- ── el desglose de la factura ──────────────────────────────────────────────
create table if not exists invoice_line (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  invoice_id  uuid not null references invoice(id) on delete cascade,
  description text not null,
  quantity    numeric(14,2) not null default 1 check (quantity >= 0),
  unit_price  numeric(14,2) not null default 0,
  discount    numeric(14,2) not null default 0 check (discount >= 0),
  -- La tasa se guarda POR LÍNEA: un tour lleva ITBIS y una tasa de aeropuerto
  -- no, y una factura mixta con una sola tasa en la cabecera no se puede
  -- declarar.
  tax_rate    numeric(6,3) not null default 0 check (tax_rate >= 0),
  tax_amount  numeric(14,2) not null default 0,
  total       numeric(14,2) not null default 0,
  is_exempt   boolean not null default false,
  booking_id  uuid references booking(id) on delete set null,
  product_id  uuid references product(id) on delete set null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists invoice_line_invoice_idx on invoice_line (invoice_id, sort_order);
drop trigger if exists invoice_line_touch on invoice_line;
create trigger invoice_line_touch before update on invoice_line
  for each row execute function app.touch_updated_at();

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'invoice_line' and policyname = 'tenant_select') then
    perform app.enable_tenant_rls('public.invoice_line');
  end if;
end $$;

drop trigger if exists invoice_line_same_tenant_refs on invoice_line;
create trigger invoice_line_same_tenant_refs
before insert or update of organization_id, invoice_id, booking_id, product_id on invoice_line
for each row execute function app.enforce_same_tenant_refs(
  'invoice_id', 'invoice',
  'booking_id', 'booking',
  'product_id', 'product'
);

-- ── las secuencias autorizadas ─────────────────────────────────────────────
create table if not exists ncf_sequence (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  tax_profile_id  uuid references tax_profile(id) on delete set null,
  ncf_type    text not null,
  -- El rango que la DGII autorizó. `next_number` es el PRÓXIMO a usar.
  next_number bigint not null default 1 check (next_number >= 1),
  max_number  bigint check (max_number is null or max_number >= 1),
  expires_at  date,
  -- Número de autorización que devuelve la DGII, para poder cotejarlo.
  authorization_code text,
  status      text not null default 'active',
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Una sola secuencia viva por tipo: dos filas del mismo tipo serían dos
  -- numeraciones paralelas y comprobantes duplicados.
  unique (organization_id, ncf_type)
);

alter table ncf_sequence drop constraint if exists ncf_sequence_type_check;
alter table ncf_sequence add constraint ncf_sequence_type_check
  check (ncf_type in ('b01','b02','b04','b14','b15','e31','e32','e34','e44','e45'));

alter table ncf_sequence drop constraint if exists ncf_sequence_status_check;
alter table ncf_sequence add constraint ncf_sequence_status_check
  check (status in ('active','inactive'));

drop trigger if exists ncf_sequence_touch on ncf_sequence;
create trigger ncf_sequence_touch before update on ncf_sequence
  for each row execute function app.touch_updated_at();

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'ncf_sequence' and policyname = 'tenant_select') then
    perform app.enable_tenant_rls('public.ncf_sequence');
  end if;
end $$;

drop trigger if exists ncf_sequence_same_tenant_refs on ncf_sequence;
create trigger ncf_sequence_same_tenant_refs
before insert or update of organization_id, tax_profile_id on ncf_sequence
for each row execute function app.enforce_same_tenant_refs('tax_profile_id', 'tax_profile');

-- ── el consumo atómico del número ──────────────────────────────────────────
-- Toda la decisión cabe en el WHERE de un UPDATE a propósito. Comprobar el
-- rango y la vigencia en la aplicación y actualizar después deja abierta la
-- ventana por la que dos cajas simultáneas se llevan el mismo NCF — y dos
-- comprobantes con el mismo número invalidan los dos.
-- Va en `public` y como `security invoker` por dos razones, las dos de la casa:
-- PostgREST solo expone `public`, y con invoker manda la RLS del que llama, así
-- que la secuencia de otro inquilino es invisible aunque se pase su id. La
-- comprobación explícita de organización sigue el patrón de `dashboard_summary`:
-- falla diciendo que el ámbito es ajeno, en vez de devolver un vacío confuso.
create or replace function public.next_ncf(p_org uuid, p_type text)
returns bigint
language plpgsql
security invoker
set search_path = public, app
as $$
declare
  consumed bigint;
  seq record;
begin
  if app.current_org_id() is null or app.current_org_id() <> p_org then
    raise exception 'la secuencia de NCF pertenece a otra organización'
      using errcode = 'insufficient_privilege';
  end if;

  update ncf_sequence
     set next_number = next_number + 1
   where organization_id = p_org
     and ncf_type = p_type
     and status = 'active'
     and (max_number is null or next_number <= max_number)
     and (expires_at is null or expires_at >= current_date)
  returning next_number - 1 into consumed;

  if consumed is not null then
    return consumed;
  end if;

  -- No se consumió: hay que decir POR QUÉ. "No se pudo facturar" delante de un
  -- cliente no le sirve a nadie; "la secuencia B02 se agotó" sí.
  select * into seq from ncf_sequence
   where organization_id = p_org and ncf_type = p_type;

  if seq is null then
    raise exception 'No hay secuencia de NCF configurada para el tipo %', p_type
      using errcode = 'P0002';
  elsif seq.status <> 'active' then
    raise exception 'La secuencia de NCF % está desactivada', p_type
      using errcode = 'P0001';
  elsif seq.expires_at is not null and seq.expires_at < current_date then
    raise exception 'La autorización de la secuencia % venció el %', p_type, seq.expires_at
      using errcode = 'P0001';
  else
    raise exception 'La secuencia % se agotó en el número %', p_type, seq.max_number
      using errcode = 'P0001';
  end if;
end $$;

-- Igual que el resto de ayudas: nunca callable por el cliente anónimo.
revoke execute on function public.next_ncf(uuid, text) from anon;
grant execute on function public.next_ncf(uuid, text) to authenticated, service_role;

-- ── la factura ─────────────────────────────────────────────────────────────
alter table invoice
  -- La nota de crédito declara QUÉ comprobante modifica: es lo que la DGII
  -- exige en el 607, y sin ello la anulación no se puede justificar.
  add column if not exists credit_note_of_id uuid references invoice(id) on delete set null,
  add column if not exists ncf_expires_at date,
  add column if not exists balance   numeric(14,2) not null default 0,
  add column if not exists issued_by uuid references auth.users(id) on delete set null;

create index if not exists invoice_credit_note_idx on invoice (credit_note_of_id);
create index if not exists invoice_ncf_idx on invoice (organization_id, ncf);

drop trigger if exists invoice_same_tenant_refs on invoice;
create trigger invoice_same_tenant_refs
before insert or update of organization_id, customer_id, order_id, settlement_id, tax_profile_id, credit_note_of_id on invoice
for each row execute function app.enforce_same_tenant_refs(
  'customer_id', 'customer',
  'order_id', 'sales_order',
  'settlement_id', 'settlement',
  'tax_profile_id', 'tax_profile',
  'credit_note_of_id', 'invoice'
);
