import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * LA PARTIDA DOBLE, PROBADA POR PRIMERA VEZ.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTE FICHERO NO EXISTÍA
 *
 * `ledger.ts` son 291 líneas: valida que un asiento cuadre, se niega a
 * contabilizar dentro de un mes cerrado, mantiene el saldo corriente de cada
 * cuenta en el signo de su naturaleza, reversa con el asiento espejo y arma el
 * balance de comprobación paginando. Es el motor del dinero de la empresa y no
 * tenía **ni una prueba**.
 *
 * A diferencia de `asset-impact`, este sí se ejecutaba —`ledger-events` lo llama
 * al vender y al cobrar—, así que no había ninguna excusa de «no se usa». Lo que
 * pasaba es que sus tres puertas de contable estaban huérfanas, así que nadie lo
 * miraba de frente.
 *
 * Se cubre lo que cuesta dinero si se rompe: que no entre un asiento
 * descuadrado, que no entre en un mes cerrado, que el saldo se mueva en el lado
 * correcto, que la reversa sea de verdad un espejo, y que el balance de
 * comprobación **no diga «cuadrado» cuando la lectura se truncó**.
 */

const tenantQuery = vi.fn();
const tenantCreate = vi.fn();
const tenantUpdate = vi.fn();

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    tenantQuery: (...a: unknown[]) => tenantQuery(...a),
    tenantCreate: (...a: unknown[]) => tenantCreate(...a),
    tenantUpdate: (...a: unknown[]) => tenantUpdate(...a),
  };
});

import { post, reverse, trialBalance, ensureChart, DEFAULT_CHART } from "@/lib/ledger";

const ORG = "org-1";

const CAJA = { _id: "acc-caja", code: "1101", name: "Caja general", account_type: "asset", normal_side: "debit", balance: 0 };
const INGRESO = { _id: "acc-ing", code: "4101", name: "Ingresos por excursiones", account_type: "revenue", normal_side: "credit", balance: 0 };

/**
 * `post` hace tres tipos de lectura y hay que distinguirlas por la tabla, no por
 * el orden: reordenar el código no debe romper las pruebas por el motivo
 * equivocado.
 */
function montar({ cuentas = [CAJA, INGRESO], periodos = [] as any[] } = {}) {
  tenantQuery.mockReset(); tenantCreate.mockReset(); tenantUpdate.mockReset();
  tenantQuery.mockImplementation(async (_org: string, tabla: string) => {
    if (tabla === "ledger_account") return cuentas.map((c) => ({ ...c }));
    if (tabla === "accounting_period") return periodos;
    return [];
  });
  let n = 0;
  tenantCreate.mockImplementation(async () => ({ _id: `row-${++n}` }));
  tenantUpdate.mockResolvedValue({});
}

const VENTA = {
  source: "sale" as const,
  lines: [
    { account: "1101", debit: 1000 },
    { account: "4101", credit: 1000 },
  ],
};

describe("el asiento que no cuadra no entra", () => {
  beforeEach(() => montar());

  it("rechaza el descuadre diciendo la diferencia, y no escribe nada", async () => {
    await expect(post(ORG, {
      source: "adjustment",
      lines: [{ account: "1101", debit: 1000 }, { account: "4101", credit: 900 }],
    })).rejects.toThrow(/no cuadra[\s\S]*1000[\s\S]*900[\s\S]*100/);
    expect(tenantCreate, "un asiento descuadrado no puede dejar ni una línea").not.toHaveBeenCalled();
  });

  it("rechaza el asiento de una sola línea", async () => {
    await expect(post(ORG, { source: "adjustment", lines: [{ account: "1101", debit: 10 }] }))
      .rejects.toThrow(/al menos dos líneas/);
    expect(tenantCreate).not.toHaveBeenCalled();
  });

  it("las líneas en cero no cuentan para el mínimo de dos", async () => {
    await expect(post(ORG, {
      source: "adjustment",
      lines: [{ account: "1101", debit: 10 }, { account: "4101", debit: 0, credit: 0 }],
    })).rejects.toThrow(/al menos dos líneas/);
  });

  it("una cuenta que no existe falla con su código y sin escribir", async () => {
    await expect(post(ORG, {
      source: "adjustment",
      lines: [{ account: "9999", debit: 10 }, { account: "4101", credit: 10 }],
    })).rejects.toThrow(/"9999" no existe/);
    expect(tenantCreate).not.toHaveBeenCalled();
  });

  it("los céntimos no inventan un descuadre", async () => {
    await expect(post(ORG, {
      source: "adjustment",
      lines: [
        { account: "1101", debit: 0.1 }, { account: "1101", debit: 0.2 },
        { account: "4101", credit: 0.3 },
      ],
    })).resolves.toMatchObject({ total: 0.3 });
  });
});

