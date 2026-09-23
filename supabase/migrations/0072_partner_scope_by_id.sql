-- 0072 — El ámbito del socio deja de depender del NOMBRE del rol.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LO QUE DECÍA ANTES
--
--   select app.current_app_role() is distinct from 'partner'
--       or row_partner = app.current_partner_id()
--
-- O sea: «si tu rol NO se llama partner, ves todo». El identificador de socio,
-- en cambio, lo emite el enganche del token en cuanto la membresía cuelga de
-- una organización de tipo socio — sea el rol el que sea.
--
-- Así que un empleado de un tour center dado de alta como `seller` o `cashier`
-- pasaba esta política entera: tiene identificador de socio, pero no ese rol.
-- La aplicación ya lo cierra desde esta misma entrega (`esDeSocio`); esto es
-- para que la BASE no diga lo contrario, porque una política que contradice a
-- la aplicación es la que alguien citará el día que discutan qué pasó.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LO QUE DICE AHORA
--
-- «Sin identificador de socio, ves todo; con identificador, solo lo tuyo.»
-- Mismo enunciado que la aplicación, palabra por palabra.
--
-- No hace falta tocar ninguna política: todas llaman a esta función, así que
-- cambiarla las cambia todas a la vez. Y sigue siendo `stable`, que es lo que
-- permite a Postgres evaluarla una vez por consulta y no una vez por fila.
create or replace function app.can_read_partner(row_partner uuid) returns boolean
  language sql stable as $$
    select app.current_partner_id() is null
        or row_partner = app.current_partner_id()
  $$;

comment on function app.can_read_partner(uuid) is
  'Ámbito del socio por IDENTIFICADOR, no por nombre de rol (0072): sin '
  'partner_id en el token se ve todo; con partner_id, solo las filas de ese '
  'socio. Antes miraba app_role = partner, así que un empleado de un tour '
  'center con otro rol pasaba de largo.';
