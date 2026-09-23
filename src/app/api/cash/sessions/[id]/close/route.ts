import { NextRequest } from "next/server";
import {
  requireTenantWrite, requireAtLeast, tenantCreate, tenantFindOne, tenantUpdate,
  TenantError, esDeSocio, esAdminDeSocio,
} from "@/lib/tenant";
import { exigeRangoDeCaja, noPuedeAbrirLaCaja } from "@/lib/caja-identidad";
import { ok, fail, readJson } from "@/lib/api-response";
import { recalcCashSession } from "@/lib/cash";
import { loadCashClose } from "@/lib/cash-service";
import {
  countTotal, invalidDenominations, differenceOf, classifyDifference, needsApproval,
  byCurrencyMap, type CountLine,
} from "@/lib/cash-close";
import { postCashDifference } from "@/lib/ledger-events";
import { writeAudit } from "@/lib/audit";
import { notify } from "@/lib/notify-service";
import type { CashSession } from "@/lib/types";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";

interface CountPayload {
  currency?: string;
  breakdown?: CountLine[];
  notes?: string;
}

/**
 * POST /api/cash/sessions/:id/close — el arqueo.
 *
 * El cajero cuenta el dinero físico POR MONEDA y POR DENOMINACIÓN. El sistema
 * calcula lo esperado, guarda el conteo con su desglose, y decide si el turno
 * queda cerrado o a la espera de un supervisor. El cajero nunca escribe el
 * esperado ni la diferencia: los dos salen de los movimientos.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "cash:close", ctx.userId), limit: 20, windowMs: 60_000 });

    const body = await readJson<{
      counts?: CountPayload[];
      counted_cash?: number;
      card_batch_total?: number;
      card_batch_reference?: string;
      deposit_reference?: string;
      difference_reason?: string;
      notes?: string;
    }>(req);

    const session = await tenantFindOne<CashSession & { partner?: unknown; seller?: unknown }>(
      ctx.companyId, "cash_session", id
    );
    if (session.status !== "open") {
      throw Object.assign(new Error("La sesión de caja ya está cerrada"), { status: 409 });
    }

    /**
     * Cierra el turno su dueño (0081).
     *
     * `tenantFindOne` solo comprueba la empresa, así que sin esto bastaba
     * conocer el identificador de una sesión para cerrarle el turno a otro —y
     * el descuadre, con su aprobación y todo, queda a su nombre—. Misma función
     * que para abrirla y que para moverla: tres comprobaciones distintas de
     * «esta caja es tuya» acaban discrepando.
     */
    const actorDeCaja = {
      esDeSocio: esDeSocio(ctx), partnerId: ctx.partnerId,
      sellerId: ctx.sellerId, esAdminDeSocio: esAdminDeSocio(ctx),
    };
    /**
     * El rango de siempre, SALVO que la caja sea suya (0083).
     *
     * Las rutas de caja pedían `cashier` y un `seller` está por debajo: el
     * promotor de playa —la persona entera para la que existe el modo «retiene
     * su comisión»— no podía abrir un turno, y sin turno no hay dónde apuntar
     * lo que se queda ni con qué cuadrar al final del día.
     */
    if (exigeRangoDeCaja(session, actorDeCaja)) requireAtLeast(ctx, "cashier");

    const impedimento = noPuedeAbrirLaCaja({ ...session, status: "active" }, actorDeCaja);
    if (impedimento) throw new TenantError(impedimento, 403);

    // Se recalcula ANTES de contar: cerrar contra un esperado viejo convierte
    // en descuadre cualquier cobro registrado mientras el cajero contaba.
    await recalcCashSession(ctx.companyId, id);
    const arqueo = await loadCashClose(ctx.companyId, id);
    const primary = String(session.currency || "usd").toLowerCase();

    // Compatibilidad: un cliente antiguo manda un único `counted_cash` sin
    // desglose. Se acepta como conteo de la moneda principal.
    const submitted: CountPayload[] = Array.isArray(body.counts) && body.counts.length > 0
      ? body.counts
      : body.counted_cash != null
        ? [{ currency: primary, breakdown: [] }]
        : [];

    const byCurrency = new Map<string, CountPayload>();
    for (const entry of submitted) {
      byCurrency.set(String(entry.currency || primary).toLowerCase(), entry);
    }

    // Toda moneda que se movió en el turno hay que contarla. Cerrar contando
    // solo los pesos deja los dólares del cajón sin arquear —y sin dueño.
    const missing = arqueo.currencies
      .filter((c) => !byCurrency.has(c.currency))
      .map((c) => c.currency.toUpperCase());
    if (missing.length > 0) {
      throw Object.assign(
        new Error(`Falta contar el efectivo en ${missing.join(", ")}`),
        { status: 400 }
      );
    }

    // Una denominación que no existe en esa moneda cuadra la caja con dinero
    // inventado: se rechaza el cierre entero antes que aceptar el total.
    for (const summary of arqueo.currencies) {
      const currency = summary.currency;
      const bad = invalidDenominations(byCurrency.get(currency)?.breakdown, currency);
      if (bad.length > 0) {
        throw Object.assign(
          new Error(`En ${currency.toUpperCase()} no existen las denominaciones ${bad.join(", ")}`),
          { status: 400 }
        );
      }
    }

    const closedAt = new Date().toISOString();
    const results: { currency: string; expected: number; counted: number; difference: number }[] = [];

    for (const summary of arqueo.currencies) {
      const entry = byCurrency.get(summary.currency)!;
      const hasBreakdown = Array.isArray(entry.breakdown) && entry.breakdown.length > 0;
      // Sin desglose, el conteo es cero —cajón vacío es una respuesta válida—,
      // salvo el `counted_cash` del cliente antiguo, que solo vale para la
      // moneda principal: aplicarlo a todas contaría el mismo dinero dos veces.
      const counted = hasBreakdown
        ? countTotal(entry.breakdown)
        : summary.currency === primary
          ? Math.max(0, Number(body.counted_cash ?? 0))
          : 0;
      const difference = differenceOf(summary.expected, counted);

      await tenantCreate(ctx.companyId, "cash_count", {
        cash_session: id,
        currency: summary.currency,
        kind: "close",
        breakdown: hasBreakdown ? entry.breakdown : [],
        counted_total: counted,
        expected_total: summary.expected,
        difference,
        counted_by: ctx.userId,
        counted_at: closedAt,
        notes: entry.notes,
      });

      await tenantCreate(ctx.companyId, "cash_movement", {
        cash_session: id, user: ctx.userId,
        movement_type: "closing", amount: counted,
        currency: summary.currency, concept: "Cierre de caja / arqueo",
        movement_at: closedAt,
      });

      results.push({ currency: summary.currency, expected: summary.expected, counted, difference });
    }

    const tolerance = arqueo.tolerance;
    const requiresApproval = needsApproval(results.map((r) => r.difference), tolerance);
    const main = results.find((r) => r.currency === primary);

    await tenantUpdate(ctx.companyId, "cash_session", id, {
      closed_at: closedAt,
      closed_by: ctx.userId,
      status: requiresApproval ? "pending_approval" : "closed",
      requires_approval: requiresApproval,
      counted_cash: main?.counted ?? 0,
      difference: main?.difference ?? 0,
      counted_by_currency: byCurrencyMap(results.map((r) => ({ currency: r.currency, amount: r.counted }))),
      difference_by_currency: byCurrencyMap(results.map((r) => ({ currency: r.currency, amount: r.difference }))),
      card_batch_total: body.card_batch_total != null ? Number(body.card_batch_total) : undefined,
      card_batch_reference: body.card_batch_reference,
      deposit_reference: body.deposit_reference,
      difference_reason: body.difference_reason,
      notes: body.notes || session.notes,
    });

    // Un descuadre dentro de tolerancia cierra solo, y aun así cuesta dinero:
    // se asienta ya. El que va a revisión espera al supervisor.
    if (!requiresApproval && main && Math.abs(main.difference) >= 0.01) {
      await postCashDifference(ctx.companyId, {
        cashSessionId: id,
        difference: main.difference,
        currency: primary,
        userId: ctx.userId,
      });
    }

    const worst = results.reduce(
      (acc, r) => (Math.abs(r.difference) > Math.abs(acc) ? r.difference : acc), 0
    );
    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "cash_session_closed", entityType: "cash_session", entityId: id,
      description: results
        .map((r) => `${r.currency.toUpperCase()}: esperado ${r.expected}, contado ${r.counted}, diferencia ${r.difference}`)
        .join(" · "),
      severity: classifyDifference(worst, tolerance) === "balanced" ? "info" : "warning",
      metadata: { results, tolerance, requires_approval: requiresApproval },
    });

    // El descuadre se avisa al gerente. Es la alerta más cara de descubrir
    // tarde: cuando se nota en el arqueo del mes, ya no hay a quién preguntar.
    if (classifyDifference(worst, tolerance) !== "balanced") {
      await notify({
        companyId: ctx.companyId,
        event: "cash_close_mismatch",
        entityType: "cash_session",
        entityId: id,
        vars: {
          diferencia: worst,
          moneda: primary,
          caja: session.code,
        },
      });
    }

    console.log(`[cash] sesión ${session.code} cerrada · ${requiresApproval ? "a revisión" : "cuadrada"}`);
    return ok({
      status: requiresApproval ? "pending_approval" : "closed",
      requires_approval: requiresApproval,
      tolerance,
      results,
      // El cliente antiguo lee estos tres campos.
      expected_cash: main?.expected ?? 0,
      counted_cash: main?.counted ?? 0,
      difference: main?.difference ?? 0,
    });
  } catch (err) {
    return fail(err);
  }
}
