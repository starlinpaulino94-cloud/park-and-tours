-- ============================================================================
-- 0090 — EL MANIFIESTO SALE SOLO, Y SALE RECORTADO
--
-- El manifiesto vivía en dos sitios, los dos detrás de una sesión: una pantalla
-- y un PDF. El chofer que arranca a las seis de la mañana no tiene sesión y el
-- proveedor de transporte tampoco, así que alguien de la oficina bajaba el PDF
-- y lo reenviaba a mano — cuando se acordaba.
--
-- Lo que esta migración abre es que salga por la bandeja de salida como
-- cualquier otro aviso. Y como es el documento con más datos personales de
-- terceros del sistema, sale RECORTADO según quién lo abre: hace falta decir en
-- la fila para quién se recorta, porque el documento no se guarda —se compone
-- en el momento de entregar— y sin esa marca el despachador no sabría qué corte
-- generar.
--
-- ── Y DE PASO, UNA RESTRICCIÓN QUE MENTÍA ─────────────────────────────────
--
-- `message_template_key_check` (0034) enumera SIETE claves. El código declara
-- OCHO desde que existe `booking_rescheduled`: una empresa que intentara
-- reescribir el texto de «te movemos la excursión de fecha» se llevaba un
-- 23514 de la base, sin que nada en la aplicación lo anticipara. Se arregla
-- aquí porque hay que tocar la misma restricción de todos modos, y una prueba
-- (`src/lib/messaging/render.test.ts`) comprueba desde ahora que la lista del
-- código y la de la base digan lo mismo.
-- ============================================================================

-- ── 1. la clave de plantilla que faltaba, y la nueva ───────────────────────
alter table message_template drop constraint if exists message_template_key_check;
alter table message_template add constraint message_template_key_check
  check (key in ('booking_confirmation','booking_cancelled','booking_rescheduled',
                 'pre_tour_reminder','payment_receipt','balance_due','quote_sent',
                 'post_tour_thanks','manifest_dispatch'));

-- ── 2. el manifiesto, como documento que acompaña ──────────────────────────
alter table message drop constraint if exists message_attachment_kind_check;
alter table message add constraint message_attachment_kind_check
  check (attachment_kind is null or attachment_kind in ('voucher','quote','manifest'));

-- ── 3. para quién se recorta ese documento ─────────────────────────────────
--
-- `interno` no es el valor por defecto de la columna a propósito: el defecto es
-- NULO, y un adjunto sin recorte declarado no se compone. Si el defecto fuera
-- «interno», una fila mal encolada mandaría el manifiesto ENTERO —con teléfonos
-- y saldos— a quien tocara. Lo que no se declara, no sale.
alter table message
  add column if not exists attachment_scope text;

alter table message drop constraint if exists message_attachment_scope_check;
alter table message add constraint message_attachment_scope_check
  check (attachment_scope is null or attachment_scope in ('interno','guia','chofer','proveedor'));

comment on column message.attachment_scope is
  'Para quién se recorta el documento adjunto. Nulo = sin recorte declarado, y entonces no se compone: el manifiesto entero lleva teléfonos, habitaciones y saldos de clientes.';

-- La bandeja se consulta por salida para responder «¿se le mandó el manifiesto
-- a este chofer?», que es la primera pregunta cuando un cliente se queda en el
-- lobby. Sin índice, esa consulta recorre la tabla entera de mensajes.
create index if not exists message_departure_idx
  on message (organization_id, departure_id)
  where departure_id is not null;
