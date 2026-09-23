-- VÍNCULO VENDEDOR↔CUENTA · PASO 2 — VINCULAR UNA ficha a UNA cuenta.
--
-- Se ejecuta una vez por vendedor, con los identificadores que devolvió la
-- PARTE 1 y DESPUÉS de mirar que esa persona es esa persona.
--
-- Una sola a la vez y a propósito: un `update` masivo sobre un emparejamiento
-- por correo es exactamente la operación que no se puede revisar después.
--
-- Cambia estos dos valores y ejecuta:
--   :ficha   → `ficha_id` de la parte 1
--   :cuenta  → `cuenta_id` de la parte 1
update seller
   set user_id = '00000000-0000-0000-0000-000000000000'   -- ← :cuenta
 where id      = '00000000-0000-0000-0000-000000000000'   -- ← :ficha
   and user_id is null                                    -- no pisa un vínculo existente
returning
  id                                              as ficha_id,
  trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) as vendedor,
  user_id                                         as cuenta_vinculada;