describe("no se contabiliza dentro de un mes cerrado", () => {
  it("un periodo cerrado devuelve 409 y no escribe", async () => {
    montar({ periodos: [{ period: "2026-09", status: "closed" }] });
    await expect(post(ORG, { ...VENTA, postedAt: "2026-09-15T10:00:00.000Z" }))
      .rejects.toMatchObject({ status: 409 });
    expect(tenantCreate, "ni una línea en un mes cerrado").not.toHaveBeenCalled();
  });

  it("un periodo declarado tampoco", async () => {
    montar({ periodos: [{ period: "2026-09", status: "locked" }] });
    await expect(post(ORG, { ...VENTA, postedAt: "2026-09-15T10:00:00.000Z" }))
      .rejects.toMatchObject({ status: 409 });
  });

  it("un periodo abierto sí", async () => {
    montar({ periodos: [{ period: "2026-09", status: "open" }] });
    await expect(post(ORG, { ...VENTA, postedAt: "2026-09-15T10:00:00.000Z" })).resolves.toBeTruthy();
  });

  /**
   * El orden importa y es difícil de ver leyendo: si la comprobación del cierre
   * fuera DESPUÉS de empezar a escribir, un mes cerrado se quedaría con un
   * asiento a medias — peor que el problema que la comprobación evita.
   */
  it("el cierre se comprueba ANTES de la primera línea", async () => {
    montar({ periodos: [{ period: "2026-09", status: "closed" }] });
    await expect(post(ORG, { ...VENTA, postedAt: "2026-09-15T10:00:00.000Z" })).rejects.toThrow();
    expect(tenantCreate).toHaveBeenCalledTimes(0);
    expect(tenantUpdate, "tampoco puede haber movido un saldo").not.toHaveBeenCalled();
  });
});

describe("lo que queda escrito de un asiento", () => {
  beforeEach(() => montar());

  it("una línea por cada línea, con el mismo código de asiento y el periodo del día", async () => {
    const res = await post(ORG, { ...VENTA, postedAt: "2026-09-15T10:00:00.000Z" });
    const lineas = tenantCreate.mock.calls.filter((c) => c[1] === "ledger_entry").map((c) => c[2]);
    expect(lineas).toHaveLength(2);
    expect(new Set(lineas.map((l) => l.entry_code)).size, "un asiento es UN código").toBe(1);
    expect(lineas.map((l) => l.line_no)).toEqual([1, 2]);
    expect(lineas.every((l) => l.period === "2026-09")).toBe(true);
    expect(res.entryCode).toMatch(/^AS-202609-/);
    expect(res.total).toBe(1000);
  });

  it("nace sin reversar, con su origen y su referencia al documento", async () => {
    await post(ORG, { ...VENTA, refs: { order: "ord-7" } });
    const linea = tenantCreate.mock.calls.filter((c) => c[1] === "ledger_entry")[0][2];
    expect(linea.reversed).toBe(false);
    expect(linea.source_type).toBe("sale");
    expect(linea.order, "sin el enlace al documento, el asiento no se puede rastrear").toBe("ord-7");
  });

  it("el saldo se mueve en el signo de la naturaleza de cada cuenta", async () => {
    await post(ORG, VENTA);
    const saldos = tenantUpdate.mock.calls
      .filter((c) => c[1] === "ledger_account")
      .map((c) => [c[2], c[3].balance]);
    // Un débito sube una cuenta de activo…
    expect(saldos).toContainEqual(["acc-caja", 1000]);
    // …y un crédito sube una de ingreso, que es de naturaleza acreedora: el
    // saldo sale POSITIVO, no negativo. Con el signo al revés el estado de
    // resultados enseñaría los ingresos en negativo.
    expect(saldos).toContainEqual(["acc-ing", 1000]);
  });

  it("dos líneas contra la misma cuenta acumulan, no se pisan", async () => {
    await post(ORG, {
      source: "adjustment",
      lines: [
        { account: "1101", debit: 100 }, { account: "1101", debit: 50 },
        { account: "4101", credit: 150 },
      ],
    });
    const deCaja = tenantUpdate.mock.calls
      .filter((c) => c[1] === "ledger_account" && c[2] === "acc-caja")
      .map((c) => c[3].balance);
    expect(deCaja, "la segunda línea tiene que partir del saldo que dejó la primera")
      .toEqual([100, 150]);
  });

  it("la tasa de cambio deja el importe en moneda base", async () => {
    await post(ORG, {
      source: "sale", currency: "usd", exchangeRate: 60,
      lines: [{ account: "1101", debit: 10 }, { account: "4101", credit: 10 }],
    });
    const lineas = tenantCreate.mock.calls.filter((c) => c[1] === "ledger_entry").map((c) => c[2]);
    expect(lineas[0].amount_base).toBe(600);
    expect(lineas[1].amount_base).toBe(-600);
  });
});

