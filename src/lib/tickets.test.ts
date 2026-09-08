import { describe, it, expect } from "vitest";
import {
  applyRedemption, redeemBlocker, remainingEntries,
  BLOCK_MESSAGE, FORCEABLE_BLOCKS, CLOSED_TICKET_STATUSES,
} from "@/lib/tickets";

const NOW = new Date("2026-06-15T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const ahead = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString();

describe("tickets — entradas restantes", () => {
  it("sin tope son ilimitadas", () => {
    expect(remainingEntries({ entries_allowed: null, entries_used: 7 })).toBeNull();
  });

  it("con tope descuenta lo usado", () => {
    expect(remainingEntries({ entries_allowed: 5, entries_used: 2 })).toBe(3);
  });

  it("nunca baja de cero aunque el contador esté por encima del tope", () => {
    expect(remainingEntries({ entries_allowed: 3, entries_used: 9 })).toBe(0);
  });
});

describe("tickets — qué bloquea una validación", () => {
  it("un pase vigente con entradas no bloquea", () => {
    expect(redeemBlocker(
      { status: "active", valid_from: ago(1), valid_to: ahead(1), entries_allowed: 2, entries_used: 0 }, NOW
    )).toBeNull();
  });

  it("un pase sin tope ni vigencia tampoco", () => {
    expect(redeemBlocker({ status: "issued" }, NOW)).toBeNull();
  });

  it.each([...CLOSED_TICKET_STATUSES])("%s está cerrado", (status) => {
    expect(redeemBlocker({ status }, NOW)).toBe("closed");
  });

  it("el estado cerrado manda sobre el vencimiento, para que el mensaje no mienta", () => {
    // Un pase anulado Y vencido se rechaza como anulado: "está vencido" llevaría
    // al cajero a pedir una excepción de fecha que no arreglaría nada.
    expect(redeemBlocker({ status: "void", valid_to: ago(10) }, NOW)).toBe("closed");
  });

  it("sin entradas restantes está agotado", () => {
    expect(redeemBlocker({ status: "partially_used", entries_allowed: 2, entries_used: 2 }, NOW)).toBe("exhausted");
  });

  it("antes de su vigencia todavía no vale", () => {
    expect(redeemBlocker({ status: "issued", valid_from: ahead(2) }, NOW)).toBe("not_yet_valid");
  });

  it("después de su vigencia está vencido", () => {
    expect(redeemBlocker({ status: "issued", valid_to: ago(2) }, NOW)).toBe("expired");
  });

  it("el agotamiento pesa más que la vigencia futura", () => {
    expect(redeemBlocker(
      { status: "issued", valid_from: ahead(2), entries_allowed: 1, entries_used: 1 }, NOW
    )).toBe("exhausted");
  });

  it("solo el vencimiento se puede forzar", () => {
    expect([...FORCEABLE_BLOCKS]).toEqual(["expired"]);
    for (const block of ["closed", "exhausted", "not_yet_valid"] as const) {
      expect(FORCEABLE_BLOCKS.has(block)).toBe(false);
    }
  });

  it("cada bloqueo tiene un mensaje para el cajero", () => {
    for (const block of ["closed", "exhausted", "not_yet_valid", "expired"] as const) {
      expect(BLOCK_MESSAGE[block]).toBeTruthy();
    }
  });
});

describe("tickets — efecto de una validación", () => {
  it("un pase con tope queda parcialmente usado mientras le sobren entradas", () => {
    const r = applyRedemption({ status: "issued", entries_allowed: 3, entries_used: 0 }, NOW);
    expect(r).toEqual({ entries_used: 1, status: "partially_used", redeemed_at: null, remaining: 2 });
  });

  it("al consumir la última entrada queda redimido y con fecha", () => {
    const r = applyRedemption({ status: "partially_used", entries_allowed: 3, entries_used: 2 }, NOW);
    expect(r.status).toBe("redeemed");
    expect(r.remaining).toBe(0);
    expect(r.redeemed_at).toBe(NOW.toISOString());
  });

  it("un pase de una sola entrada se redime en el primer uso", () => {
    expect(applyRedemption({ status: "issued", entries_allowed: 1 }, NOW)).toEqual({
      entries_used: 1, status: "redeemed", redeemed_at: NOW.toISOString(), remaining: 0,
    });
  });

  it("un pase sin tope queda activo y nunca se agota", () => {
    // Un pase de temporada se usa muchas veces: marcarlo 'redeemed' en la
    // primera entrada lo cerraría para el resto de la temporada.
    let ticket = { status: "issued", entries_allowed: null, entries_used: 0 };
    for (let i = 1; i <= 4; i++) {
      const r = applyRedemption(ticket, NOW);
      expect(r.status).toBe("active");
      expect(r.redeemed_at).toBeNull();
      expect(r.remaining).toBeNull();
      expect(r.entries_used).toBe(i);
      ticket = { ...ticket, status: r.status, entries_used: r.entries_used };
    }
    expect(redeemBlocker(ticket, NOW)).toBeNull();
  });

  it("el resultado de una validación deja el pase listo para la siguiente", () => {
    const first = applyRedemption({ status: "issued", entries_allowed: 2 }, NOW);
    const second = applyRedemption({ status: first.status, entries_allowed: 2, entries_used: first.entries_used }, NOW);
    expect(second.status).toBe("redeemed");
    expect(redeemBlocker({ status: second.status, entries_allowed: 2, entries_used: second.entries_used }, NOW))
      .toBe("closed");
  });
});
