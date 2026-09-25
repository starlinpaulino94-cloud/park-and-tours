-- 0089 · parte 1 de 2 — La conformidad del proveedor y su factura.
--
-- Pegalo ENTERO en el editor SQL de Supabase. Luego la parte 2.
--
-- QUE HACE
--  · `accepted_at` y `accepted_by`: la conformidad, que es la otra mitad de la
--    disputa. Sin ella, el silencio de un proveedor y su acuerdo se parecen
--    demasiado. Y NO es lo mismo que `approved_at`: esa es la operadora
--    diciendo «esto es lo que pago»; esta, el proveedor diciendo «de acuerdo».
--  · Su factura con el NCF que la DGII va a leer, escrito por quien tiene el
--    papel delante en vez de dictado por telefono.
--  · Y el mismo NCF del mismo proveedor dos veces no entra: es la misma factura
--    contada dos veces, y eso se paga dos veces.
--
-- NO borra ni cambia ninguna fila.

alter table settlement
  add column if not exists accepted_at timestamptz,
  add column if not exists accepted_by uuid references auth.users(id) on delete set null;

comment on column settlement.accepted_at is
  'Cuándo el BENEFICIARIO dio su conformidad a este corte (0089). No es lo '
  'mismo que `approved_at`, que es cuando la operadora lo aprobó: una es la '
  'casa diciendo «esto es lo que pago» y la otra el proveedor diciendo «de '
  'acuerdo». Confundirlas convierte una aprobación interna en un finiquito.';

alter table settlement
  add column if not exists supplier_invoice_number text,
  add column if not exists supplier_ncf            text,
  add column if not exists supplier_ncf_type       text,
  add column if not exists supplier_invoice_at     timestamptz,
  add column if not exists supplier_invoice_by     uuid references auth.users(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'settlement_supplier_ncf_type_ck') then
    alter table settlement add constraint settlement_supplier_ncf_type_ck
      check (supplier_ncf_type is null or supplier_ncf_type in
             ('b01','b02','b04','b11','b14','b15','e31','e32','e34','e44','e45'));
  end if;
end $$;

create unique index if not exists settlement_supplier_ncf_uq
  on settlement (organization_id, supplier_id, supplier_ncf)
  where supplier_ncf is not null;

-- ── VERIFICACION ───────────────────────────────────────────────────────────
select column_name
  from information_schema.columns
 where table_schema = 'public' and table_name = 'settlement'
   and column_name in ('accepted_at','accepted_by','supplier_invoice_number',
                       'supplier_ncf','supplier_ncf_type','supplier_invoice_at',
                       'supplier_invoice_by')
 order by column_name;
