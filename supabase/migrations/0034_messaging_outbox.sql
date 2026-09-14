-- ============================================================================
-- 0034 — Comunicaciones con el cliente
--
-- La plataforma no mandaba NADA. Ni la confirmación de una reserva, ni el
-- recordatorio con la hora de recogida la noche antes, ni la cotización que el
-- vendedor acababa de dar por enviada, ni el recibo de un cobro. Todo eso se
-- hacía a mano desde el WhatsApp personal de quien atendiera, con dos
-- consecuencias que se ven en la operación todos los días: el cliente aparece en
-- el lobby a la hora equivocada, y nadie puede responder a "¿se le avisó?".
--
-- Se modela como una BANDEJA DE SALIDA, no como un envío directo:
--
--  · Cada mensaje es una fila con su destinatario, su texto ya compuesto y su
--    estado. Un envío que no deja registro no se puede auditar ni reintentar, y
--    "¿le llegó el voucher?" se vuelve una pregunta sin respuesta.
--  · `dedupe_key` es única por inquilino: el recordatorio de una reserva se
--    encola una vez y solo una. Sin ella, cada pasada del cron vuelve a
--    escribirle al cliente, que es la forma más rápida de que marque la
--    dirección como spam.
--  · Un mensaje sin proveedor configurado NO se descarta: se queda en cola con
--    el motivo escrito, y sale solo en cuanto haya credenciales. Marcarlo como
--    fallido perdería el aviso sin que nadie se entere.
--
-- Las credenciales del proveedor NO viven aquí. Van en variables de entorno de
-- la plataforma, igual que la clave de Stripe: una `config jsonb` por inquilino
-- viajaría al navegador en cuanto alguien abriera la pantalla de integraciones.
-- ============================================================================

-- ── plantillas ─────────────────────────────────────────────────────────────
-- Cada empresa reescribe el texto con su voz y en los idiomas que atiende. Si
-- no la reescribe, `src/lib/messaging/templates.ts` trae una por defecto: el
-- sistema comunica desde el primer día en vez de exigir configuración previa.
create table if not exists message_template (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  key         text not null,
  channel     text not null,
  language    text not null default 'es',
  subject     text,
  body        text not null,
  status      text not null default 'active',
  -- Horas respecto al hecho que dispara el mensaje. Negativo = antes: el
  -- recordatorio pre-tour es -24 (la noche de antes), la encuesta post-tour +4.
  offset_hours integer,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (organization_id, key, channel, language)
);

alter table message_template drop constraint if exists message_template_channel_check;
alter table message_template add constraint message_template_channel_check
  check (channel in ('email','whatsapp','sms'));

alter table message_template drop constraint if exists message_template_status_check;
alter table message_template add constraint message_template_status_check
  check (status in ('active','inactive'));

alter table message_template drop constraint if exists message_template_key_check;
alter table message_template add constraint message_template_key_check
  check (key in ('booking_confirmation','booking_cancelled','pre_tour_reminder',
                 'payment_receipt','balance_due','quote_sent','post_tour_thanks'));

create index if not exists message_template_org_idx on message_template (organization_id, key, channel);
drop trigger if exists message_template_touch on message_template;
create trigger message_template_touch before update on message_template
  for each row execute function app.touch_updated_at();

select app.enable_tenant_rls('public.message_template');

-- ── bandeja de salida ──────────────────────────────────────────────────────
create table if not exists message (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  channel      text not null,
  template_key text,
  language     text not null default 'es',
  status       text not null default 'queued',
  to_address   text not null,
  to_name      text,
  subject      text,
  body         text not null,
  scheduled_at timestamptz not null default now(),
  sent_at      timestamptz,
  attempts     integer not null default 0 check (attempts >= 0),
  last_error   text,
  provider     text,
  provider_message_id text,
  -- Sobre qué trata. Se guarda la referencia para poder abrir el mensaje desde
  -- la reserva y, al revés, ver desde el mensaje de qué venta salió.
  customer_id  uuid references customer(id) on delete set null,
  booking_id   uuid references booking(id) on delete set null,
  order_id     uuid references sales_order(id) on delete set null,
  quote_id     uuid references quote(id) on delete set null,
  departure_id uuid references departure(id) on delete set null,
  payment_id   uuid references payment(id) on delete set null,
  dedupe_key   text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table message drop constraint if exists message_channel_check;
alter table message add constraint message_channel_check
  check (channel in ('email','whatsapp','sms'));

alter table message drop constraint if exists message_status_check;
alter table message add constraint message_status_check
  check (status in ('queued','sending','sent','failed','cancelled'));

-- Un aviso se manda una vez. La clave la compone quien encola
-- ("pre_tour_reminder:<reserva>"), y el índice único es lo que sostiene la
-- promesa incluso si dos pasadas del cron se solapan.
create unique index if not exists message_dedupe_idx
  on message (organization_id, dedupe_key) where dedupe_key is not null;

-- La cola se lee por "lo que toca mandar ahora".
create index if not exists message_queue_idx
  on message (organization_id, status, scheduled_at) where status in ('queued','sending');
create index if not exists message_booking_idx  on message (booking_id);
create index if not exists message_customer_idx on message (organization_id, customer_id);

drop trigger if exists message_touch on message;
create trigger message_touch before update on message
  for each row execute function app.touch_updated_at();

select app.enable_tenant_rls('public.message');

-- ── integridad de referencias entre inquilinos ─────────────────────────────
drop trigger if exists message_same_tenant_refs on message;
create trigger message_same_tenant_refs
before insert or update of organization_id, customer_id, booking_id, order_id, quote_id, departure_id, payment_id on message
for each row execute function app.enforce_same_tenant_refs(
  'customer_id', 'customer',
  'booking_id', 'booking',
  'order_id', 'sales_order',
  'quote_id', 'quote',
  'departure_id', 'departure',
  'payment_id', 'payment'
);
