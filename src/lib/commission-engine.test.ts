import { describe, it, expect } from "vitest";

import { computeAmount, specificityOf, pickRule } from "@/lib/commission-engine";
import type { CommissionRule } from "@/lib/types";

const rule = (r: Partial<CommissionRule>): CommissionRule =>
  ({ _id: "r", name: "r", status: "active", ...r } as CommissionRule);

const baseInput = { companyId: "c", baseAmount: 100, currency: "usd" as const };

describe("commission-engine — computeAmount", () => {
  it("percentage: 10% of 100 = 10", () => {
    expect(computeAmount(rule({ calc_type: "percentage", value: 10 }), baseInput))
      .toEqual({ amount: 10, percentage: 10 });
  });

  it("fixed: 25 flat, derives the effective %", () => {
    expect(computeAmount(rule({ calc_type: "fixed", value: 25 }), baseInput))
      .toEqual({ amount: 25, percentage: 25 });
  });

  it("tiered: picks the tier containing the base amount", () => {
    const tiers = JSON.stringify([
      { from: 0, to: 100, value: 5 },
      { from: 100, to: null, value: 10 },
    ]);
    // base 150 → tier [100,∞) → 10% → 15
    expect(computeAmount(rule({ calc_type: "tiered", tiers }), { ...baseInput, baseAmount: 150 }))
      .toEqual({ amount: 15, percentage: 10 });
  });

  it("volume: yardstick is periodSales, not the sale amount", () => {
    const tiers = JSON.stringify([
      { from: 0, to: 1000, value: 4 },
      { from: 1000, to: null, value: 8 },
    ]);
    // periodSales 5000 → 8% tier applied on the sale base (100) → 8
    expect(computeAmount(rule({ calc_type: "volume", tiers }), { ...baseInput, periodSales: 5000 }))
      .toEqual({ amount: 8, percentage: 8 });
  });
});

describe("commission-engine — specificityOf (lower = more specific)", () => {
  it("seller+product is most specific (1)", () => {
    expect(specificityOf(rule({ seller: "s", product: "p" }))).toBe(1);
  });
  it("company default is least specific (8)", () => {
    expect(specificityOf(rule({}))).toBe(8);
  });
  it("channel-only ranks 7", () => {
    expect(specificityOf(rule({ channel: "web" }))).toBe(7);
  });
});

describe("commission-engine — pickRule", () => {
  it("chooses the most specific applicable rule for the beneficiary", () => {
    const rules = [
      rule({ _id: "generic", beneficiary_type: "seller", product: "p", value: 5 }),
      rule({ _id: "specific", beneficiary_type: "seller", product: "p", seller: "s1", value: 12 }),
    ];
    const picked = pickRule(rules, { ...baseInput, productId: "p", sellerId: "s1" }, "seller");
    expect(picked?._id).toBe("specific");
  });

  it("honours an explicit priority override", () => {
    const rules = [
      rule({ _id: "a", beneficiary_type: "seller", product: "p", seller: "s1", priority: 50, value: 12 }),
      rule({ _id: "b", beneficiary_type: "seller", product: "p", priority: 1, value: 5 }),
    ];
    const picked = pickRule(rules, { ...baseInput, productId: "p", sellerId: "s1" }, "seller");
    expect(picked?._id).toBe("b"); // lower priority number wins
  });

  it("returns null when no rule matches the beneficiary type", () => {
    const rules = [rule({ beneficiary_type: "partner", value: 15 })];
    expect(pickRule(rules, baseInput, "seller")).toBeNull();
  });
});
