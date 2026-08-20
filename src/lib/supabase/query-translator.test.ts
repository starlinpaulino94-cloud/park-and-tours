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
    not: (c, o, v) => (calls.push(["not", c, o, v]), b),
    or: (f) => (calls.push(["or", f]), b),
    order: (c, o) => (calls.push(["order", c, o]), b),
    range: (f, t) => (calls.push(["range", f, t]), b),
  };
  return { b, calls };
}

describe("query-translator — field aliases", () => {
  it("maps Totalum names to the Postgres schema", () => {
    expect(aliasField("_id")).toBe("id");
    expect(aliasField("company")).toBe("organization_id");
    expect(aliasField("partner")).toBe("partner_id");
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
