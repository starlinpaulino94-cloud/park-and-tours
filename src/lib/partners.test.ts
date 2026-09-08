import { describe, it, expect } from "vitest";
import {
  splitPartnerInput, mergePartnerRow, resolveRelationshipType,
  PARTNER_RELATIONSHIP_COLUMNS,
} from "@/lib/partners";

describe("partners — reparto del formulario", () => {
  it("las condiciones comerciales van a la relación, no a metadata", () => {
    const s = splitPartnerInput({
      credit_limit: 25000, credit_days: 30, default_commission_pct: 12.5,
      contract_from: "2026-01-01", contract_to: "2026-12-31", partner_type: "agency",
    });
    expect(s.relationship).toEqual({
      credit_limit: 25000, credit_days: 30, default_commission_pct: 12.5,
      contract_from: "2026-01-01", contract_to: "2026-12-31", relationship_type: "agency",
    });
    // Antes se borraban del payload sin guardarse: el límite volvía en cero.
    expect(s.org.credit_limit).toBeUndefined();
    expect(s.metadata.credit_limit).toBeUndefined();
  });

  it("las columnas reales de organizations van tal cual", () => {
    const s = splitPartnerInput({ name: "Caribe Tours", tax_id: "131-0", email: "a@b.do", status: "active" });
    expect(s.org).toEqual({ name: "Caribe Tours", tax_id: "131-0", email: "a@b.do", status: "active" });
    expect(s.metadata).toEqual({});
  });

  it("lo que no es columna cae en metadata, nunca hacia una columna inexistente", () => {
    // `logo_url` viajaba como columna de organizations y hacía fallar el alta
    // entera, porque PostgREST rechaza el INSERT completo.
    const s = splitPartnerInput({ logo_url: "https://x/l.png", commercial_name: "Caribe", city: "Bávaro" });
    expect(s.org).toEqual({});
    expect(s.metadata).toEqual({ logo_url: "https://x/l.png", commercial_name: "Caribe", city: "Bávaro" });
  });

  it("el tipo de partner se guarda en la relación y se copia a metadata", () => {
    const s = splitPartnerInput({ partner_type: "hotel" });
    expect(s.relationship.relationship_type).toBe("hotel");
    // La copia mantiene legibles los partners creados antes de usar la tabla.
    expect(s.metadata.partner_type).toBe("hotel");
  });

  it("una subagencia se cuelga de su matriz, venga como id o como referencia", () => {
    expect(splitPartnerInput({ parent_partner: "abc" }).parentPartnerId).toBe("abc");
    expect(splitPartnerInput({ parent_partner: { _id: "xyz" } }).parentPartnerId).toBe("xyz");
    expect(splitPartnerInput({}).parentPartnerId).toBeUndefined();
  });

  it("una edición parcial no arrastra lo que no tocó", () => {
    const s = splitPartnerInput({ credit_limit: 500, commercial_name: undefined });
    expect(s.relationship).toEqual({ credit_limit: 500 });
    expect(s.metadata).toEqual({});
    expect("commercial_name" in s.metadata).toBe(false);
  });

  it("null sí pasa: es como se borra un dato a propósito", () => {
    expect(splitPartnerInput({ credit_limit: null }).relationship).toEqual({ credit_limit: null });
  });

  it("el saldo y el catálogo autorizado no se guardan", () => {
    // El saldo se deriva de las cuentas por cobrar; guardarlo sería una segunda
    // verdad que se desincroniza sola.
    const s = splitPartnerInput({ balance: 900, authorized_products: ["p1"], credit_limit: 10 });
    expect(s.org).toEqual({});
    expect(s.metadata).toEqual({});
    expect(s.relationship).toEqual({ credit_limit: 10 });
  });
});

describe("partners — tipo de relación heredado", () => {
  it("manda lo que trae el formulario", () => {
    expect(resolveRelationshipType("ota", { relationship_type: "agency" }, { partner_type: "hotel" })).toBe("ota");
  });

  it("si no viene, hereda la relación existente", () => {
    // `relationship_type` es obligatorio: editar solo el crédito no puede
    // quedarse sin tipo y reventar el guardado.
    expect(resolveRelationshipType(undefined, { relationship_type: "agency" }, {})).toBe("agency");
  });

  it("y si tampoco hay relación, lo saca de metadata", () => {
    expect(resolveRelationshipType(undefined, undefined, { partner_type: "tour_center" })).toBe("tour_center");
  });

  it("como último recurso, un valor que la base admite", () => {
    expect(resolveRelationshipType(undefined, undefined, {})).toBe("agency");
  });
});

describe("partners — vista reconstruida", () => {
  const org = {
    id: "p1", name: "Caribe Tours", legal_name: "Caribe SRL", tenant_org_id: "t1", parent_org_id: "t1",
    currency: "usd", status: "active",
    metadata: { commercial_name: "Caribe", contact_name: "Ana", city: "Bávaro", partner_type: "agency" },
  };

  it("expone las condiciones comerciales de la relación", () => {
    const row = mergePartnerRow(org, {
      relationship_type: "hotel", credit_limit: 25000, credit_days: 30,
      default_commission_pct: 12.5, contract_from: "2026-01-01", contract_to: "2026-12-31",
    });
    expect(row.credit_limit).toBe(25000);
    expect(row.credit_days).toBe(30);
    expect(row.default_commission_pct).toBe(12.5);
    // La columna tipada manda sobre el respaldo de metadata.
    expect(row.partner_type).toBe("hotel");
  });

  it("un partner sin relación devuelve las condiciones vacías, no ausentes", () => {
    const row = mergePartnerRow(org, null);
    for (const field of Object.keys(PARTNER_RELATIONSHIP_COLUMNS)) {
      if (field === "partner_type") continue;
      expect(row[field], `${field} debería venir en null`).toBeNull();
    }
    // Y el tipo sigue leyéndose de metadata para las filas antiguas.
    expect(row.partner_type).toBe("agency");
  });

  it("sigue exponiendo lo que vive en metadata", () => {
    const row = mergePartnerRow(org, null);
    expect(row.commercial_name).toBe("Caribe");
    expect(row.contact_name).toBe("Ana");
    expect(row.city).toBe("Bávaro");
    expect(row.company).toBe("t1");
  });

  it("solo hay partner matriz si el padre no es el propio inquilino", () => {
    expect(mergePartnerRow(org, null).parent_partner).toBeNull();
    expect(mergePartnerRow({ ...org, parent_org_id: "p0" }, null).parent_partner).toBe("p0");
  });
});
