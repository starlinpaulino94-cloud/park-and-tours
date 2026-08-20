import { describe, it, expect } from "vitest";
import {
  newOrderNumber, newBookingNumber, newVoucherCode,
  newSettlementCode, newPaymentReference, newDocumentNumber,
} from "@/lib/codes";

// Ambiguous characters must never appear in human-facing codes.
const AMBIGUOUS = /[IO01]/;

describe("codes — document code generators (AUD-B05/D01)", () => {
  it("order/booking numbers follow PREFIX-YYMM-XXXXXXX", () => {
    expect(newOrderNumber()).toMatch(/^ORD-\d{4}-[A-Z2-9]{7}$/);
    expect(newBookingNumber()).toMatch(/^RSV-\d{4}-[A-Z2-9]{7}$/);
  });

  it("voucher code has two crypto segments and no ambiguous chars", () => {
    const v = newVoucherCode();
    expect(v).toMatch(/^VCH-[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(AMBIGUOUS.test(v.replace(/^VCH-/, ""))).toBe(false);
  });

  it("settlement/payment/document codes are well-formed", () => {
    expect(newSettlementCode()).toMatch(/^LIQ-\d{4}-[A-Z2-9]{6}$/);
    expect(newPaymentReference()).toMatch(/^PAY-\d{4}-[A-Z2-9]{7}$/);
    expect(newDocumentNumber("CXC")).toMatch(/^CXC-\d{4}-[A-Z2-9]{7}$/);
  });

  it("random parts do not collide across many generations (birthday check)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(newVoucherCode());
    // 31^10 space → 5000 draws should never collide.
    expect(seen.size).toBe(5000);
  });
});
