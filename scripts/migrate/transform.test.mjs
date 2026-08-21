import { describe, it, expect } from "vitest";
import { toUuid, ynToBool, parseJsonMaybe, refId, transformRecord, TABLE_SPECS } from "./transform.mjs";

describe("ETL transform — toUuid (deterministic)", () => {
  it("produces a valid v5 uuid", () => {
    const u = toUuid("totalum_abc123");
    expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it("is stable across calls (FKs resolve without a lookup table)", () => {
    expect(toUuid("same-id")).toBe(toUuid("same-id"));
  });
  it("maps distinct ids to distinct uuids", () => {
    expect(toUuid("a")).not.toBe(toUuid("b"));
  });
  it("returns null for empty ids", () => {
    expect(toUuid(null)).toBeNull();
    expect(toUuid("")).toBeNull();
  });
});

describe("ETL transform — scalars", () => {
  it("ynToBool converts yes/no", () => {
    expect(ynToBool("yes")).toBe(true);
    expect(ynToBool("no")).toBe(false);
    expect(ynToBool(null)).toBeNull();
  });
  it("parseJsonMaybe parses strings and passes objects through", () => {
    expect(parseJsonMaybe('[{"a":1}]', [])).toEqual([{ a: 1 }]);
    expect(parseJsonMaybe({ a: 1 }, null)).toEqual({ a: 1 });
    expect(parseJsonMaybe("bad", "fb")).toBe("fb");
  });
  it("refId extracts from string or expanded object", () => {
    expect(refId("x1")).toBe("x1");
    expect(refId({ _id: "x2", name: "P" })).toBe("x2");
    expect(refId(null)).toBeNull();
  });
});

describe("ETL transform — transformRecord (booking)", () => {
  const spec = TABLE_SPECS.find((s) => s.source === "booking");
  it("maps _id→id, company→organization_id, refs→*_id (all uuids), YN→bool, json parsed", () => {
    const row = transformRecord(spec, {
      _id: "bk1", company: "co1", order: "or1", customer: { _id: "cu1" },
      booking_number: "RSV-1", capacity_override: "yes",
      price_snapshot: '{"unit_price":100}', createdAt: "2024-01-01",
    });
    expect(row.id).toBe(toUuid("bk1"));
    expect(row.organization_id).toBe(toUuid("co1"));
    expect(row.order_id).toBe(toUuid("or1"));
    expect(row.customer_id).toBe(toUuid("cu1"));      // expanded ref
    expect(row.booking_number).toBe("RSV-1");
    expect(row.capacity_override).toBe(true);
    expect(row.price_snapshot).toEqual({ unit_price: 100 });
    expect(row.createdAt).toBeUndefined();             // bookkeeping field dropped
  });

  it("uses the provided org uuid when given (single-tenant load)", () => {
    const row = transformRecord(spec, { _id: "bk1", company: "co1" }, "ORG-UUID");
    expect(row.organization_id).toBe("ORG-UUID");
  });

  it("drops pass-through fields with no matching column when allowedCols given", () => {
    const allowed = new Set(["id", "organization_id", "booking_number"]);
    const row = transformRecord(
      spec, { _id: "bk1", company: "co1", booking_number: "RSV-1", unknown_totalum_field: "x" },
      undefined, allowed);
    expect(row.booking_number).toBe("RSV-1");
    expect("unknown_totalum_field" in row).toBe(false); // dropped
  });
});

describe("ETL transform — spec coverage", () => {
  it("covers all 80 business tables with unique targets", () => {
    expect(TABLE_SPECS.length).toBe(80);
    const targets = new Set(TABLE_SPECS.map((s) => s.target));
    expect(targets.size).toBe(80); // no duplicates
  });
});
