/**
 * Finanzas: plan de cuentas, periodos, asientos, gastos, plan de cuotas, arqueo,
 * nómina y tarjetas regalo.
 *
 * Lo importante de este módulo no es que haya números, es que CUADREN. Un asiento
 * con el debe distinto del haber, o un plan de cuotas cuya suma no da el total de
 * la venta, convierte la demostración en una discusión sobre por qué el sistema
 * no suma — que es exactamente lo contrario de lo que se va a enseñar.
 */
export async function seed(h) {
  const hecho = {};

  // ── plan de cuentas ──────────────────────────────────────────────────────
  hecho.ledger_account = await h.unless("ledger_account", async () => {
    let n = 0;
    const cuentas = [
      { code: "1101", name: "Caja y bancos", account_type: "asset", normal_side: "debit" },
      { code: "1201", name: "Cuentas por cobrar", account_type: "asset", normal_side: "debit", subledger: "receivable" },
      { code: "2101", name: "Cuentas por pagar", account_type: "liability", normal_side: "credit", subledger: "payable" },
      { code: "2301", name: "ITBIS por pagar", account_type: "liability", normal_side: "credit" },
      { code: "4101", name: "Ingresos por excursiones", account_type: "income", normal_side: "credit" },
      { code: "5101", name: "Costo de servicios", account_type: "expense", normal_side: "debit" },
      { code: "5201", name: "Gastos operativos", account_type: "expense", normal_side: "debit" },
    ];
    for (const c of cuentas) {
      await h.insert("ledger_account", { ...c, is_postable: true, currency: "usd", status: "active" });
      n++;
    }
    return n;
  });

  const cuentas = await h.rows("ledger_account", "id,code,name", 20);
  const porCodigo = (code) => cuentas.find((c) => c.code === code)?.id ?? null;

  // ── periodos contables ───────────────────────────────────────────────────
  hecho.accounting_period = await h.unless("accounting_period", async () => {
    const hoy = new Date();
    let n = 0;
    for (let atras = 2; atras >= 0; atras--) {
      const d = new Date(hoy.getFullYear(), hoy.getMonth() - atras, 1);
      const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      await h.insert("accounting_period", {
        period,
        // El mes en curso abierto y los anteriores cerrados: así se ve que el
        // cierre impide asentar en un periodo ya cuadrado.
        status: atras === 0 ? "open" : "closed",
        closed_at: atras === 0 ? null : h.at(-30 * atras + 3),
        total_debit: atras === 0 ? null : 48250,
        total_credit: atras === 0 ? null : 48250,
        net_income: atras === 0 ? null : 12400,
      });
      n++;
    }
    return n;
  });

  // ── asientos que CUADRAN ─────────────────────────────────────────────────
  hecho.ledger_entry = await h.unless("ledger_entry", async () => {
    if (cuentas.length === 0) return 0;
    const hoy = new Date();
    const period = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
    let n = 0;

    // Cada asiento se escribe como PAR debe/haber por el mismo importe. Es la
    // única forma de que el balance de comprobación dé cero, y un mayor que no
    // da cero no se puede enseñar.
    const asientos = [
      { code: "AS-0001", memo: "Cobro de excursión en efectivo", debe: "1101", haber: "4101", importe: 1450, source: "payment" },
      { code: "AS-0002", memo: "Venta a crédito a tour center", debe: "1201", haber: "4101", importe: 2300, source: "order" },
      { code: "AS-0003", memo: "ITBIS de la venta del día", debe: "5201", haber: "2301", importe: 261, source: "order" },
      { code: "AS-0004", memo: "Costo de proveedor de transporte", debe: "5101", haber: "2101", importe: 780, source: "payable" },
    ];
    for (const a of asientos) {
      for (const [lado, cuenta] of [["debit", a.debe], ["credit", a.haber]]) {
        await h.insert("ledger_entry", {
          entry_code: a.code,
          line_no: lado === "debit" ? 1 : 2,
          posted_at: h.at(-2, 18, 0),
          period,
          ledger_account_id: porCodigo(cuenta),
          debit: lado === "debit" ? a.importe : 0,
          credit: lado === "credit" ? a.importe : 0,
          currency: "usd",
          exchange_rate: 1,
          amount_base: a.importe,
          memo: a.memo,
          source_type: a.source,
        });
        n++;
      }
    }
    return n;
  });

  // ── gastos, con su NCF para el 606 ───────────────────────────────────────
  hecho.expense = await h.unless("expense", async () => {
    const categorias = await h.rows("expense_category", "id,name", 10);
    const proveedores = await h.rows("supplier", "id,name", 10);
    let n = 0;
    const gastos = [
      { concept: "Gasoil para la flota", amount: 420, ncf: "B0100000045", itbis_amount: 64.07 },
      { concept: "Repuestos de buggy", amount: 235, ncf: "B0100000046", itbis_amount: 35.85 },
      { concept: "Publicidad en redes", amount: 300, ncf: null, itbis_amount: 0 },
    ];
    for (const [i, g] of gastos.entries()) {
      await h.insert("expense", {
        ...g,
        category_id: categorias[i % Math.max(categorias.length, 1)]?.id ?? null,
        supplier_id: proveedores[i % Math.max(proveedores.length, 1)]?.id ?? null,
        currency: "usd",
        exchange_rate: 1,
        expense_date: h.dateOnly(-(5 - i)),
        payment_method: i === 2 ? "card" : "cash",
        status: "paid",
        paid_date: h.dateOnly(-(5 - i)),
        ncf_type: g.ncf ? "01" : null,
        goods_service_type: i === 2 ? "09" : "06",
      });
      n++;
    }
    return n;
  });

  // ── plan de cuotas sobre una venta que ya existe ─────────────────────────
  hecho.payment_schedule = await h.unless("payment_schedule", async () => {
    const ventas = await h.rows("sales_order", "id,total_amount,currency", 10);
    const venta = ventas.find((v) => Number(v.total_amount ?? 0) > 0);
    if (!venta) return 0;

    // El depósito y el saldo SUMAN el total de la venta. Si no sumaran, la
    // pantalla de cobros enseñaría una deuda que no existe.
    const total = Number(venta.total_amount);
    const deposito = Math.round(total * 0.3 * 100) / 100;
    const saldo = Math.round((total - deposito) * 100) / 100;
    let n = 0;
    for (const [i, cuota] of [
      { kind: "deposit", amount: deposito, due: -10, paid: deposito, status: "paid" },
      { kind: "balance", amount: saldo, due: 6, paid: 0, status: "pending" },
    ].entries()) {
      await h.insert("payment_schedule", {
        order_id: venta.id,
        sequence: i + 1,
        kind: cuota.kind,
        due_date: h.dateOnly(cuota.due),
        amount: cuota.amount,
        paid_amount: cuota.paid,
        balance: Math.round((cuota.amount - cuota.paid) * 100) / 100,
        currency: venta.currency || "usd",
        status: cuota.status,
        paid_at: cuota.paid > 0 ? h.at(-10) : null,
      });
      n++;
    }
    return n;
  });

  // ── un arqueo con descuadre, que es el caso que importa ─────────────────
  hecho.cash_count = await h.unless("cash_count", async () => {
    const sesiones = await h.rows("cash_session", "id", 5);
    if (sesiones.length === 0) return 0;
    await h.insert("cash_count", {
      cash_session_id: sesiones[0].id,
      currency: "usd",
      kind: "close",
      breakdown: { "100": 8, "50": 6, "20": 15, "10": 9, "5": 12, "1": 20 },
      counted_total: 1570,
      expected_total: 1585,
      // Quince dólares de menos: un arqueo perfecto no enseña que el sistema
      // detecta descuadres, que es justo para lo que sirve.
      difference: -15,
      counted_at: h.at(-1, 19, 30),
      notes: "Faltan 15 USD; pendiente de revisar con el cajero.",
    });
    return 1;
  });

  // ── nómina quincenal con sus retenciones ─────────────────────────────────
  hecho.payroll_run = await h.unless("payroll_run", async () => {
    const personal = await h.rows("staff", "id,full_name", 10);
    if (personal.length === 0) return 0;

    const runId = await h.insert("payroll_run", {
      code: "NOM-2026-01",
      period_start: h.dateOnly(-15),
      period_end: h.dateOnly(-1),
      period_type: "biweekly",
      status: "approved",
      currency: "dop",
      sfs_employee_pct: 3.04,
      afp_employee_pct: 2.87,
      sfs_employer_pct: 7.09,
      afp_employer_pct: 7.1,
      risk_employer_pct: 1.2,
      staff_count: Math.min(personal.length, 4),
      approved_at: h.at(-1),
    });

    let bruto = 0, deducciones = 0, neto = 0, costo = 0;
    for (const [i, persona] of personal.slice(0, 4).entries()) {
      const salario = 18000 + i * 4000;
      const sfs = Math.round(salario * 0.0304 * 100) / 100;
      const afp = Math.round(salario * 0.0287 * 100) / 100;
      const isr = i >= 2 ? Math.round(salario * 0.05 * 100) / 100 : 0;
      const totalDeducciones = Math.round((sfs + afp + isr) * 100) / 100;
      const salarioNeto = Math.round((salario - totalDeducciones) * 100) / 100;
      const costoEmpleador = Math.round(salario * 1.1539 * 100) / 100;

      await h.insert("payroll_line", {
        payroll_run_id: runId,
        staff_id: persona.id,
        staff_name: persona.full_name,
        days_worked: 15,
        regular_hours: 120,
        overtime_hours: i === 1 ? 6 : 0,
        hourly_rate: Math.round((salario / 120) * 100) / 100,
        regular_amount: salario,
        gross_amount: salario,
        sfs_employee: sfs,
        afp_employee: afp,
        isr_amount: isr,
        deductions_amount: totalDeducciones,
        net_amount: salarioNeto,
        employer_cost: costoEmpleador,
        currency: "dop",
      });

      bruto += salario; deducciones += totalDeducciones; neto += salarioNeto; costo += costoEmpleador;
    }

    // Los totales de la nómina son la SUMA de sus líneas, no un número aparte.
    await h.sb.from("payroll_run").update({
      gross_amount: Math.round(bruto * 100) / 100,
      deductions_amount: Math.round(deducciones * 100) / 100,
      net_amount: Math.round(neto * 100) / 100,
      employer_cost: Math.round(costo * 100) / 100,
    }).eq("id", runId);

    return 1;
  });

  // ── tarjetas regalo ──────────────────────────────────────────────────────
  hecho.gift_card = await h.unless("gift_card", async () => {
    const clientes = await h.rows("customer", "id", 5);
    let n = 0;
    for (const [i, t] of [
      { code: "REGALO-1001", initial_amount: 200, balance: 200, status: "active" },
      { code: "REGALO-1002", initial_amount: 150, balance: 45, status: "active" },
      { code: "REGALO-1003", initial_amount: 100, balance: 0, status: "redeemed" },
    ].entries()) {
      await h.insert("gift_card", {
        ...t,
        currency: "usd",
        customer_id: clientes[i % Math.max(clientes.length, 1)]?.id ?? null,
        issued_at: h.at(-(40 - i * 10)),
        expires_at: h.at(325 + i * 10),
        recipient_name: ["Laura Gómez", "Pedro Jiménez", "Nadia Torres"][i],
        delivery_channel: "email",
        message: "¡Felicidades! Disfruta tu excursión.",
      });
      n++;
    }
    return n;
  });

  return hecho;
}
