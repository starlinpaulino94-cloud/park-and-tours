import { describe, it, expect } from "vitest";
import { applyFilter, applyQuery, aliasField, type PostgrestLike } from "./query-translator";

/** Records every builder call so we can assert the translation. */
function fakeBuilder() {
  const calls: Array<[string, ...unknown[]]> = [];
  const b: PostgrestLike = {
    eq: (c, v) => (calls.push(["eq", c, v]), b),
    neq: (c, v) => (calls.push(["neq", c, v]), b),
    gt: (c, v) => (calls.push(["gt", c, v]), b),
    gte: (c, v) => (calls.push(["gte", c, v]), b),
    lt: (c, v) => (calls.push(["lt", c, v]), b),
    lte: (c, v) => (calls.push(["lte", c, v]), b),
    in: (c, v) => (calls.push(["in", c, v]), b),
    ilike: (c, v) => (calls.push(["ilike", c, v]), b),
    is: (c, v) => (calls.push(["is", c, v]), b),
    not: (c, o, v) => (calls.push(["not", c, o, v]), b),
    or: (f) => (calls.push(["or", f]), b),
    order: (c, o) => (calls.push(["order", c, o]), b),
    range: (f, t) => (calls.push(["range", f, t]), b),
  };
  return { b, calls };
}

describe("query-translator — field aliases", () => {
  it("maps legacy names to the Postgres schema", () => {
    expect(aliasField("_id")).toBe("id");
    expect(aliasField("company")).toBe("organization_id");
    expect(aliasField("partner")).toBe("partner_id");
    expect(aliasField("assigned_to")).toBe("assigned_to_id");
    expect(aliasField("second_approver")).toBe("second_approver_id");
    expect(aliasField("inventory_item")).toBe("inventory_item_id");
    expect(aliasField("ledger_account")).toBe("ledger_account_id");
    expect(aliasField("membership_plan")).toBe("membership_plan_id");
    expect(aliasField("pickup_hotel")).toBe("hotel_id");
    expect(aliasField("unknown_field")).toBe("unknown_field");
  });
});

