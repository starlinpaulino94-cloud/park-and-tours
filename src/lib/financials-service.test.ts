import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * El cierre contable con la base simulada.
 *
 * Lo que se comprueba aquí es lo que no se ve en una función pura: que el
 * balance general mire TODO lo acumulado y el estado de resultados solo el
 * rango, que cerrar el ejercicio no se pueda hacer dos veces, y que el retrato
 * de las cifras se guarde al cerrar el periodo —porque si después se reabre, esa
 * es la única evidencia de lo que decía cuando se aprobó—.
 */

const tenantQuery = vi.fn();
const tenantCreate = vi.fn();
const tenantUpdate = vi.fn();
const post = vi.fn();
const trialBalance = vi.fn();

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    tenantQuery: (...a: unknown[]) => tenantQuery(...a),
    tenantCreate: (...a: unknown[]) => tenantCreate(...a),
    tenantUpdate: (...a: unknown[]) => tenantUpdate(...a),
  };
});
vi.mock("@/lib/ledger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ledger")>();
  return {
    ...actual,
    post: (...a: unknown[]) => post(...a),
    trialBalance: (...a: unknown[]) => trialBalance(...a),
  };
});

import { statements, movePeriod, closeYear, accountBalances } from "@/lib/financials-service";

const asiento = (code: string, type: string, debit: number, credit: number, extra: Record<string, unknown> = {}) => ({
  ledger_account: { _id: `a-${code}`, code, name: code, account_type: type },
  debit, credit, ...extra,
});

beforeEach(() => {
  tenantQuery.mockReset();
  tenantCreate.mockReset();
  tenantUpdate.mockReset();
  post.mockReset();
  trialBalance.mockReset();
  tenantCreate.mockResolvedValue({ _id: "x" });
  tenantUpdate.mockResolvedValue({});
});

describe("los saldos por cuenta", () => {
  it("el rango se traduce a un filtro de periodo inclusivo", async () => {
    tenantQuery.mockResolvedValue([]);
    await accountBalances("org", { from: "2026-01", to: "2026-03" });
    expect(tenantQuery.mock.calls[0][2]._filter.period).toEqual({ gte: "2026-01", lte: "2026-03" });
  });

  it("sin `from` mira desde el principio: es lo que necesita un balance general", async () => {
    tenantQuery.mockResolvedValue([]);
    await accountBalances("org", { to: "2026-03" });
    expect(tenantQuery.mock.calls[0][2]._filter.period).toEqual({ lte: "2026-03" });
  });

  it("el asiento de cierre se excluye por defecto: si no, dejaría el ejercicio en cero", async () => {
    tenantQuery.mockResolvedValue([
      asiento("4101", "revenue", 0, 100_000),
      asiento("4101", "revenue", 100_000, 0, { is_closing: true }),
    ]);
    const saldos = await accountBalances("org", { from: "2026-01", to: "2026-12" });
    expect(saldos[0].credit).toBe(100_000);
    expect(saldos[0].debit).toBe(0);
  });

  it("…y sí entra cuando se pide, que es el caso del balance general", async () => {
    tenantQuery.mockResolvedValue([
      asiento("4101", "revenue", 0, 100_000),
      asiento("4101", "revenue", 100_000, 0, { is_closing: true }),
    ]);
    const saldos = await accountBalances("org", { to: "2026-12", includeClosing: true });
    expect(saldos[0].debit).toBe(100_000);
  });

  it("un asiento sin cuenta no revienta el informe", async () => {
    tenantQuery.mockResolvedValue([{ debit: 100, credit: 0, ledger_account: null }]);
    expect(await accountBalances("org", {})).toEqual([]);
  });
});

describe("los tres estados", () => {
  it("el resultado mira el RANGO y el balance mira todo lo acumulado", async () => {
    const llamadas: Record<string, unknown>[] = [];
    tenantQuery.mockImplementation((_o: string, _t: string, opts: Record<string, unknown>) => {
      llamadas.push(opts._filter as Record<string, unknown>);
      return Promise.resolve([]);
    });
    await statements("org", "2026-07", "2026-09");

    // Lo que la empresa TIENE no empieza el 1 de julio.
    expect(llamadas).toContainEqual({ period: { gte: "2026-07", lte: "2026-09" } });
    expect(llamadas).toContainEqual({ period: { lte: "2026-09" } });
  });
});