describe("reversar es escribir el espejo, no borrar", () => {
  function montarConAsiento(filas: any[]) {
    montar();
    tenantQuery.mockImplementation(async (_o: string, tabla: string) => {
      if (tabla === "ledger_entry") return filas;
      if (tabla === "ledger_account") return [{ ...CAJA }, { ...INGRESO }];
      if (tabla === "accounting_period") return [];
      return [];
    });
  }

  const FILAS = [
    { _id: "e-1", line_no: 1, debit: 1000, credit: 0, memo: "Cobro", ledger_account: { code: "1101" } },
    { _id: "e-2", line_no: 2, debit: 0, credit: 1000, memo: "Venta", ledger_account: { code: "4101" } },
  ];

  it("cambia el lado de cada línea y marca el original", async () => {
    montarConAsiento(FILAS);
    const res = await reverse(ORG, "AS-202609-ABCDE", "u-1");

    const nuevas = tenantCreate.mock.calls.filter((c) => c[1] === "ledger_entry").map((c) => c[2]);
    expect(nuevas).toHaveLength(2);
    // Lo que era débito es crédito y al revés: eso es el espejo.
    expect(nuevas[0]).toMatchObject({ debit: 0, credit: 1000 });
    expect(nuevas[1]).toMatchObject({ debit: 1000, credit: 0 });

    const marcadas = tenantUpdate.mock.calls.filter((c) => c[1] === "ledger_entry");
    expect(marcadas.map((c) => c[2]).sort()).toEqual(["e-1", "e-2"]);
    for (const m of marcadas) {
      expect(m[3]).toMatchObject({ reversed: true, reversal_of: res.entryCode });
    }
  });

  it("el espejo no borra nada", async () => {
    montarConAsiento(FILAS);
    await reverse(ORG, "AS-202609-ABCDE");
    // Si alguna vez apareciera un borrado aquí, la historia dejaría de ser historia.
    const borrados = tenantUpdate.mock.calls.filter((c) => c[3]?.deleted || c[3]?.deleted_at);
    expect(borrados).toEqual([]);
  });

  it("un asiento inexistente o ya reversado da 404", async () => {
    montarConAsiento([]);
    await expect(reverse(ORG, "AS-NO-EXISTE")).rejects.toMatchObject({ status: 404 });
    expect(tenantCreate, "no puede quedar media reversa").not.toHaveBeenCalled();
  });

  it("solo pide las que no están reversadas: dos reversas seguidas no se duplican", async () => {
    montarConAsiento(FILAS);
    await reverse(ORG, "AS-202609-ABCDE");
    const filtro = tenantQuery.mock.calls.find((c) => c[1] === "ledger_entry")![2]._filter;
    expect(filtro, "sin este filtro, reversar dos veces escribiría el espejo dos veces")
      .toMatchObject({ entry_code: "AS-202609-ABCDE", reversed: false });
  });
});

