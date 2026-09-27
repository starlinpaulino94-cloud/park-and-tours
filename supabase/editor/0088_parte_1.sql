-- 0088 · parte 1 de 2 — De quien es cada parada, y a que hora se marco.
--
-- Pegalo ENTERO en el editor SQL de Supabase. Luego la parte 2.
--
-- QUE HACE
--  · `supplier_id` y `service_date` en `pickup`. La hoja de ruta devuelve
--    nombres, habitaciones y telefonos; para acotarla hay que saber de quien es
--    cada parada, y eso solo se sabia uniendo con la ruta — que es justo lo que
--    la capa de consulta de esta aplicacion no sabe filtrar.
--  · `marked_at`, `marked_by` y `marked_via`. «Recogido» y «no-show» estaban en
--    el esquema desde 0011 y nadie los escribia. Un no-show es una acusacion:
--    sin hora, la discusion es la palabra del chofer contra la del turista.
--
-- NO borra ni cambia ninguna fila.

alter table pickup
  add column if not exists supplier_id  uuid references supplier(id) on delete set null,
  add column if not exists service_date timestamptz;

comment on column pickup.supplier_id is
  'De qué proveedor es esta parada, copiado de su ruta (0088). Vive aquí '
  'porque es donde se filtra: lo que hay al otro lado de esta fila es el '
  'nombre, el hotel, la habitación y el teléfono de un cliente.';

create index if not exists pickup_supplier_idx
  on pickup (organization_id, supplier_id, service_date desc)
  where supplier_id is not null;

alter table pickup
  add column if not exists marked_at  timestamptz,
  add column if not exists marked_by  uuid references auth.users(id) on delete set null,
  add column if not exists marked_via text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pickup_marked_via_ck') then
    alter table pickup add constraint pickup_marked_via_ck
      check (marked_via is null or marked_via in ('chofer','operacion'));
  end if;
end $$;

comment on column pickup.marked_at is
  'Cuándo se marcó el estado ACTUAL de esta parada (0088). Junto a '
  '`planned_time` es lo que dice si el chofer esperó antes de declarar un '
  'no-show; sin ella, esa discusión es la palabra de uno contra la del otro.';

-- ── VERIFICACION ───────────────────────────────────────────────────────────
select column_name
  from information_schema.columns
 where table_schema = 'public' and table_name = 'pickup'
   and column_name in ('supplier_id','service_date','marked_at','marked_by','marked_via')
 order by column_name;
