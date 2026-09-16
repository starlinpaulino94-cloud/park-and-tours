-- ═══════════════════════════════════════════════════════════════════════════
-- 0049 — LO QUE FALTA PARA DECLARAR LAS COMPRAS (606)
--
-- POR QUÉ
--
-- En República Dominicana toda empresa envía cada mes dos archivos: el 607 con
-- sus ventas y el 606 con sus compras y gastos. El sistema ya guarda los NCF de
-- venta —los emite él—, pero del lado de las compras no guarda NADA de lo que
-- el 606 exige: ni el NCF que le dio el proveedor, ni su RNC, ni cuánto de ese
-- gasto era ITBIS, ni las retenciones.
--
-- Sin esos campos, un gasto registrado en el sistema NO SE PUEDE DECLARAR. Lo
-- que pasa de verdad es que el contador vuelve a teclear los mismos gastos en
-- un Excel aparte, y a partir de ahí las dos cifras se separan: la del sistema
-- y la que se declaró.
--
-- QUÉ SE AÑADE, Y NADA MÁS
--
-- Exactamente las columnas que el formato pide y el sistema no tenía. Todas
-- opcionales: un gasto sin comprobante fiscal —una propina, un peaje— sigue
-- siendo un gasto legítimo del negocio, solo que no va al 606. Obligarlas
-- habría convertido cada caja chica en un formulario imposible.
-- ═══════════════════════════════════════════════════════════════════════════

alter table expense
  -- El comprobante que entregó el proveedor. Es la pieza central del 606: sin
  -- NCF, ese gasto no existe para la declaración.
  add column if not exists ncf text,
  add column if not exists ncf_type text,
  -- El NCF que este comprobante modifica (una nota de crédito del proveedor).
  add column if not exists ncf_modified text,
  -- El RNC del proveedor, copiado al registrar: el del maestro puede cambiar
  -- después, y lo declarado tiene que ser lo que decía la factura.
  add column if not exists supplier_rnc text,
  -- El desglose que pide el formato.
  add column if not exists itbis_amount numeric(14,2) default 0,
  add column if not exists itbis_withheld numeric(14,2) default 0,
  add column if not exists isr_withheld numeric(14,2) default 0,
  add column if not exists selective_tax numeric(14,2) default 0,
  add column if not exists other_taxes numeric(14,2) default 0,
  add column if not exists legal_tip numeric(14,2) default 0,
  -- Qué tipo de bien o servicio se compró (01 a 11 en el formato). Sin esto la
  -- DGII no acepta la línea.
  add column if not exists goods_service_type text,
  -- Cuándo se pagó: el formato lo pide aparte de la fecha del comprobante.
  add column if not exists paid_date date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expense_ncf_type_check') then
    alter table expense add constraint expense_ncf_type_check
      check (ncf_type is null or ncf_type in
        ('b01','b02','b03','b04','b11','b13','b14','b15','b16','b17',
         'e31','e32','e33','e34','e41','e43','e44','e45','e46','e47'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expense_goods_service_type_check') then
    alter table expense add constraint expense_goods_service_type_check
      check (goods_service_type is null or goods_service_type in
        ('01','02','03','04','05','06','07','08','09','10','11'));
  end if;
end $$;

-- La consulta del 606 es siempre «los gastos de un mes»: por fecha y empresa.
create index if not exists expense_period_idx
  on expense (organization_id, expense_date);

-- Y la del 607, «las facturas emitidas de un mes».
create index if not exists invoice_issued_idx
  on invoice (organization_id, issued_at)
  where ncf is not null;
