-- ═══════════════════════════════════════════════════════════════════════════
-- 0098 · PARTE 1 DE 2 — EL ESTADO DE LA MEMBRESÍA EN EL ESPEJO DE MEMBEGO
--
-- Pega este bloque entero en el editor SQL de Supabase y dale a «Run». Aguanta
-- ejecutarse dos veces. Luego corre `0098_parte_2_verificacion.sql`.
--
-- QUÉ ARREGLA. `membego_customer` guarda el plan de cada cliente, pero los dos
-- eventos que cierran el ciclo —`membresia.cancelada` y `membresia.vencida`—
-- llegaban al webhook y se archivaban como `ignored`. El espejo dice «Plan Oro»
-- de una membresía cancelada hace tres semanas, con toda la seguridad de un
-- dato que alguien escribió a propósito.
--
-- Y HAY PRISA POR OTRO MOTIVO: sin esta columna, el upsert del webhook falla
-- por una columna inexistente y los eventos se acumulan en la cola de MembeGo.
-- Esto va ANTES del código, no después. La columna es aditiva y opcional, así
-- que aplicarla antes no rompe nada de lo que ya corre.
--
-- POR QUÉ UNA COLUMNA Y NO BORRAR EL PLAN. Poner el plan a NULL al cancelar
-- deja el espejo indistinguible de un cliente que NUNCA tuvo membresía. Son dos
-- cosas distintas y el mostrador las trata distinto: a uno se le ofrece, al
-- otro se le pregunta por qué se fue.
--
-- QUÉ NO DECIDE. Nada que valga dinero: el canje de beneficios se pregunta a la
-- API de MembeGo en vivo, precisamente porque una copia desfasada regala un
-- beneficio ya consumido. Esto es para ENSEÑAR.
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
