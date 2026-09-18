/**
 * Almacén: depósitos, artículos, existencias, movimientos y compras.
 *
 * El inventario solo dice la verdad si las existencias SALEN de los movimientos.
 * Por eso aquí se siembra la cadena entera —compra recibida, movimiento de
 * entrada, consumo— y el nivel de stock se escribe como resultado de esos
 * movimientos, no como un número suelto que ya nadie podría explicar.
 */
export async function seed(h) {
  const hecho = {};
  const proveedores = await h.rows("supplier", "id,name", 10);
  const sucursales = await h.rows("branch", "id,name", 10);

  hecho.warehouse = await h.unless("warehouse", async () => {
    let n = 0;
    for (const [i, w] of [
      { name: "Almacén central", code: "ALM-01", warehouse_type: "main" },
      { name: "Bar de la playa", code: "ALM-02", warehouse_type: "bar" },
      { name: "Tienda de recuerdos", code: "ALM-03", warehouse_type: "retail" },
    ].entries()) {
      await h.insert("warehouse", {
        ...w,
        branch_id: sucursales[i % Math.max(sucursales.length, 1)]?.id ?? null,
        location: "Punta Cana",
        status: "active",
      });
      n++;
    }
    return n;
  });

  const depositos = await h.rows("warehouse", "id,name", 10);

  hecho.inventory_item = await h.unless("inventory_item", async () => {
    let n = 0;
    const articulos = [
      { name: "Agua embotellada 500 ml", sku: "BEB-001", item_type: "beverage", unit: "bottle", cost: 0.35, price: 2, min_stock: 200, reorder_point: 300, reorder_qty: 600, is_sellable: true },
      { name: "Camiseta del parque", sku: "RET-001", item_type: "retail", unit: "unit", cost: 4.2, price: 18, min_stock: 40, reorder_point: 60, reorder_qty: 120, is_sellable: true },
      { name: "Chaleco salvavidas", sku: "EQU-001", item_type: "equipment", unit: "unit", cost: 22, min_stock: 30, reorder_point: 40, reorder_qty: 50 },
      { name: "Combustible buggy", sku: "CON-001", item_type: "fuel", unit: "l", cost: 1.15, min_stock: 400, reorder_point: 500, reorder_qty: 1000 },
    ];
    for (const [i, a] of articulos.entries()) {
      await h.insert("inventory_item", {
        ...a,
        currency: "usd",
        supplier_id: proveedores[i % Math.max(proveedores.length, 1)]?.id ?? null,
        shelf_life_days: a.item_type === "beverage" ? 540 : null,
        status: "active",
      });
      n++;
    }
    return n;
  });

  const articulos = await h.rows("inventory_item", "id,name,cost", 10);

  // ── una compra recibida, con su línea ────────────────────────────────────
  hecho.purchase_order = await h.unless("purchase_order", async () => {
    if (articulos.length === 0 || depositos.length === 0) return 0;
    let n = 0;
    for (const [i, estado] of ["received", "pending"].entries()) {
      const total = i === 0 ? 690 : 246;
      const poId = await h.insert("purchase_order", {
        code: `OC-2026-${String(i + 1).padStart(4, "0")}`,
        status: estado,
        supplier_id: proveedores[i % Math.max(proveedores.length, 1)]?.id ?? null,
        warehouse_id: depositos[0].id,
        ordered_at: h.at(-(10 - i * 4)),
        expected_at: h.at(-(3 - i * 6)),
        received_at: estado === "received" ? h.at(-3) : null,
        subtotal: total, tax: 0, total,
        currency: "usd",
        payment_terms: "30 días",
        receipt_count: estado === "received" ? 1 : 0,
      });
      const art = articulos[i % articulos.length];
      const cantidad = i === 0 ? 600 : 120;
      await h.insert("purchase_order_line", {
        purchase_order_id: poId,
        inventory_item_id: art.id,
        description: art.name,
        quantity: cantidad,
        quantity_received: estado === "received" ? cantidad : 0,
        unit_cost: Number(art.cost ?? 1),
        line_total: total,
      });
      n++;
    }
    return n;
  });

  // ── los movimientos, que son la fuente de la verdad ─────────────────────
  hecho.stock_movement = await h.unless("stock_movement", async () => {
    if (articulos.length === 0 || depositos.length === 0) return 0;
    const compras = await h.rows("purchase_order", "id,status", 5);
    const recibida = compras.find((c) => c.status === "received");
    let n = 0;

    // Entrada por la compra recibida.
    const agua = articulos[0];
    await h.insert("stock_movement", {
      inventory_item_id: agua.id,
      warehouse_id: depositos[0].id,
      movement_type: "receipt",
      quantity: 600,
      unit_cost: Number(agua.cost ?? 0.35),
      total_cost: 600 * Number(agua.cost ?? 0.35),
      currency: "usd",
      moved_at: h.at(-3, 10, 0),
      balance_after: 600,
      purchase_order_id: recibida?.id ?? null,
      reference: "OC-2026-0001",
      reason: "Recepción de compra",
    });
    n++;

    // Y las salidas de los días siguientes: el bar consumiendo.
    let saldo = 600;
    for (let d = 2; d >= 0; d--) {
      const consumo = 60 + d * 15;
      saldo -= consumo;
      await h.insert("stock_movement", {
        inventory_item_id: agua.id,
        warehouse_id: depositos[1]?.id ?? depositos[0].id,
        movement_type: "consumption",
        quantity: -consumo,
        unit_cost: Number(agua.cost ?? 0.35),
        total_cost: -consumo * Number(agua.cost ?? 0.35),
        currency: "usd",
        moved_at: h.at(-d, 18, 0),
        balance_after: saldo,
        reason: "Consumo del bar de playa",
      });
      n++;
    }
    return n;
  });

  // ── y el nivel, que es el RESULTADO de lo anterior ──────────────────────
  hecho.stock_level = await h.unless("stock_level", async () => {
    if (articulos.length === 0 || depositos.length === 0) return 0;
    let n = 0;
    // El agua queda con lo que dejaron los movimientos de arriba; el resto, con
    // existencias de partida. Que el primero cuadre con su historial es lo que
    // hace creíble la pantalla de existencias.
    const niveles = [
      { item: 0, deposito: 0, cantidad: 345, coste: 0.35 },
      { item: 1, deposito: 2, cantidad: 48, coste: 4.2 },
      { item: 2, deposito: 0, cantidad: 25, coste: 22 },
      { item: 3, deposito: 0, cantidad: 380, coste: 1.15 },
    ];
    for (const nivel of niveles) {
      const art = articulos[nivel.item % articulos.length];
      if (!art) continue;
      await h.insert("stock_level", {
        inventory_item_id: art.id,
        warehouse_id: depositos[nivel.deposito % depositos.length].id,
        quantity: nivel.cantidad,
        reserved: 0,
        available: nivel.cantidad,
        avg_cost: nivel.coste,
        last_movement_at: h.at(0, 18, 0),
        last_counted_at: h.at(-7),
      });
      n++;
    }
    return n;
  });

  return hecho;
}