describe("query-translator — applyFilter operators", () => {
  it("bare value → eq (with alias)", () => {
    const { b, calls } = fakeBuilder();
    applyFilter(b, { company: "org1", status: "active" });
    expect(calls).toContainEqual(["eq", "organization_id", "org1"]);
    expect(calls).toContainEqual(["eq", "status", "active"]);
  });

  it("comparison operators map 1:1 (incl. real gt/lt)", () => {
    const { b, calls } = fakeBuilder();
    applyFilter(b, { a: { ne: 1 }, b: { gte: 2 }, c: { lte: 3 }, d: { gt: 4 }, e: { lt: 5 } });
    expect(calls).toContainEqual(["neq", "a", 1]);
    expect(calls).toContainEqual(["gte", "b", 2]);
    expect(calls).toContainEqual(["lte", "c", 3]);
    expect(calls).toContainEqual(["gt", "d", 4]);
    expect(calls).toContainEqual(["lt", "e", 5]);
  });

  it("in / nin map to in and not-in", () => {
    const { b, calls } = fakeBuilder();
    applyFilter(b, { status: { in: ["a", "b"] }, kind: { nin: ["x", "y"] } });
    expect(calls).toContainEqual(["in", "status", ["a", "b"]]);
    expect(calls).toContainEqual(["not", "kind", "in", "(x,y)"]);
  });

  it("un valor con coma no parte la lista de nin", () => {
    const { b, calls } = fakeBuilder();
    applyFilter(b, { kind: { nin: ["Tours, S.A.", "plain"] } });
    expect(calls).toContainEqual(["not", "kind", "in", '("Tours, S.A.",plain)']);
  });

  it("regex → ilike contains-match", () => {
    const { b, calls } = fakeBuilder();
    applyFilter(b, { name: { regex: "punta" } });
    expect(calls).toContainEqual(["ilike", "name", "%punta%"]);
  });

  it("_or serialises sub-filters to PostgREST or() syntax", () => {
    const { b, calls } = fakeBuilder();
    applyFilter(b, { _or: [{ action: { regex: "pay" } }, { description: "exact" }] });
    const or = calls.find((c) => c[0] === "or");
    expect(or?.[1]).toBe("action.ilike.*pay*,description.eq.exact");
  });

  it("un valor null se traduce a IS NULL, no a eq.null", () => {
    const { b, calls } = fakeBuilder();
    applyFilter(b, { expires_at: null });
    expect(calls).toContainEqual(["is", "expires_at", null]);
    expect(calls.some((c) => c[0] === "eq")).toBe(false);
  });

  it("el operador is admite null y booleanos", () => {
    const { b, calls } = fakeBuilder();
    applyFilter(b, { approved_by: { is: null }, requires_two: { is: true } });
    expect(calls).toContainEqual(["is", "approved_by", null]);
    expect(calls).toContainEqual(["is", "requires_two", true]);
  });

  it("dentro de _or, null también es IS NULL", () => {
    const { b, calls } = fakeBuilder();
    applyFilter(b, { _or: [{ expires_at: null }, { requires_two: false }] });
    const or = calls.find((c) => c[0] === "or");
    expect(or?.[1]).toBe("expires_at.is.null,requires_two.eq.false");
  });

  it("entrecomilla las marcas de tiempo en _or para que PostgREST no las parta", () => {
    const { b, calls } = fakeBuilder();
    applyFilter(b, { _or: [{ expires_at: { gt: "2026-08-25T15:00:00.000Z" } }] });
    const or = calls.find((c) => c[0] === "or");
    expect(or?.[1]).toBe('expires_at.gt."2026-08-25T15:00:00.000Z"');
  });

  it("los identificadores simples siguen viajando sin comillas", () => {
    const { b, calls } = fakeBuilder();
    applyFilter(b, { _or: [{ requested_by: { ne: "3f2a-91bc_77" } }, { status: "pending" }] });
    const or = calls.find((c) => c[0] === "or");
    expect(or?.[1]).toBe("requested_by.neq.3f2a-91bc_77,status.eq.pending");
  });

  it("un valor con coma o paréntesis no rompe el grupo _or", () => {
    const { b, calls } = fakeBuilder();
    applyFilter(b, { _or: [{ name: "Tours, S.A. (RD)" }] });
    const or = calls.find((c) => c[0] === "or");
    expect(or?.[1]).toBe('name.eq."Tours, S.A. (RD)"');
  });

  it("un término de búsqueda con puntos ya no se corrompe con barras invertidas", () => {
    const { b, calls } = fakeBuilder();
    applyFilter(b, { _or: [{ name: { regex: "S.A." } }] });
    const or = calls.find((c) => c[0] === "or");
    // Antes producía `name.ilike.*S\.A\.*`, que buscaba las barras literalmente.
    expect(or?.[1]).toBe('name.ilike."*S.A.*"');
    expect(or?.[1]).not.toContain("\\.");
  });

  it("una búsqueda simple conserva los comodines sin comillas", () => {
    const { b, calls } = fakeBuilder();
    applyFilter(b, { _or: [{ name: { regex: "punta" } }] });
    const or = calls.find((c) => c[0] === "or");
    expect(or?.[1]).toBe("name.ilike.*punta*");
  });

  it("las comillas dentro de un valor se escapan", () => {
    const { b, calls } = fakeBuilder();
    applyFilter(b, { _or: [{ name: 'Hotel "Sol"' }] });
    const or = calls.find((c) => c[0] === "or");
    expect(or?.[1]).toBe('name.eq."Hotel \\"Sol\\""');
  });

  it("_and aplica cada subfiltro, encadenando varios grupos OR", () => {
    const { b, calls } = fakeBuilder();
    applyFilter(b, {
      status: "pending",
      _and: [
        { _or: [{ requested_by: null }, { requested_by: { ne: "me" } }] },
        { _or: [{ expires_at: null }, { expires_at: { gt: "2026-08-25T15:00:00.000Z" } }] },
      ],
    });
    expect(calls).toContainEqual(["eq", "status", "pending"]);
    const ors = calls.filter((c) => c[0] === "or");
    expect(ors).toHaveLength(2);
    expect(ors[0][1]).toBe("requested_by.is.null,requested_by.neq.me");
    expect(ors[1][1]).toBe('expires_at.is.null,expires_at.gt."2026-08-25T15:00:00.000Z"');
  });

  it("_and admite subfiltros simples además de grupos OR", () => {
    const { b, calls } = fakeBuilder();
    applyFilter(b, { _and: [{ company: "org1" }, { status: { in: ["a"] } }] });
    expect(calls).toContainEqual(["eq", "organization_id", "org1"]);
    expect(calls).toContainEqual(["in", "status", ["a"]]);
  });
});

describe("query-translator — applyQuery sort + pagination", () => {
  it("applies sort direction and range from limit/offset", () => {
    const { b, calls } = fakeBuilder();
    applyQuery(b, { _sort: { created_at: "desc" }, _limit: 10, _offset: 20 });
    expect(calls).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(calls).toContainEqual(["range", 20, 29]); // offset..offset+limit-1
  });

  it("defaults to limit 50 from offset 0", () => {
    const { b, calls } = fakeBuilder();
    applyQuery(b, {});
    expect(calls).toContainEqual(["range", 0, 49]);
  });
});
