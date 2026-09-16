-- ═══════════════════════════════════════════════════════════════════════════
-- 0052 — QUE COMPRAR Y VENDER MUEVAN EL ALMACÉN
--
-- POR QUÉ
--
-- El motor de inventario está desde 0013 y es correcto: todo movimiento pasa
-- por `postMovement`, que escribe el movimiento y recalcula el saldo. El
-- problema es quién lo llama: NADIE salvo la pantalla de movimientos manuales.
--
--  · Recibir una orden de compra no movía una unidad. `stock_movement` tiene
--    desde 0013 una columna `purchase_order_id` que jamás se escribió: se
--    marcaba la orden como recibida y después alguien metía un ajuste a ojo.
--
--  · Vender tampoco. Los extras vendibles (0036) —el almuerzo, la camiseta, la
--    botella de agua— no tienen forma de decir «esto es un artículo del
--    almacén», así que venderlos no descuenta nada.
--
--  · `stock_level.reserved` existe desde 0013, la pantalla de existencias lo
--    enseña en una columna, y NADA lo ha escrito nunca. Siempre cero.
--
-- QUÉ AÑADE
--
-- Los enlaces que faltan para cerrar los dos circuitos, y nada más. Los
-- cálculos siguen donde estaban: `inventory.ts` mueve, `purchasing.ts` decide
-- qué se recibe, y los dos se prueban aparte.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── trazar el movimiento hasta la línea que lo originó ─────────────────────
--
-- Con solo `purchase_order_id` no se puede saber CUÁNTO se ha recibido de cada
-- línea, y sin eso lo recibido solo vive en `quantity_received`, que es
-- editable a mano desde el CRUD genérico. Con la línea, lo recibido se cuenta
-- sumando movimientos: la cifra que tiene detrás unidades físicas.
alter table stock_movement
  add column if not exists purchase_order_line_id uuid
    references purchase_order_line(id) on delete set null,
  -- Lo mismo del lado de la venta: qué extra vendido consumió estas unidades.
  add column if not exists booking_extra_id uuid;

create index if not exists stock_movement_po_line_idx
  on stock_movement (organization_id, purchase_order_line_id)
  where purchase_order_line_id is not null;

create index if not exists stock_movement_booking_extra_idx
  on stock_movement (organization_id, booking_extra_id)
  where booking_extra_id is not null;

-- ── el extra vendible que además es un artículo del almacén ────────────────
--
-- No todos lo son: una «recogida en el hotel» se vende y no sale de ningún
-- estante. Por eso `consumes_stock` nace en false — encenderlo es una decisión
-- de quien configura el producto, no algo que el sistema deduzca.
alter table product_extra
  add column if not exists inventory_item_id uuid references inventory_item(id) on delete set null,
  add column if not exists warehouse_id uuid references warehouse(id) on delete set null,
  add column if not exists consumes_stock boolean not null default false,
  -- Cuántas unidades de almacén consume CADA unidad vendida. Un «almuerzo» es
  -- una unidad; un «pack de 3 cervezas» son tres.
  add column if not exists stock_per_unit numeric(14,3) not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'product_extra_stock_per_unit_check') then
    alter table product_extra add constraint product_extra_stock_per_unit_check
      check (stock_per_unit > 0);
  end if;
end $$;

-- ── lo contratado se congela, también por el lado del almacén ──────────────
--
-- `booking_extra` ya congela el precio: si mañana sube el almuerzo, la reserva
-- de ayer sigue valiendo lo que el cliente pagó. Con el stock pasa igual — si
-- mañana cambian el artículo o el almacén del extra, la reserva de ayer tiene
-- que devolver SUS unidades a SU almacén cuando se cancele.
alter table booking_extra
  add column if not exists inventory_item_id uuid references inventory_item(id) on delete set null,
  add column if not exists warehouse_id uuid references warehouse(id) on delete set null,
  -- Unidades comprometidas en total (cantidad vendida × unidades por unidad).
  add column if not exists stock_quantity numeric(14,3),
  -- En qué punto del circuito está este compromiso.
  --   reserved → vendido, aparta existencias pero todavía no salieron
  --   consumed → el cliente se lo llevó; las unidades salieron de verdad
  --   released → la reserva se cayó y las unidades volvieron a estar libres
  add column if not exists stock_state text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'booking_extra_stock_state_check') then
    alter table booking_extra add constraint booking_extra_stock_state_check
      check (stock_state is null or stock_state in ('reserved','consumed','released'));
  end if;
end $$;

create index if not exists booking_extra_stock_idx
  on booking_extra (organization_id, stock_state)
  where stock_state is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stock_movement_booking_extra_fk') then
    alter table stock_movement add constraint stock_movement_booking_extra_fk
      foreign key (booking_extra_id) references booking_extra(id) on delete set null;
  end if;
end $$;

-- ── la recepción deja rastro propio ────────────────────────────────────────
alter table purchase_order
  -- Cuántas veces se ha recibido contra esta orden. Una orden que llega en tres
  -- camiones tiene tres recepciones, y saberlo evita la pregunta «¿esto ya lo
  -- metimos?» que acaba en el doble conteo.
  add column if not exists receipt_count integer not null default 0,
  add column if not exists last_received_by uuid references auth.users(id) on delete set null;

drop trigger if exists stock_movement_po_line_same_tenant on stock_movement;
create trigger stock_movement_po_line_same_tenant
before insert or update of organization_id, purchase_order_line_id, booking_extra_id on stock_movement
for each row execute function app.enforce_same_tenant_refs(
  'purchase_order_line_id', 'purchase_order_line',
  'booking_extra_id', 'booking_extra'
);

drop trigger if exists product_extra_stock_same_tenant on product_extra;
create trigger product_extra_stock_same_tenant
before insert or update of organization_id, inventory_item_id, warehouse_id on product_extra
for each row execute function app.enforce_same_tenant_refs(
  'inventory_item_id', 'inventory_item',
  'warehouse_id', 'warehouse'
);

drop trigger if exists booking_extra_stock_same_tenant on booking_extra;
create trigger booking_extra_stock_same_tenant
before insert or update of organization_id, inventory_item_id, warehouse_id on booking_extra
for each row execute function app.enforce_same_tenant_refs(
  'inventory_item_id', 'inventory_item',
  'warehouse_id', 'warehouse'
);
