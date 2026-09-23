-- ═══════════════════════════════════════════════════════════════════════════
-- 0079 — EL ESTADO DE LA MEMBRESÍA EN EL ESPEJO DE MEMBEGO
--
-- LO QUE PASA HOY
--
-- `membego_customer` guarda el plan, si es de pago y hasta cuándo vale. Lo
-- escribe `membresia.activada` y no lo borra nadie, porque los dos eventos que
-- cierran el ciclo —`membresia.cancelada` y `membresia.vencida`— llegaban al
-- webhook y se archivaban como `ignored`: MembeGo empezó a mandarlos y este
-- satélite se quedó en la lista de siete tipos que reconocía al nacer.
--
-- El resultado es la peor forma de estar mal: el espejo dice «Plan Oro» de una
-- membresía cancelada hace tres semanas, con toda la seguridad de un dato que
-- alguien escribió a propósito.
--
-- POR QUÉ UNA COLUMNA Y NO BORRAR LOS CAMPOS
--
-- Poner el plan a NULL al cancelar deja el espejo indistinguible de un cliente
-- que NUNCA tuvo membresía. Son dos cosas distintas y el mostrador las trata
-- distinto: a uno se le ofrece, al otro se le pregunta por qué se fue.
--
-- Con una columna de estado, la baja se dice en vez de borrarse: «Plan Oro,
-- cancelada». Y `membership_valid_until` conserva su sentido — en una vencida
-- es la fecha en que dejó de valer, que es justo lo que alguien quiere ver.
--
-- QUÉ NO DECIDE ESTA COLUMNA
--
-- NADA que valga dinero. El canje de beneficios se pregunta a la API de
-- MembeGo en vivo (`membego-redemption-service.ts`), como manda su contrato,
-- precisamente porque una copia desfasada regala un beneficio ya consumido.
-- Esto es para ENSEÑAR, y por eso puede vivir en una copia.
--
-- ORDEN DE DESPLIEGUE: este SQL primero, el código después. La columna es
-- aditiva y opcional, así que aplicarla antes no rompe nada de lo que ya
-- corre; al revés, el upsert del webhook fallaría por una columna inexistente
-- y los eventos se acumularían en la cola de MembeGo.
-- ═══════════════════════════════════════════════════════════════════════════

alter table membego_customer
  add column if not exists membership_status text
    check (membership_status in ('active', 'cancelled', 'expired'));

comment on column membego_customer.membership_status is
  'Estado de la membresía SEGÚN MEMBEGO: active | cancelled | expired. NULL = nunca llegó un evento de membresía para este cliente. Informativo: la elegibilidad para canjear se pregunta a la API de MembeGo en vivo, nunca a esta copia.';

-- Las filas que ya existen con plan vienen de `membresia.activada`, que es el
-- único evento de membresía que este satélite atendía: su estado es `active`.
-- Una que nunca tuvo plan se queda en NULL, que es su verdad.
update membego_customer
   set membership_status = 'active'
 where membership_status is null
   and (membership_id is not null or plan_id is not null or plan_name is not null);
