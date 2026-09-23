-- 0081 · parte 1 de 2 — De quién es el dinero de cada caja.
--
-- Pégalo entero en el editor SQL de Supabase y ejecútalo. Luego la parte 2.
--
-- QUÉ HACE
--  · Añade `partner_id` y `seller_id` a las tres tablas de caja. Hasta ahora
--    llevaban sucursal y usuario, y nada más: no había forma de decir «esta
--    caja es del tour center Coral».
--  · Sus índices, porque el arqueo va a filtrar por socio en cada cierre.
--
-- NO borra ni cambia ninguna fila: las que existen se quedan con la columna
-- nula, que es exactamente lo que significa «caja de la operadora».

alter table cash_register
  add column if not exists partner_id uuid references organizations(id) on delete restrict,
  add column if not exists seller_id  uuid references seller(id) on delete set null;

alter table cash_session
  add column if not exists partner_id uuid references organizations(id) on delete restrict,
  add column if not exists seller_id  uuid references seller(id) on delete set null;

alter table cash_movement
  add column if not exists partner_id uuid references organizations(id) on delete restrict,
  add column if not exists seller_id  uuid references seller(id) on delete set null;

comment on column cash_session.partner_id is
  'El tour center cuyo mostrador es esta caja (0081). Nulo = caja de la '
  'operadora. El arqueo interno EXCLUYE las que lo llevan: su efectivo está en '
  'el mostrador del socio, no en el cajón de la operadora.';
comment on column cash_movement.partner_id is
  'Se sella al escribir el movimiento, copiándolo del cobro (0081). Vive aquí '
  'y no solo en la sesión porque ésta es la fila que se SUMA: filtrar por una '
  'columna de otra tabla es el salto que alguna consulta se acaba olvidando.';

-- El arqueo pregunta «qué hay en la caja de la operadora en este turno», y esa
-- consulta filtra por socio. Sin el índice, es un recorrido de la tabla entera
-- de movimientos cada vez que alguien cierra un turno.
create index if not exists cash_movement_partner_idx
  on cash_movement (organization_id, partner_id, movement_at desc);
create index if not exists cash_session_partner_idx
  on cash_session (organization_id, partner_id, status);
create index if not exists cash_movement_seller_idx
  on cash_movement (organization_id, seller_id, movement_at desc)
  where seller_id is not null;

-- ── VERIFICACIÓN ───────────────────────────────────────────────────────────
-- Tienen que salir las seis columnas, dos por tabla.
select table_name, column_name
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('cash_register','cash_session','cash_movement')
   and column_name in ('partner_id','seller_id')
 order by table_name, column_name;
