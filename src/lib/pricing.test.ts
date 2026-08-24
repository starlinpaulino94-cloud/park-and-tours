import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/tenant", () => ({ tenantQuery: vi.fn() }));

import { billablePax, resolvePrice } from "@/lib/pricing";
import { tenantQuery } from "@/lib/tenant";
import type { PriceRule, Product } from "@/lib/types";

const q = tenantQuery as unknown as ReturnType<typeof vi.fn>;

/** Wires the three queries resolvePrice issues (product / modality / price_rule). */
function mockCatalog(opts: { product?: Partial<Product>; rules?: Partial<PriceRule>[] }) {
  const product = { _id: "p", name: "Tour", base_price: 100, currency: "usd", ...opts.product };
  q.mockImplementation((_companyId: string, table: string) => {
    if (table === "product") return [product];
    if (table === "product_modality") return [];
    if (table === "price_rule") return opts.rules ?? [];
    return [];
  });
}

const input = (over: Record<string, unknown> = {}) => ({
  companyId: "c", productId: "p", quantity: 2, ...over,
}) as any;

describe("pricing — billablePax (infants free, min 1)", () => {
  it("counts adults + children", () => expect(billablePax(2, 1)).toBe(3));
  it("never bills fewer than 1", () => expect(billablePax(0, 0)).toBe(1));
});

describe("pricing — resolvePrice", () => {
  beforeEach(() => q.mockReset());

  it("uses the product base price when no rule applies", async () => {
    mockCatalog({});
    const r = await resolvePrice(input());
    expect(r.unitPrice).toBe(100);
    expect(r.grossAmount).toBe(200); // 100 * 2
    expect(r.totalAmount).toBe(200);
  });

  it("clamps a discount above 100% (AUD-F02) — never negative total", async () => {
    mockCatalog({});
    const r = await resolvePrice(input({ discountPct: 150 }));
    expect(r.discountAmount).toBe(200); // clamped to 100% of gross
    expect(r.totalAmount).toBe(0);
    expect(r.totalAmount).toBeGreaterThanOrEqual(0);
  });

  it("clamps a negative discount to 0", async () => {
    mockCatalog({});
    const r = await resolvePrice(input({ discountPct: -20 }));
    expect(r.discountAmount).toBe(0);
    expect(r.totalAmount).toBe(200);
  });

  it("applies tax on the net amount", async () => {
    mockCatalog({});
    const r = await resolvePrice(input({ discountPct: 0, taxPct: 18 }));
    expect(r.taxAmount).toBe(36); // 18% of 200
    expect(r.totalAmount).toBe(236);
  });

  it("group pricing does not multiply by quantity", async () => {
    mockCatalog({ rules: [{ _id: "g", status: "active", product: "p", price_type: "per_group", amount: 500 }] });
    const r = await resolvePrice(input({ quantity: 4 }));
    expect(r.grossAmount).toBe(500);
  });

  it("prefers the more specific rule (seller over generic product rule)", async () => {
    mockCatalog({
      rules: [
        { _id: "generic", status: "active", product: "p", amount: 90 },
        { _id: "seller", status: "active", product: "p", seller: "s1", amount: 70 },
      ],
    });
    const r = await resolvePrice(input({ sellerId: "s1" }));
    expect(r.appliedRule?._id).toBe("seller");
    expect(r.unitPrice).toBe(70);
  });

  it("ignores a rule outside its season, falling back to base (AUD-F01)", async () => {
    mockCatalog({
      rules: [{ _id: "hi", status: "active", product: "p", amount: 130, season_from: "2999-12-01" }],
    });
    const r = await resolvePrice(input({ travelDate: "2026-06-01" }));
    expect(r.appliedRule).toBeNull();
    expect(r.unitPrice).toBe(100); // base, not the out-of-season 130
  });
});
