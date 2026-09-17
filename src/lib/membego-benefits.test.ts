import { describe, it, expect } from "vitest";
import {
  MEMBEGO_ERROR_STATUS, isRetryable, needsFreshToken, REQUIRED_SCOPES,
  offerable, notOfferable, reasonMessage,
  evaluationIsStale, EVALUATION_TTL_SECONDS,
  discountFor, effectOf, defaultLine,
  redeemBlocker, REDEEM_BLOCK_MESSAGE,
  idempotencyKeyFor, serviceLabel,
  reversalBlocker, REVERSAL_BLOCK_MESSAGE, shouldRestoreLine,
  type EvaluatedBenefit, type EvaluateResult, type RedeemContext,
} from "@/lib/membego-benefits";

/**
 * Un beneficio mal aplicado se paga dos veces: una cuando se le regala al
 * cliente un descuento que no le tocaba, y otra cuando se le cobra a quien sí
 * tenía derecho. Lo que se prueba aquí son las formas concretas en que pasa: el
 * importe en centavos tratado como pesos, el porcentaje aplicado a la venta
 * entera en vez de a una línea, la pantalla que el cajero dejó abierta media
 * hora, y el doble clic que consume dos usos.
 */

const PROMO: EvaluatedBenefit = {
  type: "PROMOTION",
  id: "compra-1",
  nombre: "20 % en tu próxima excursión",
  eligible: true,
  usesLeft: 1,
  expiresAt: "2026-12-31T00:00:00.000Z",
  reason: null,
  coverage: null,
  effect: { kind: "PERCENT", value: 20, label: "-20%" },
};

const MEMBRESIA: EvaluatedBenefit = {
  type: "MEMBERSHIP",
  id: "mem-1",
  nombre: "Plan Oro",
  eligible: true,
  usesLeft: 3,
  expiresAt: "2026-12-31T00:00:00.000Z",
  reason: null,
  coverage: null,
};

const EVALUACION: EvaluateResult = {
  customerId: "cli-1",
  companyId: "emp-1",
  eligible: true,
  benefits: [
    PROMO,
    { ...MEMBRESIA, eligible: false, reason: "NO_USES_LEFT", usesLeft: 0 },
  ],
  evaluatedAt: "2026-09-17T12:00:00.000Z",
  reserved: false,
};

const LINEAS = [
  { id: "b1", label: "Saona", total: 170 },
  { id: "b2", label: "Catalina", total: 240 },
  { id: "b3", label: "Transfer", total: 0 },
];

const CONTEXTO: RedeemContext = {
  configured: true,
  linked: true,
  membegoClienteId: "cli-1",
  benefit: PROMO,
  evaluatedAt: "2026-09-17T12:00:00.000Z",
  lines: LINEAS,
  alreadyRedeemed: false,
  orderStatus: "pending_payment",
  now: new Date("2026-09-17T12:01:00.000Z"),
};

/* ────────────────────────────────────────────────── el contrato ── */

describe("el vocabulario del contrato de MembeGo", () => {
  it("cada código lleva el estado HTTP acordado", () => {
    // Ramificar leyendo el mensaje rompe el día que alguien corrija una tilde.
    expect(MEMBEGO_ERROR_STATUS.BENEFIT_NOT_ELIGIBLE).toBe(422);
    expect(MEMBEGO_ERROR_STATUS.REDEMPTION_CONFLICT).toBe(409);
    expect(MEMBEGO_ERROR_STATUS.IDEMPOTENCY_KEY_REQUIRED).toBe(400);
    expect(MEMBEGO_ERROR_STATUS.INSUFFICIENT_SCOPE).toBe(403);
    expect(MEMBEGO_ERROR_STATUS.RATE_LIMITED).toBe(429);
  });

  it("solo se reintenta lo que tiene sentido reintentar", () => {
    // Reintentar algo que el servidor rechazó por su contenido gasta cuota y
    // retrasa el error real.
    expect(isRetryable("RATE_LIMITED")).toBe(true);
    expect(isRetryable("INTERNAL_ERROR")).toBe(true);
    expect(isRetryable("IDEMPOTENCY_IN_PROGRESS")).toBe(true);
    expect(isRetryable("BENEFIT_NOT_ELIGIBLE")).toBe(false);
    expect(isRetryable("INVALID_REQUEST")).toBe(false);
    expect(isRetryable("REDEMPTION_CONFLICT")).toBe(false);
  });

  it("un token caducado se renueva en vez de darse por perdido", () => {
    expect(needsFreshToken("TOKEN_EXPIRED")).toBe(true);
    expect(needsFreshToken("INVALID_TOKEN")).toBe(true);
    expect(needsFreshToken("INSUFFICIENT_SCOPE")).toBe(false);
  });

  it("se piden los dos permisos que el canje necesita, no uno", () => {
    // Con solo `benefits:read` la evaluación funciona y el canje falla — en el
    // mostrador, con el cliente delante.
    expect([...REQUIRED_SCOPES]).toEqual(["benefits:read", "benefits:redeem"]);
  });
});

