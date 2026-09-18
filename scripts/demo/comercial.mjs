/**
 * La red comercial de la ola 7 y lo que se cotiza antes de vender.
 *
 * Son las pantallas más nuevas del sistema y las que salen vacías en una
 * demostración: quién trajo al cliente, metas y bonos, ajustes de comisión,
 * cotizaciones y pases de socio.
 */
export async function seed(h) {
  const hecho = {};

  const vendedores = await h.rows("seller", "id,first_name,last_name,code", 20);
  const productos = await h.rows("product", "id,name", 10);
  const clientes = await h.rows("customer", "id,first_name,last_name", 20);

  // ── tipos de vendedor ────────────────────────────────────────────────────
  //
  // Sobre estos grupos se fijan comisiones y metas: un conserje de hotel no
  // cobra lo mismo que un taxista ni que una agencia.
  hecho.seller_type = await h.unless("seller_type", async () => {
    let n = 0;
    for (const [name, description] of [
      ["Hotel", "Conserjes y recepción de hoteles aliados."],
      ["Taxista", "Transportistas que traen clientes al tour center."],
      ["Agencia", "Agencias de viaje con tarifario neto."],
      ["Interno", "Vendedores de mostrador de la propia operadora."],
    ]) {
      await h.insert("seller_type", { name, description, status: "active" });
      n++;
    }
    return n;
  });

  const tipos = await h.rows("seller_type", "id,name", 10);

  // ── enlaces y QR por vendedor ────────────────────────────────────────────
  hecho.seller_link = await h.unless("seller_link", async () => {
    if (vendedores.length === 0) return 0;
    let n = 0;
    for (const [i, v] of vendedores.slice(0, 4).entries()) {
      const apodo = (v.code || v.first_name || `v${i}`).toLowerCase().replace(/[^a-z0-9]/g, "");
      await h.insert("seller_link", {
        seller_id: v.id,
        slug: `${apodo}-${1000 + i}`,
        name: `Enlace de ${[v.first_name, v.last_name].filter(Boolean).join(" ") || v.code}`,
        channel: i % 2 === 0 ? "qr" : "whatsapp",
        product_id: productos[i % Math.max(productos.length, 1)]?.id ?? null,
        campaign: i === 0 ? "Temporada alta" : null,
        status: "active",
      });
      n++;
    }
    return n;
  });

  // ── el embudo: visitas, registros y compras atribuidas ───────────────────
  //
  // Sin hechos no hay embudo, y la pantalla de captación es justo un embudo.
  hecho.seller_attribution = await h.unless("seller_attribution", async () => {
    const enlaces = await h.rows("seller_link", "id,seller_id", 10);
    if (enlaces.length === 0) return 0;
    let n = 0;
    for (const [i, enlace] of enlaces.entries()) {
      const visitante = `demo-visitante-${i}`;
      // Más visitas que registros y más registros que compras: un embudo que se
      // estrecha, que es como se ve uno de verdad.
      for (const [stage, veces, dias] of [["visit", 6, 20], ["signup", 3, 14], ["booking", 2, 9], ["purchase", 1, 5]]) {
        for (let k = 0; k < veces; k++) {
          await h.insert("seller_attribution", {
            seller_id: enlace.seller_id,
            link_id: enlace.id,
            stage,
            visitor_id: `${visitante}-${k}`,
            customer_id: stage === "visit" ? null : clientes[k % Math.max(clientes.length, 1)]?.id ?? null,
            channel: i % 2 === 0 ? 'qr' : 'whatsapp',
            // La tabla fecha con `created_at`: es un histórico inmutable, así que
            // el momento del hecho ES el momento en que se escribió.
            created_at: h.at(-(dias - k)),
          });
          n++;
        }
      }
    }
    return n;
  });

  // ── metas y bonos ────────────────────────────────────────────────────────
  hecho.seller_goal = await h.unless("seller_goal", async () => {
    let n = 0;
    await h.insert("seller_goal", {
      name: "Ventas del mes · toda la red",
      period: "monthly",
      target_bookings: 120,
      target_revenue: 45000,
      currency: "usd",
      reward: "Cena para dos en el hotel aliado",
      status: "active",
    });
    n++;
    if (tipos.length > 0) {
      await h.insert("seller_goal", {
        name: "Captación de conserjes",
        seller_type_id: tipos.find((t) => t.name === "Hotel")?.id ?? tipos[0].id,
        period: "monthly",
        target_signups: 40,
        target_pax: 180,
        reward: "Bono de 150 USD",
        status: "active",
      });
      n++;
    }
    return n;
  });

  hecho.seller_bonus = await h.unless("seller_bonus", async () => {
    if (vendedores.length === 0) return 0;
    const metas = await h.rows("seller_goal", "id", 5);
    let n = 0;
    for (const [i, v] of vendedores.slice(0, 3).entries()) {
      await h.insert("seller_bonus", {
        seller_id: v.id,
        goal_id: metas[i % Math.max(metas.length, 1)]?.id ?? null,
        description: i === 0 ? "Superó la meta de reservas del mes" : "Premio por captación",
        // Lo en especie NO se transfiere en la liquidación: se entregó y punto.
        payout_kind: i === 2 ? "in_kind" : "cash",
        amount: i === 2 ? 0 : 150,
        currency: "usd",
        status: i === 0 ? "approved" : "pending",
        awarded_at: h.at(-(5 + i)),
        notes: i === 2 ? "Cena para dos, ya entregada." : null,
      });
      n++;
    }
    return n;
  });

  // ── un ajuste de comisión, que es lo que deja rastro de una devolución ───
  hecho.commission_adjustment = await h.unless("commission_adjustment", async () => {
    const comisiones = await h.rows("commission", "id,amount,currency,booking_id", 5);
    if (comisiones.length === 0) return 0;
    const c = comisiones[0];
    await h.insert("commission_adjustment", {
      commission_id: c.id,
      // NEGATIVO: el cliente canceló y hay que recuperar lo ya pagado. Se firma
      // un ajuste en vez de editar la comisión, para que quede el rastro.
      amount: -Math.min(Number(c.amount ?? 0), 40),
      currency: c.currency || "usd",
      reason: "Reserva cancelada por el cliente después de liquidar",
      reason_code: "cancellation",
      booking_id: c.booking_id ?? null,
    });
    return 1;
  });

  // ── una cotización de grupo, con dos opciones ────────────────────────────
  hecho.quote = await h.unless("quote", async () => {
    const quoteId = await h.insert("quote", {
      code: "COT-2026-0001",
      title: "Grupo corporativo · 40 personas",
      quote_type: "corporate",
      status: "sent",
      customer_id: clientes[0]?.id ?? null,
      seller_id: vendedores[0]?.id ?? null,
      contact_name: "Marta Delgado",
      contact_email: "marta@empresa-ejemplo.do",
      company_name: "Caribe Consulting SRL",
      pax: 40,
      event_date: h.dateOnly(35),
      issued_at: h.at(-6),
      sent_at: h.at(-6),
      valid_until: h.at(14),
      subtotal: 4800, discount: 200, tax: 828, total: 5428, currency: "usd",
      deposit_type: "percent", deposit_percent: 30, deposit_due_date: h.dateOnly(7),
      balance_due_date: h.dateOnly(30),
      inclusions: "Transporte, almuerzo y guía bilingüe.",
      exclusions: "Bebidas alcohólicas y propinas.",
      payment_terms: "30 % al confirmar, resto 5 días antes.",
      sent_count: 1,
    });

    const opciones = [
      { name: "Opción A · media jornada", total: 4200, is_recommended: false, sort_order: 0 },
      { name: "Opción B · jornada completa con almuerzo", total: 5428, is_recommended: true, is_selected: true, sort_order: 1 },
    ];
    for (const o of opciones) {
      const optionId = await h.insert("quote_option", {
        quote_id: quoteId,
        name: o.name,
        sort_order: o.sort_order,
        is_recommended: o.is_recommended,
        is_selected: Boolean(o.is_selected),
        subtotal: o.total, total: o.total,
      });
      await h.insert("quote_line", {
        quote_id: quoteId,
        option_id: optionId,
        product_id: productos[0]?.id ?? null,
        description: o.name,
        quantity: 40,
        unit_price: Number((o.total / 40).toFixed(2)),
        line_total: o.total,
        adults: 36, children: 4,
        service_date: h.dateOnly(35),
        sort_order: o.sort_order,
      });
    }
    return 1;
  });

  // ── pases de socio en uso ────────────────────────────────────────────────
  hecho.membership = await h.unless("membership", async () => {
    const planes = await h.rows("membership_plan", "id,price,currency", 5);
    if (planes.length === 0 || clientes.length === 0) return 0;
    let n = 0;
    for (const [i, cliente] of clientes.slice(0, 3).entries()) {
      const plan = planes[i % planes.length];
      await h.insert("membership", {
        code: `SOC-${2026}${String(100 + i)}`,
        membership_plan_id: plan.id,
        customer_id: cliente.id,
        status: i === 2 ? "pending" : "active",
        starts_at: h.at(-(30 * (i + 1))),
        ends_at: h.at(365 - 30 * (i + 1)),
        visits_used: i * 3,
        amount_paid: i === 2 ? 0 : Number(plan.price ?? 0),
        currency: plan.currency || "usd",
        auto_renew: i === 0,
        last_visit_at: i === 0 ? h.at(-4) : null,
      });
      n++;
    }
    return n;
  });

  return hecho;
}
