-- 0087 · parte 2 de 5 — El plazo y qué pasa al vencer, por proveedor.
--
-- Ejecuta la parte 1 ANTES que esta.
--
-- QUÉ HACE
--  · Declara, para cada proveedor, cuántas horas tiene para contestar y qué
--    pasa si no contesta.
--  · Dos valores y no tres. `alert` es el de por defecto porque es el único que
--    no decide nada en nombre de nadie; `tacit` obliga a un tercero que no hizo
--    nada, así que se declara uno por uno. `reassign` NO está: reasignar no es
--    una política, es una función que no existe, y una casilla que no mueve
--    nada es peor que no ofrecerla.
--
-- NO borra ni cambia ninguna fila.

alter table supplier
  add column if not exists acceptance_window_hours integer,
  add column if not exists on_deadline_expiry text not null default 'alert';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'supplier_deadline_expiry_ck') then
    alter table supplier add constraint supplier_deadline_expiry_ck
      check (on_deadline_expiry in ('alert','tacit'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'supplier_acceptance_window_ck') then
    alter table supplier add constraint supplier_acceptance_window_ck
      check (acceptance_window_hours is null or acceptance_window_hours > 0);
  end if;
end $$;

comment on column supplier.acceptance_window_hours is
  'Horas que tiene este proveedor para contestar (0087). Nula: el plazo por '
  'defecto de la operadora. El plazo REAL nunca pasa de la hora de la salida, '
  'porque un plazo que vence después de que el servicio ocurra no es un plazo.';

-- ── VERIFICACIÓN ───────────────────────────────────────────────────────────
select on_deadline_expiry, count(*) as proveedores
  from supplier
 group by on_deadline_expiry
 order by on_deadline_expiry;