/* ──────────────────────────────────────────── leer la evaluación ── */

describe("leer lo que contesta MembeGo", () => {
  it("separa lo ofrecible de lo que no, sin esconder lo segundo", () => {
    // El cajero necesita poder decir «se te venció»; si desaparece, parece que
    // el sistema no lo ve.
    expect(offerable(EVALUACION).map((b) => b.id)).toEqual(["compra-1"]);
    expect(notOfferable(EVALUACION).map((b) => b.id)).toEqual(["mem-1"]);
  });

  it("traduce el motivo a algo que se le puede decir al cliente", () => {
    expect(reasonMessage("NO_USES_LEFT")).toContain("usos");
    expect(reasonMessage("EXPIRED")).toContain("venció");
    expect(reasonMessage("UN_CODIGO_NUEVO")).toBe("No se puede usar ahora mismo.");
    expect(reasonMessage(null)).toBe("No se puede usar ahora mismo.");
  });

  it("sin evaluación no hay nada que ofrecer", () => {
    expect(offerable(null)).toEqual([]);
  });
});

describe("la evaluación caduca", () => {
  const base = new Date("2026-09-17T12:00:00.000Z");

  it("una consulta reciente vale", () => {
    expect(evaluationIsStale(base.toISOString(), new Date(base.getTime() + 60_000))).toBe(false);
  });

  it("la pantalla que el cajero dejó abierta media hora, no", () => {
    // Entre evaluar y canjear el beneficio puede haberse consumido en otra
    // sucursal: MembeGo manda `evaluatedAt` justamente para esto.
    expect(evaluationIsStale(base.toISOString(), new Date(base.getTime() + 1_800_000))).toBe(true);
  });

  it("justo en el límite todavía vale y un segundo después no", () => {
    const limite = new Date(base.getTime() + EVALUATION_TTL_SECONDS * 1000);
    expect(evaluationIsStale(base.toISOString(), limite)).toBe(false);
    expect(evaluationIsStale(base.toISOString(), new Date(limite.getTime() + 1_000))).toBe(true);
  });

  it("sin fecha o con una fecha inválida se considera caducada", () => {
    expect(evaluationIsStale(null)).toBe(true);
    expect(evaluationIsStale("ayer")).toBe(true);
  });
});

/* ───────────────────────────────────────────────── el descuento ── */