describe("cerrar y reabrir un periodo", () => {
  const sinPeriodos = () => {
    tenantQuery.mockResolvedValue([]);
    trialBalance.mockResolvedValue({ totals: { debit: 500, credit: 500 }, rows: [], balanced: true });
  };

  it("cerrar guarda el retrato de las cifras del momento", async () => {
    sinPeriodos();
    const r = await movePeriod("org", "u1", "2026-08", "close");
    expect(r.status).toBe("closed");
    const creado = tenantCreate.mock.calls[0][2];
    expect(creado.total_debit).toBe(500);
    expect(creado.total_credit).toBe(500);
    expect(creado.closed_by).toBe("u1");
  });

  it("un periodo declarado no se reabre", async () => {
    tenantQuery.mockResolvedValue([{ _id: "p1", period: "2026-07", status: "locked" }]);
    await expect(movePeriod("org", "u1", "2026-07", "reopen")).rejects.toThrow(/rectificativa/);
    expect(tenantUpdate).not.toHaveBeenCalled();
  });

  it("no se marca como declarado sin cerrarlo antes", async () => {
    tenantQuery.mockResolvedValue([{ _id: "p1", period: "2026-08", status: "open" }]);
    await expect(movePeriod("org", "u1", "2026-08", "lock")).rejects.toThrow(/Ciérralo antes/);
  });

  it("un periodo con forma inválida se rechaza antes de tocar nada", async () => {
    await expect(movePeriod("org", "u1", "2026-13", "close")).rejects.toThrow(/AAAA-MM/);
    expect(tenantQuery).not.toHaveBeenCalled();
  });

  it("reabrir deja constancia de quién lo hizo", async () => {
    tenantQuery.mockResolvedValue([{ _id: "p1", period: "2026-08", status: "closed" }]);
    await movePeriod("org", "u1", "2026-08", "reopen");
    expect(tenantUpdate.mock.calls[0][3]).toMatchObject({ status: "open", reopened_by: "u1" });
  });
});

describe("cerrar el ejercicio", () => {
  const armar = (yaCerrado: unknown[], saldos: unknown[]) => {
    tenantQuery.mockImplementation((_o: string, _t: string, opts: { _filter?: Record<string, unknown> }) => {
      if (opts?._filter?.is_closing === true) return Promise.resolve(yaCerrado);
      if (opts?._filter?.entry_code) return Promise.resolve([{ _id: "l1" }, { _id: "l2" }]);
      return Promise.resolve(saldos);
    });
    post.mockResolvedValue({ entryCode: "AS-202612-ABCDE", lines: ["l1", "l2"], total: 70_000 });
  };

  const SALDOS = [
    asiento("4101", "revenue", 0, 300_000),
    asiento("5101", "expense", 230_000, 0),
  ];

  it("contabiliza el asiento con fecha del último día del año", async () => {
    armar([], SALDOS);
    await closeYear("org", "u1", "2026");
    expect(post.mock.calls[0][1].postedAt).toBe("2026-12-31T23:59:59.000Z");
  });

  it("marca las líneas DESPUÉS de que el asiento exista", async () => {
    armar([], SALDOS);
    const orden: string[] = [];
    post.mockImplementation(() => { orden.push("asiento"); return Promise.resolve({ entryCode: "AS-1", lines: [], total: 1 }); });
    tenantUpdate.mockImplementation(() => { orden.push("marca"); return Promise.resolve({}); });
    await closeYear("org", "u1", "2026");
    expect(orden[0]).toBe("asiento");
    expect(orden).toContain("marca");
  });

  it("no se cierra dos veces: duplicaría el resultado en acumulados", async () => {
    armar([{ _id: "ya" }], SALDOS);
    await expect(closeYear("org", "u1", "2026")).rejects.toThrow(/ya está cerrado/);
    expect(post).not.toHaveBeenCalled();
  });

  it("un ejercicio sin movimientos no genera un asiento vacío", async () => {
    armar([], [asiento("1101", "asset", 100, 0)]);
    await expect(closeYear("org", "u1", "2026")).rejects.toThrow(/no tiene movimientos/);
    expect(post).not.toHaveBeenCalled();
  });

  it("un año con forma inválida se rechaza antes de tocar nada", async () => {
    await expect(closeYear("org", "u1", "veintiséis")).rejects.toThrow(/AAAA/);
    expect(tenantQuery).not.toHaveBeenCalled();
  });
});
