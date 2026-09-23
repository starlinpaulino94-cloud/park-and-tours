-- 0072 · PARTE 1 — el ámbito del socio, por identificador y no por rol.
--
-- Pegar entero y ejecutar. Re-ejecutable.
--
-- No toca ninguna política: todas llaman a esta función, así que cambiarla las
-- cambia todas a la vez.
create or replace function app.can_read_partner(row_partner uuid) returns boolean
  language sql stable as $fn$
    select app.current_partner_id() is null
        or row_partner = app.current_partner_id()
  $fn$;

comment on function app.can_read_partner(uuid) is
  'Ámbito del socio por IDENTIFICADOR, no por nombre de rol (0072): sin '
  'partner_id en el token se ve todo; con partner_id, solo las filas de ese '
  'socio. Antes miraba app_role = partner, así que un empleado de un tour '
  'center con otro rol pasaba de largo.';