describe("cuánto rebaja el beneficio", () => {
  it("un importe fijo viene en CENTAVOS y no en pesos", () => {
    // 2 550 son 25,50. Tratarlo como pesos descontaría veinticinco veces de más.
    expect(discountFor({ kind: "AMOUNT", amountCents: 2550, label: "-25,50" }, 170)).toBe(25.5);
  });

  it("el porcentaje se aplica sobre la línea", () => {
    expect(discountFor({ kind: "PERCENT", value: 20, label: "-20%" }, 170)).toBe(34);
  });

  it("gratis es la línea entera", () => {
    expect(discountFor({ kind: "FREE", label: "Gratis" }, 170)).toBe(170);
  });

  it("nunca deja la línea en negativo", () => {
    // Un importe negativo lo cuadraría el arqueo restando de la caja del día.
    expect(discountFor({ kind: "AMOUNT", amountCents: 100000, label: "-1000" }, 600)).toBe(600);
    expect(discountFor({ kind: "PERCENT", value: 500, label: "x" }, 100)).toBe(100);
  });

  it("un efecto sin rebaja computable no descuenta nada", () => {
    expect(discountFor({ kind: "NONE", label: "Promoción" }, 170)).toBe(0);
    expect(discountFor(null, 170)).toBe(0);
  });

  it("sobre una línea sin importe no hay nada que rebajar", () => {
    expect(discountFor({ kind: "FREE", label: "Gratis" }, 0)).toBe(0);
  });

  it("redondea al centavo en vez de arrastrar el coma flotante", () => {
    expect(discountFor({ kind: "PERCENT", value: 33, label: "-33%" }, 10)).toBe(3.3);
  });
});

describe("qué efecto tiene cada tipo de beneficio", () => {
  it("una membresía cubre el servicio: la línea va gratis", () => {
    expect(effectOf(MEMBRESIA).kind).toBe("FREE");
  });

  it("una promoción trae el efecto que MembeGo calculó y no se inventa otro", () => {
    expect(effectOf(PROMO)).toEqual({ kind: "PERCENT", value: 20, label: "-20%" });
  });

  it("una promoción sin efecto computable no descuenta sola", () => {
    const sinEfecto = { ...PROMO, effect: undefined };
    expect(effectOf(sinEfecto).kind).toBe("NONE");
  });
});

describe("sobre qué línea se aplica", () => {
  it("por defecto, la más cara", () => {
    // Es lo que cualquiera haría a mano y lo que el cliente espera de «tienes
    // una gratis».
    expect(defaultLine(LINEAS)?.id).toBe("b2");
  });

  it("las líneas sin importe no cuentan", () => {
    expect(defaultLine([{ id: "x", label: "Regalo", total: 0 }])).toBeNull();
  });

  it("sin líneas no hay dónde aplicarlo", () => {
    expect(defaultLine([])).toBeNull();
  });
});

/* ────────────────────────────────────────────────── los bloqueos ── */

describe("cuándo NO se puede canjear", () => {
  it("con todo en orden, se puede", () => {
    expect(redeemBlocker(CONTEXTO)).toBeNull();
  });

  it("sin configuración ni vínculo se dice primero, que es lo que el cajero no puede arreglar", () => {
    expect(redeemBlocker({ ...CONTEXTO, configured: false })).toBe("not_configured");
    expect(redeemBlocker({ ...CONTEXTO, linked: false })).toBe("not_linked");
  });

  it("un cliente que no está en MembeGo no tiene beneficios que consultar", () => {
    expect(redeemBlocker({ ...CONTEXTO, membegoClienteId: null })).toBe("no_customer");
  });

  it("una venta que ya tiene beneficio no admite un segundo", () => {
    // Cada uso es un servicio: dos beneficios sobre la misma venta consumirían
    // dos usos por un solo servicio prestado.
    expect(redeemBlocker({ ...CONTEXTO, alreadyRedeemed: true })).toBe("already_redeemed");
  });

  it("no se canjea sobre una venta cerrada", () => {
    expect(redeemBlocker({ ...CONTEXTO, orderStatus: "cancelled" })).toBe("order_closed");
    expect(redeemBlocker({ ...CONTEXTO, orderStatus: "completed" })).toBe("order_closed");
  });

  it("un beneficio que MembeGo marcó como no elegible no se intenta", () => {
    expect(redeemBlocker({ ...CONTEXTO, benefit: { ...PROMO, eligible: false } })).toBe("not_eligible");
  });

  it("una consulta caducada obliga a volver a comprobar", () => {
    expect(redeemBlocker({ ...CONTEXTO, now: new Date("2026-09-17T13:00:00.000Z") })).toBe("stale");
  });

  it("sin línea con importe no hay dónde aplicarlo", () => {
    expect(redeemBlocker({ ...CONTEXTO, lines: [{ id: "x", label: "y", total: 0 }] })).toBe("no_line");
  });

  it("cada bloqueo tiene un mensaje que dice qué hacer", () => {
    for (const clave of Object.keys(REDEEM_BLOCK_MESSAGE)) {
      expect(REDEEM_BLOCK_MESSAGE[clave as keyof typeof REDEEM_BLOCK_MESSAGE].length).toBeGreaterThan(10);
    }
  });
});

