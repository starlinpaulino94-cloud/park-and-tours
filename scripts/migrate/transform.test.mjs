import { describe, it, expect } from "vitest";
import {
  toUuid, ynToBool, parseJsonMaybe, refId, transformRecord,
  transformPartnerOrganization, transformPartnerRelationship, TABLE_SPECS,
} from "./transform.mjs";

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
      booking_number: "RSV-1", created_by: "user-1", capacity_override: "yes",
      price_snapshot: '{"unit_price":100}', createdAt: "2024-01-01",
    });
    expect(row.id).toBe(toUuid("bk1"));
    expect(row.organization_id).toBe(toUuid("co1"));
    expect(row.order_id).toBe(toUuid("or1"));
    expect(row.customer_id).toBe(toUuid("cu1"));      // expanded ref
    expect(row.booking_number).toBe("RSV-1");
    expect(row.capacity_override).toBe(true);
    expect(row.price_snapshot).toEqual({ unit_price: 100 });
    expect(row.created_by).toBeNull(); // demo users are not migrated to auth.users
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

describe("ETL transform — partner organizations", () => {
  const partner = {
    _id: "partner-1", company: "company-1", parent_partner: { _id: "parent-1" },
    name: "Partner One", partner_type: "reseller", default_commission_pct: 12.5,
    credit_limit: 1000, credit_days: 30, contract_from: "2026-01-01", contract_to: "2026-12-31",
  };

  it("maps partner to a tenant-scoped organization", () => {
    expect(transformPartnerOrganization(partner)).toMatchObject({
      id: toUuid("partner-1"), kind: "partner", tenant_org_id: toUuid("company-1"),
      parent_org_id: toUuid("parent-1"), name: "Partner One",
    });
  });

  it("maps commercial terms with a deterministic relationship id", () => {
    const row = transformPartnerRelationship(partner);
    expect(row).toMatchObject({
      from_org_id: toUuid("company-1"), to_org_id: toUuid("partner-1"),
      relationship_type: "reseller", default_commission_pct: 12.5, credit_days: 30,
    });
    expect(row.id).toBe(transformPartnerRelationship(partner).id);
  });
});

describe("ETL transform — payment methods", () => {
  const spec = TABLE_SPECS.find((s) => s.source === "payment");

  it("maps Totalum payment methods to the Supabase enum", () => {
    const row = transformRecord(spec, {
      _id: "pay-1", company: "company-1", method: "b2b_credit",
    });
    expect(row.method).toBe("credit");
    expect(transformRecord(spec, { method: "payment_link" }).method).toBe("link");
  });
});

describe("ETL transform — lead sources", () => {
  const spec = TABLE_SPECS.find((s) => s.source === "lead");

  it("maps Totalum lead sources to allowed Supabase values", () => {
    expect(transformRecord(spec, { source: "instagram" }).source).toBe("social");
    expect(transformRecord(spec, { source: "ota" }).source).toBe("agency");
    expect(transformRecord(spec, { source: "direct" }).source).toBe("web");
  });
});

describe("ETL transform — partner mapping (registro real de Totalum)", () => {
  it("maps a real Totalum partner record (name/legal split, type, metadata)", () => {
    const real = {
      _id: "6a85d36da48e69b89d475aa8", name: "Caribe Tour Center SRL",
      commercial_name: "Caribe Tour Center", partner_type: "tour_center",
      tax_id: "RNC-285121580", contact_name: "Departamento comercial",
      email: "reservas@caribetourcenter.com", city: "Bávaro",
      country: "República Dominicana", currency: "usd",
      default_commission_pct: 18, credit_limit: 15000, credit_days: 15,
      balance: 0, commercial_terms: "Comisión 18% · crédito 15 días.",
      status: "active", notes: "Partner de demostración.",
      company: "6a85d36aa48e69b89d475a96", createdBy: "6a85c404ba68f6c97e410af0",
    };
    const org = transformPartnerOrganization(real);
    expect(org.name).toBe("Caribe Tour Center");          // commercial_name
    expect(org.legal_name).toBe("Caribe Tour Center SRL"); // name
    expect(org.country).toBe("República Dominicana");
    expect(org.metadata).toEqual({
      contact_name: "Departamento comercial", city: "Bávaro",
      commercial_terms: "Comisión 18% · crédito 15 días.",
      notes: "Partner de demostración.", legacy_balance: 0,
      legacy_created_by: "6a85c404ba68f6c97e410af0",
    });
    const rel = transformPartnerRelationship(real);
    expect(rel.relationship_type).toBe("tour_center");     // partner_type passes the enum
    expect(rel.default_commission_pct).toBe(18);
    expect(rel.credit_days).toBe(15);
  });

  it("clamps an unknown relationship_type to 'agency'", () => {
    expect(transformPartnerRelationship({ _id: "p", company: "c", relationship_type: "bogus" })
      .relationship_type).toBe("agency");
  });

  it("returns null when the partner has no owning company (no FK anchor)", () => {
    expect(transformPartnerRelationship({ _id: "p" })).toBeNull();
  });
});

describe("ETL transform — spec coverage", () => {
  it("covers all 80 business tables with unique targets", () => {
    expect(TABLE_SPECS.length).toBe(80);
    const targets = new Set(TABLE_SPECS.map((s) => s.target));
    expect(targets.size).toBe(80); // no duplicates
  });
});
