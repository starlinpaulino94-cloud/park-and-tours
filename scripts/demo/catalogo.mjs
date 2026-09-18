/**
 * Lo que se vende y con qué reglas: impuestos, divisas, extras, descargos,
 * pases y categorías de gasto.
 *
 * Son los catálogos que el resto de las pantallas piden en un selector. Sin
 * ellos, media aplicación enseña listas vacías aunque haya reservas.
 */
export async function seed(h) {
  const hecho = {};

  // ── el perfil fiscal dominicano ──────────────────────────────────────────
  hecho.tax_profile = await h.unless("tax_profile", async () => {
    await h.insert("tax_profile", {
      name: "ITBIS 18 % · República Dominicana",
      country: "do",
      tax_name: "ITBIS",
      tax_rate: 18,
      included_in_price: true,
      tourism_tax_rate: 10,
      tax_id_label: "RNC",
      ncf_series: "B02",
      ncf_next: 1,
      ncf_expires: h.dateOnly(365),
      status: "active",
    });
    return 1;
  });

  // ── divisas ──────────────────────────────────────────────────────────────
  //
  // Una operadora dominicana cobra en dólares y paga en pesos: sin tasa, los
  // informes mezclan monedas y cuadran mal.
  hecho.currency_rate = await h.unless("currency_rate", async () => {
    let n = 0;
    for (const [from, to, rate] of [["usd", "dop", 60.5], ["eur", "usd", 1.08], ["dop", "usd", 0.0165]]) {
      await h.insert("currency_rate", {
        currency_from: from, currency_to: to, rate,
        rate_date: h.dateOnly(0), source: "Banco Central (demostración)",
      });
      n++;
    }
    return n;
  });

  // ── extras vendibles, colgados de los productos que ya hay ───────────────
  hecho.product_extra = await h.unless("product_extra", async () => {
    const productos = await h.rows("product", "id,name", 10);
    if (productos.length === 0) return 0;
    const catalogo = [
      { name: "Fotos del tour", price: 25, price_type: "per_booking", max_quantity: 1 },
      { name: "Almuerzo típico", price: 18, price_type: "per_person" },
      { name: "Traslado desde el hotel", price: 15, price_type: "per_person" },
      { name: "Seguro de cancelación", price: 9, price_type: "per_person" },
    ];
    let n = 0;
    for (const [i, extra] of catalogo.entries()) {
      await h.insert("product_extra", {
        product_id: productos[i % productos.length].id,
        ...extra, currency: "usd", sort_order: i, status: "active",
      });
      n++;
    }
    return n;
  });

  // ── el descargo de responsabilidad que se firma antes de subir ───────────
  hecho.waiver_template = await h.unless("waiver_template", async () => {
    await h.insert("waiver_template", {
      name: "Descargo de actividades acuáticas",
      version: "2026.1",
      jurisdiction: "República Dominicana",
      language: "es",
      body: "El participante declara saber nadar y no padecer afecciones cardíacas…",
      requires_guardian: true,
      min_age_self_sign: 18,
      valid_from: h.dateOnly(-30),
      status: "active",
    });
    return 1;
  });

  // ── pases de temporada ───────────────────────────────────────────────────
  hecho.membership_plan = await h.unless("membership_plan", async () => {
    let n = 0;
    for (const plan of [
      { name: "Pase anual familiar", code: "PASE-FAM", plan_type: "annual_pass", price: 480, duration_days: 365 },
      { name: "Pase de temporada", code: "PASE-TEMP", plan_type: "season_pass", price: 220, duration_days: 120 },
    ]) {
      await h.insert("membership_plan", { ...plan, currency: "usd", status: "active" });
      n++;
    }
    return n;
  });

  // ── categorías de gasto ──────────────────────────────────────────────────
  hecho.expense_category = await h.unless("expense_category", async () => {
    let n = 0;
    for (const [name, color] of [
      ["Combustible", "#F97316"], ["Mantenimiento de flota", "#0EA5E9"],
      ["Comisiones bancarias", "#A855F7"], ["Publicidad", "#22C55E"], ["Suministros", "#64748B"],
    ]) {
      await h.insert("expense_category", { name, color, status: "active" });
      n++;
    }
    return n;
  });

  return hecho;
}
