/** Human-friendly document code generators. */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars

/**
 * AUD-B05: use a cryptographically secure RNG instead of `Math.random()`.
 * Voucher codes are the only secret a ticket carries; `Math.random()` (V8
 * xorshift128+) is predictable from observed outputs. `crypto.getRandomValues`
 * is available in the Cloudflare Workers / Edge runtime and modern Node.
 * Rejection sampling avoids the modulo bias of `% ALPHABET.length`.
 */
function randomPart(length: number): string {
  const max = 256 - (256 % ALPHABET.length); // largest byte that keeps a uniform mapping
  let out = "";
  while (out.length < length) {
    const bytes = new Uint8Array(length - out.length);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b >= max) continue; // discard to avoid modulo bias
      out += ALPHABET[b % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

function yymm(date = new Date()): string {
  return `${String(date.getFullYear()).slice(2)}${String(date.getMonth() + 1).padStart(2, "0")}`;
}

// Wider random parts (7-8 chars) reduce the collision probability given there
// are no unique constraints in the database (AUD-D01).
export const newOrderNumber = () => `ORD-${yymm()}-${randomPart(7)}`;
export const newBookingNumber = () => `RSV-${yymm()}-${randomPart(7)}`;
export const newVoucherCode = () => `VCH-${randomPart(5)}-${randomPart(5)}`;
export const newSettlementCode = () => `LIQ-${yymm()}-${randomPart(6)}`;
export const newPaymentReference = () => `PAY-${yymm()}-${randomPart(7)}`;
export const newCashSessionCode = () => `CJA-${yymm()}-${randomPart(6)}`;
export const newDocumentNumber = (prefix: string) => `${prefix}-${yymm()}-${randomPart(7)}`;
