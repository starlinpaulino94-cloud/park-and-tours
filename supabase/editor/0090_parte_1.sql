-- 0090 parte 1 de 2 — el manifiesto sale solo, y sale recortado.
-- Pegar ENTERO en el editor SQL de Supabase y ejecutar. Luego la parte 2.

alter table message_template drop constraint if exists message_template_key_check;
alter table message_template add constraint message_template_key_check
  check (key in ('booking_confirmation','booking_cancelled','booking_rescheduled',
                 'pre_tour_reminder','payment_receipt','balance_due','quote_sent',
                 'post_tour_thanks','manifest_dispatch'));

alter table message drop constraint if exists message_attachment_kind_check;
alter table message add constraint message_attachment_kind_check
  check (attachment_kind is null or attachment_kind in ('voucher','quote','manifest'));

alter table message
  add column if not exists attachment_scope text;

alter table message drop constraint if exists message_attachment_scope_check;
alter table message add constraint message_attachment_scope_check
  check (attachment_scope is null or attachment_scope in ('interno','guia','chofer','proveedor'));

comment on column message.attachment_scope is
  'Para quién se recorta el documento adjunto. Nulo = sin recorte declarado, y entonces no se compone: el manifiesto entero lleva teléfonos, habitaciones y saldos de clientes.';

create index if not exists message_departure_idx
  on message (organization_id, departure_id)
  where departure_id is not null;
