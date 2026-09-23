import { NextRequest } from "next/server";
import {
  requireTenantWrite, requireAtLeast, tenantCreate, tenantFindOne,
  TenantError, esDeSocio, esAdminDeSocio,
} from "@/lib/tenant";
import { noPuedeAbrirLaCaja, duenoDeLaCaja } from "@/lib/caja-identidad";
import { ok, fail, readJson } from "@/lib/api-response";
import { recalcCashSession } from "@/lib/cash";
import { isKnownCurrency } from "@/lib/cash-close";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import type { CashSession } from "@/lib/types";
import { writeAudit } from "@/lib/audit";

/** POST /api/cash/movements — manual cash in/out (withdrawals, deposits, petty expenses). */
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "cash:movement", ctx.userId), limit: 60, windowMs: 60_000 });
    requireAtLeast(ctx, "cashier");

    const body = await readJson<{
      cash_session_id?: string; movement_type?: string; amount?: number;
      currency?: string; concept?: string; reference?: string;
    }>(req);

    if (!body.cash_session_id) throw Object.assign(new Error("Indica la sesión de caja"), { status: 400 });
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount === 0) {
      throw Object.assign(new Error("El importe debe ser distinto de cero"), { status: 400 });
    }
    // AUD-U06/F27: only known manual movement types are accepted, so an
    // arbitrary string can't be mis-classified by the cash recalculation.
    const ALLOWED_MOVEMENTS = ["deposit", "withdrawal", "expense", "adjustment"];
    const movementType = body.movement_type || "adjustment";
    if (!ALLOWED_MOVEMENTS.includes(movementType)) {
      throw Object.assign(new Error("Tipo de movimiento no válido"), { status: 400 });
    }

    // Una moneda desconocida la rechaza el enum de la base con un error opaco;
    // se para aquí con un mensaje que se entiende.
    if (body.currency && !isKnownCurrency(body.currency)) {
      throw Object.assign(new Error("Moneda no válida"), { status: 400 });
    }

    const session = await tenantFindOne<CashSession & { partner?: unknown; seller?: unknown }>(
      ctx.companyId, "cash_session", body.cash_session_id
    );
    if (session.status !== "open") {
      throw Object.assign(new Error("La sesión de caja está cerrada"), { status: 409 });
    }

    /**
     * Y TIENE QUE SER SU TURNO (0081).
     *
     * `tenantFindOne` solo comprueba la empresa, así que sin esto bastaba con
     * conocer el identificador de una sesión para meterle un retiro: el
     * descuadre le salía al cajero que estaba ahí. Con la caja externa además
     * cruzaría el dinero entre mostradores.
     *
     * Misma regla que para abrirla, y por eso es la misma función: dos
     * comprobaciones distintas para «esta caja es tuya» acaban discrepando.
     */
    const impedimento = noPuedeAbrirLaCaja(
      { ...session, status: "active" },
      {
        esDeSocio: esDeSocio(ctx), partnerId: ctx.partnerId,
        sellerId: ctx.sellerId, esAdminDeSocio: esAdminDeSocio(ctx),
      }
    );
    if (impedimento) throw new TenantError(impedimento, 403);

    // El dueño sale del TURNO, nunca del cuerpo de la petición.
    const dueno = duenoDeLaCaja(session);

    // El ajuste conserva su signo: uno que solo puede sumar no es un ajuste,
    // es una entrada, y deja al cajero sin forma de corregir un sobrante mal
    // registrado. Los demás tipos ya llevan el signo en su significado
    // (`withdrawal` resta, `deposit` suma), así que se guardan en positivo.
    const signedAmount = movementType === "adjustment" ? amount : Math.abs(amount);

    const movement = await tenantCreate(ctx.companyId, "cash_movement", {
      cash_session: body.cash_session_id,
      user: ctx.userId,
      partner: dueno.partnerId ?? undefined,
      seller: dueno.sellerId ?? undefined,
      movement_type: movementType,
      amount: signedAmount,
      // La moneda la manda el cajero: la misma caja recibe pesos y dólares, y
      // forzar la de la sesión convertía un retiro en dólares en un retiro en
      // pesos por el mismo número.
      currency: body.currency || session.currency,
      concept: body.concept || "Movimiento manual",
      reference: body.reference,
      movement_at: new Date().toISOString(),
    });

    // Un movimiento de caja es dinero. Sin anotarlo, un descuadre no se puede
    // reconstruir: se ve el saldo, no quién lo movió ni por qué.
    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "cash_movement_registered", entityType: "cash_movement",
      entityId: (movement as Record<string, unknown>)?._id as string | undefined,
      description: `${ctx.email} registró un movimiento de caja`,
      severity: "warning",
      metadata: { tipo: body.movement_type, importe: body.amount, sesion: body.cash_session_id },
    });
    await recalcCashSession(ctx.companyId, body.cash_session_id);
    console.log(`[cash] movimiento ${body.movement_type} de ${amount} en ${session.code}`);
    return ok(movement);
  } catch (err) {
    return fail(err);
  }
}
