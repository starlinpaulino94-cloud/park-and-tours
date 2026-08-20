import { describe, it, expect } from "vitest";
import { formatMoney, formatPercent, formatNumber, parseJson } from "@/lib/format";

describe("format — money/percent/number", () => {
  it("formats money with the currency symbol", () => {
    expect(formatMoney(1234.5, "usd")).toContain("1,234.5");
    expect(formatMoney(0, "usd")).toContain("0");
  });

  it("handles null/undefined as zero", () => {
    expect(formatMoney(null)).toBeTruthy();
    expect(formatMoney(undefined)).toBeTruthy();
  });

  it("formats percentages", () => {
    expect(formatPercent(12.34)).toBe("12.3%");
    expect(formatPercent(0)).toBe("0.0%");
  });

  it("formats plain numbers with grouping", () => {
    expect(formatNumber(1000000)).toBe("1,000,000");
  });
});

describe("format — parseJson", () => {
  it("parses valid JSON strings", () => {
    expect(parseJson('[{"a":1}]', [])).toEqual([{ a: 1 }]);
  });

  it("returns the fallback for invalid/empty input", () => {
    expect(parseJson("not json", { ok: true })).toEqual({ ok: true });
    expect(parseJson(null, [])).toEqual([]);
    expect(parseJson(undefined, 42)).toBe(42);
  });

  it("passes through already-parsed objects", () => {
    const obj = [{ hours_before: 48, refund_pct: 100 }];
    expect(parseJson(obj, [])).toEqual(obj);
  });
});