describe("el balance de comprobación tiene que poder contrastarse", () => {
  function conAsientos(filas: any[]) {
    tenantQuery.mockReset();
    tenantQuery.mockImplementation(async (_o: string, tabla: string, q: any) => {
      if (tabla !== "ledger_entry") return [];
      return filas.slice(q._offset || 0, (q._offset || 0) + (q._limit || 1000));
    });
  }

  const linea = (code: string, debit: number, credit: number) => ({
    ledger_account: { _id: `acc-${code}`, code, name: code, account_type: "asset" },
    debit, credit,
  });

  it("agrupa por cuenta, ordena por código y suma los totales", async () => {
    conAsientos([linea("4101", 0, 500), linea("1101", 300, 0), linea("1101", 200, 0)]);
    const r = await trialBalance(ORG);
    expect(r.rows.map((x) => x.code), "el contable lee el balance por código").toEqual(["1101", "4101"]);
    expect(r.rows[0]).toMatchObject({ debit: 500, credit: 0 });
    expect(r.totals).toEqual({ debit: 500, credit: 500 });
    expect(r.balanced).toBe(true);
    expect(r.entries).toBe(3);
    expect(r.truncated).toBe(false);
  });

  it("dice que no cuadra cuando no cuadra", async () => {
    conAsientos([linea("1101", 300, 0), linea("4101", 0, 200)]);
    const r = await trialBalance(ORG);
    expect(r.balanced).toBe(false);
  });

  it("una línea sin cuenta no rompe el informe ni se cuela en las filas", async () => {
    conAsientos([linea("1101", 100, 0), { ledger_account: null, debit: 50, credit: 0 }]);
    const r = await trialBalance(ORG);
    expect(r.rows).toHaveLength(1);
    expect(r.totals.debit, "la huérfana no puede sumar en los totales").toBe(100);
  });

  /**
   * LA PROPIEDAD QUE MOTIVÓ ESTA OLA.
   *
   * Pasado el techo, el informe está INCOMPLETO y sus débitos y créditos pueden
   * cuadrar entre ellos igual. Quien lo lea tiene que poder saberlo: es el único
   * papel con el que se cierra un mes.
   */
  it("pagina más allá de la primera página", async () => {
    conAsientos([...Array(2500)].map(() => linea("1101", 1, 1)));
    const r = await trialBalance(ORG);
    expect(r.entries, "se quedó en la primera página").toBe(2500);
    expect(r.rows[0].debit).toBe(2500);
  });

  it("avisa de que la lectura se truncó, aunque diga cuadrado", async () => {
    conAsientos([...Array(200_000)].map(() => linea("1101", 1, 1)));
    const r = await trialBalance(ORG);
    expect(r.truncated, "un informe recortado tiene que decirlo").toBe(true);
    // Y cuadra: exactamente por eso `truncated` no puede quedarse en el motor.
    expect(r.balanced).toBe(true);
  }, 20_000);

  it("el periodo se pasa como filtro, no se filtra después", async () => {
    conAsientos([linea("1101", 1, 1)]);
    await trialBalance(ORG, "2026-09");
    expect(tenantQuery.mock.calls[0][2]._filter).toEqual({ period: "2026-09" });
  });
});

describe("sembrar el plan de cuentas no pisa lo que ya hay", () => {
  it("crea solo las que faltan y devuelve cuántas", async () => {
    montar({ cuentas: [{ code: "1101" }, { code: "4101" }] as any });
    const creadas = await ensureChart(ORG);
    expect(creadas).toBe(DEFAULT_CHART.length - 2);
    const codigos = tenantCreate.mock.calls.map((c) => c[2].code);
    expect(codigos, "volvió a crear una que ya existía").not.toContain("1101");
    expect(codigos).toContain("2202");
  });

  it("con el plan completo no escribe nada: es idempotente", async () => {
    montar({ cuentas: DEFAULT_CHART.map((c) => ({ ...c })) as any });
    expect(await ensureChart(ORG)).toBe(0);
    expect(tenantCreate).not.toHaveBeenCalled();
  });

  it("nace en cero: el saldo de una cuenta lo hacen los asientos", async () => {
    montar({ cuentas: [] });
    await ensureChart(ORG);
    expect(tenantCreate.mock.calls.every((c) => c[2].balance === 0)).toBe(true);
  });
});
