-- ============================================================================
-- 0035 — El documento que acompaña al aviso
--
-- La confirmación de una reserva salía como texto con el código del voucher
-- dentro. El cliente llegaba a la puerta con una captura de pantalla y alguien
-- tecleaba el código a mano delante de la cola, que es justo lo que un voucher
-- existe para evitar.
--
-- Se guarda QUÉ documento acompaña al mensaje, no el documento: un PDF en
-- base64 por fila engordaría la tabla hasta hacer inmanejable la bandeja, y
-- además quedaría obsoleto en cuanto cambiara la reserva. El archivo se genera
-- en el momento de entregar, a partir de las referencias que el mensaje ya
-- lleva (`booking_id`, `quote_id`).
-- ============================================================================

alter table message
  add column if not exists attachment_kind text;

alter table message drop constraint if exists message_attachment_kind_check;
alter table message add constraint message_attachment_kind_check
  check (attachment_kind is null or attachment_kind in ('voucher','quote'));

comment on column message.attachment_kind is
  'Documento que se genera y adjunta al entregar. El PDF NO se guarda: se compone en el envío desde las referencias de la fila, para que nunca viaje una versión vieja.';