/* ───────────────────────────────────────────────── idempotencia ── */

describe("la clave de idempotencia", () => {
  it("es la MISMA para el mismo canje, que es lo que impide el doble consumo", () => {
    // El doble clic del cajero y el reintento del navegador generan la misma
    // clave, así que MembeGo devuelve el primer canje.
    expect(idempotencyKeyFor("ord-1", "compra-1")).toBe(idempotencyKeyFor("ord-1", "compra-1"));
  });

  it("es distinta para otra venta o para otro beneficio", () => {
    expect(idempotencyKeyFor("ord-1", "compra-1")).not.toBe(idempotencyKeyFor("ord-2", "compra-1"));
    expect(idempotencyKeyFor("ord-1", "compra-1")).not.toBe(idempotencyKeyFor("ord-1", "compra-2"));
  });

  it("no se pasa de largo aunque los identificadores lo sean", () => {
    expect(idempotencyKeyFor("o".repeat(200), "b".repeat(200)).length).toBeLessThanOrEqual(120);
  });
});

describe("qué servicio se le dice a MembeGo", () => {
  it("el nombre del producto, que es lo que sale en el ticket del cliente", () => {
    expect(serviceLabel("Isla Saona")).toBe("Isla Saona");
  });

  it("sin nombre, algo mejor que nada", () => {
    expect(serviceLabel(null)).toBe("Excursión");
    expect(serviceLabel("   ")).toBe("Excursión");
  });
});

/* ─────────────────────────────────────────────────── la reversa ── */

describe("revertir un canje", () => {
  it("un canje de membresía aplicado y con identificador se puede revertir", () => {
    expect(reversalBlocker({ status: "applied", redemption_id: "red-1", benefit_type: "MEMBERSHIP" })).toBeNull();
  });

  it("una promoción NO se revierte por API, y se dice en vez de callarlo", () => {
    // MembeGo revierte canjes de membresía y no tiene el equivalente para
    // promociones. Callarlo dejaría al cliente con un uso gastado por una venta
    // anulada, y al sistema diciendo «listo».
    expect(reversalBlocker({ status: "applied", redemption_id: "red-1", benefit_type: "PROMOTION" })).toBe("promotion");
    expect(REVERSAL_BLOCK_MESSAGE.promotion).toContain("panel de MembeGo");
  });

  it("uno ya revertido no se revierte dos veces", () => {
    expect(reversalBlocker({ status: "reversed", redemption_id: "red-1" })).toBe("already_reversed");
  });

  it("uno que falló no hay nada que revertir", () => {
    expect(reversalBlocker({ status: "failed", redemption_id: null })).toBe("not_applied");
  });

  it("sin identificador de MembeGo se dice que hay que hacerlo a mano", () => {
    // Callarlo dejaría al cliente con un uso consumido por una venta anulada.
    expect(reversalBlocker({ status: "applied", redemption_id: null })).toBe("no_remote_id");
    expect(REVERSAL_BLOCK_MESSAGE.no_remote_id).toContain("panel");
  });

  it("el importe vuelve a la venta solo si la venta sigue viva", () => {
    // Si se está cancelando entera, subir la línea antes inflaría el reembolso.
    expect(shouldRestoreLine("pending_payment")).toBe(true);
    expect(shouldRestoreLine("partially_paid")).toBe(true);
    expect(shouldRestoreLine("cancelled")).toBe(false);
    expect(shouldRestoreLine("refunded")).toBe(false);
  });
});
