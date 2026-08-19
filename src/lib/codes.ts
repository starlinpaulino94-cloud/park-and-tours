/** Human-friendly document code generators. */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars

function randomPart(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

function yymm(date = new Date()): string {
  return `${String(date.getFullYear()).slice(2)}${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export const newOrderNumber = () => `ORD-${yymm()}-${randomPart(5)}`;
export const newBookingNumber = () => `RSV-${yymm()}-${randomPart(5)}`;
export const newVoucherCode = () => `VCH-${randomPart(4)}-${randomPart(4)}`;
export const newSettlementCode = () => `LIQ-${yymm()}-${randomPart(4)}`;
export const newPaymentReference = () => `PAY-${yymm()}-${randomPart(5)}`;
export const newCashSessionCode = () => `CJA-${yymm()}-${randomPart(4)}`;
export const newDocumentNumber = (prefix: string) => `${prefix}-${yymm()}-${randomPart(5)}`;
