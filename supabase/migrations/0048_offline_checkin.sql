-- ═══════════════════════════════════════════════════════════════════════════
-- 0048 — EL CHECK-IN QUE SE PUEDE REINTENTAR
--
-- POR QUÉ
--
-- El guía trabaja donde no hay señal: la playa, el muelle, el parking del hotel
-- a las siete de la mañana. Para que pueda embarcar sin conexión, lo que hace
-- se guarda en su teléfono y se manda cuando vuelve la red — y eso significa
-- que la MISMA petición puede llegar dos veces: el navegador reintenta, la
-- conexión va y viene, o él cierra y abre la aplicación.
--
-- Hoy el segundo intento recibe «esta reserva ya tiene el check-in completado»
-- (409), que es correcto para un voucher presentado dos veces por dos personas
-- distintas y es MENTIRA para un reintento del mismo embarque. La cola lo
-- marcaría como error, el guía vería «falló» sobre algo que sí ocurrió, y en la
-- puerta del bus eso termina en un pasajero embarcado dos veces o en uno que no
-- embarca.
--
-- LA CLAVE DISTINGUE LAS DOS COSAS
--
-- Cada embarque lleva una clave que genera el teléfono UNA vez. Si la clave que
-- llega es la que ya está guardada, es el mismo embarque otra vez y se contesta
-- que sí. Si es distinta, es otra persona con el mismo voucher y se rechaza
-- como hasta ahora. Sin la clave no se puede separar un reintento de un
-- fraude, y hay que elegir: o se aceptan los dos, o se rechazan los dos.
-- ═══════════════════════════════════════════════════════════════════════════

alter table booking
  add column if not exists checkin_key text;

-- Única por empresa: dos empresas pueden generar la misma clave sin estorbarse,
-- y dentro de una, la misma clave siempre es el mismo embarque.
create unique index if not exists booking_checkin_key_idx
  on booking (organization_id, checkin_key)
  where checkin_key is not null;
