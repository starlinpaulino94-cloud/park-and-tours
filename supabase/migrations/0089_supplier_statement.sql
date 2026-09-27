-- 0089 — El estado de cuenta del proveedor: su conformidad y su factura.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LA COSTURA YA ESTABA ANUNCIADA
--
-- `settlement-access.ts` dice, desde la fase 2: «el proveedor todavía no tiene
-- identidad en el sistema (llega en una fase posterior), así que hoy sus
-- liquidaciones solo las abre gerencia. Se declara igual para que el día que la
-- tenga no haya que volver a razonar esto».
--
-- Ese día es hoy. Lo que falta no es el ámbito —ese se decide en una función
-- que ya existe y por la que pasan la pantalla, el PDF y la disputa—: son las
-- dos cosas que el proveedor tiene que poder HACER con su corte.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LA CONFORMIDAD, QUE ES LA OTRA MITAD DE LA DISPUTA
--
-- `disputed` se puede poner desde 0076. Lo que no se podía poner es lo
-- contrario: «esto está bien». Y sin eso, el silencio de un proveedor y su
-- conformidad se parecen demasiado — que es exactamente el problema que 0087
-- resolvió para los servicios y que aquí vuelve, con dinero delante.
alter table settlement
  add column if not exists accepted_at timestamptz,
  add column if not exists accepted_by uuid references auth.users(id) on delete set null;

comment on column settlement.accepted_at is
  'Cuándo el BENEFICIARIO dio su conformidad a este corte (0089). No es lo '
  'mismo que `approved_at`, que es cuando la operadora lo aprobó: una es la '
  'casa diciendo «esto es lo que pago» y la otra el proveedor diciendo «de '
  'acuerdo». Confundirlas convierte una aprobación interna en un finiquito.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Y SU FACTURA, CON EL NÚMERO QUE LA DGII VA A LEER
--
-- Hasta ahora el número de comprobante del proveedor llegaba por WhatsApp y lo
-- tecleaba alguien de administración al registrar el gasto. Un dígito de más en
-- un NCF es un 606 rechazado, y el rechazo llega semanas después, cuando ya
-- nadie se acuerda de qué factura era.
--
-- Escribiéndolo el que lo emite se acaba el teléfono roto: quien tiene el papel
-- delante es quien lo copia.
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

/*
 * EL MISMO NÚMERO DOS VECES ES LA MISMA FACTURA DOS VECES.
 *
 * Un NCF es único por quien lo emite, así que dos liquidaciones del mismo
 * proveedor con el mismo comprobante solo pueden ser un error — y el error se
 * paga dos veces. Índice parcial porque casi todas las filas lo tienen nulo, y
 * por proveedor y no global porque dos proveedores distintos SÍ pueden emitir
 * el mismo número: cada uno tiene su propia serie.
 */
create unique index if not exists settlement_supplier_ncf_uq
  on settlement (organization_id, supplier_id, supplier_ncf)
  where supplier_ncf is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- LA POLÍTICA, EN LA MISMA ENTREGA
--
-- `settlement` y `booking_cost` pasan a estar en el ámbito del proveedor. La
-- de `settlement` ya filtraba por socio desde 0007; aquí se le añade la del
-- proveedor SIN quitarle la del socio — las dos condiciones se acumulan, igual
-- que en la aplicación, porque una liquidación puede ser de un socio o de un
-- proveedor y la política tiene que decir la verdad en los dos casos.
--
-- `can_read_partner` y `can_read_supplier` devuelven cierto cuando quien
-- consulta no es de ese tipo, así que el personal interno lo sigue viendo todo.
drop policy if exists tenant_select on public.settlement;
create policy tenant_select on public.settlement for select
  using (organization_id = app.current_org_id()
     and app.can_read_partner(partner_id)
     and app.can_read_supplier(supplier_id));

drop policy if exists tenant_select on public.booking_cost;
create policy tenant_select on public.booking_cost for select
  using (organization_id = app.current_org_id()
     and app.can_read_supplier(supplier_id));

-- `payable` NO entra, y es deliberado: es el libro de la operadora —lo que
-- debe, a quién y cuándo vence— y el proveedor no tiene nada que hacer
-- leyéndolo. Lo suyo es la liquidación, que es el documento con el que se
-- discute.
