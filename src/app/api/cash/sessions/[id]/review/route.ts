import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, tenantDelete, tenantFindOne, tenantQuery, tenantUpdate } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { recalcCashSession } from "@/lib/cash";
import { postCashDifference } from "@/lib/ledger-events";
import { supabaseService } from "@/lib/supabase/service";
import { writeAudit } from "@/lib/audit";
import type { CashSession } from "@/lib/types";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";

const refId = (value: unknown): string | null =>
  typeof value === "string" ? value : (value as { _id?: string } | null)?._id ?? null;

/**
 * POST /api/cash/sessions/:id/review — el supervisor resuelve un descuadre.
 *
 * Un arqueo que descuadra por encima de la tolerancia de la caja queda en
 * `pending_approval`. Que el propio cajero pueda cerrarlo y darlo por bueno
 * anula el control entero, así que aquí se exige dos cosas: rango de manager,
 * y que el que aprueba NO sea el que contó.
 *
 * Dos decisiones:
 *   · `approve` — se acepta la diferencia. La sesión queda conciliada y el
 *     faltante o el sobrante se asienta en la contabilidad.
 *   · `recount` — el conteo no convence. La sesión vuelve a abrirse, se borra
 *     el conteo de cierre y el cajero cuenta otra vez. Un arqueo que no se
 *     puede repetir obliga a aceptar el primero, que es justo lo contrario de
 *     revisarlo.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "cash:review", ctx.userId), limit: 30, windowMs: 60_000 });
    requireAtLeast(ctx, "manager");

    const body = await readJson<{
      decision?: "approve" | "recount";
      approval_notes?: string;
      difference_reason?: string;
    }>(req);
    const decision = body.decision === "recount" ? "recount" : "approve";

    const session = await tenantFindOne<CashSession>(ctx.companyId, "cash_session", id);
    if (session.status !== "pending_approval") {
      throw Object.assign(
        new Error("Esta sesión no está esperando revisión"),
        { status: 409 }
      );
    }

    // El que cuenta no se aprueba a sí mismo. Sin esto, "supervisado" solo
    // significa que el cajero hizo dos clics en vez de uno.
    const closedBy = refId(session.closed_by) || refId(session.user);
    if (closedBy && closedBy === ctx.userId) {
      throw Object.assign(
        new Error("El arqueo lo tiene que revisar una persona distinta de quien lo cerró"),
        { status: 409 }
      );
    }

    if (decision === "recount") {
      const counts = await tenantQuery<{ _id: string }>(ctx.companyId, "cash_count", {
        _filter: { cash_session: id, kind: "close" }, _limit: 20,
      });
      for (const count of counts) await tenantDelete(ctx.companyId, "cash_count", count._id);

      const movements = await tenantQuery<{ _id: string; movement_type?: string }>(
        ctx.companyId, "cash_movement", { _filter: { cash_session: id, movement_type: "closing" }, _limit: 50 }
      );
      for (const movement of movements) await tenantDelete(ctx.companyId, "cash_movement", movement._id);

      await tenantUpdate(ctx.companyId, "cash_session", id, {
        status: "open",
        requires_approval: false,
        closed_at: null,
        closed_by: null,
        counted_cash: 0,
        difference: 0,
        counted_by_currency: {},
        difference_by_currency: {},
        approval_notes: body.approval_notes,
      });
      await recalcCashSession(ctx.companyId, id);

      await writeAudit({
        companyId: ctx.companyId, userId: ctx.userId,
        action: "cash_session_recount", entityType: "cash_session", entityId: id,
        description: `Arqueo devuelto para recuento${body.approval_notes ? `: ${body.approval_notes}` : ""}`,
        severity: "warning",
      });

      console.log(`[cash] sesión ${session.code} devuelta para recuento`);
      return ok({ status: "open", decision });
    }

    const approvedAt = new Date().toISOString();

    /**
     * SE RECLAMA LA APROBACIÓN ANTES DE ASENTAR (0101).
     *
     * ────────────────────────────────────────────────────────────────────────
     * ESTA NO TENÍA NINGUNA DEFENSA
     *
     * Leía `status === "pending_approval"`, escribía `reconciled` y asentaba la
     * diferencia en el libro diario. Lo único que impedía el asiento doble era
     * `alreadyPosted`, que es una LECTURA: dos aprobaciones a la vez preguntan
     * las dos, no encuentran nada las dos, y asientan las dos.
     *
     * Medido con las dos defensas de 0101 fuera: el mismo faltante de caja se
     * asentó **veinte veces**. Un descuadre contabilizado dos veces no lo nota
     * nadie hasta que no cuadra el balance del mes.
     *
     * El reclamo va PRIMERO por eso: quien pierde la carrera sale de aquí sin
     * tocar el libro. Detrás queda el índice único de 0101 por si algún día
     * alguien mueve el asiento a otro sitio.
     */
    const { data: reclamado, error: errorDelReclamo } = await supabaseService()
      .rpc("claim_cash_session_status", {
        p_session: id,
        p_from: "pending_approval",
        p_to: "reconciled",
        p_at: approvedAt,
        p_by: ctx.userId,
      });
    if (errorDelReclamo) {
      throw Object.assign(
        new Error(`No se pudo aprobar el arqueo: ${errorDelReclamo.message}`),
        { status: 409 }
      );
    }
    if (reclamado !== true) {
      throw Object.assign(new Error("Este arqueo ya se revisó"), { status: 409 });
    }

    // El estado, la fecha y la firma los escribió el reclamo.
    await tenantUpdate(ctx.companyId, "cash_session", id, {
      approval_notes: body.approval_notes,
      difference_reason: body.difference_reason || session.difference_reason,
    });

    // La diferencia aceptada llega ahora a la contabilidad: el faltante es una
    // pérdida y el sobrante un ingreso.
    await postCashDifference(ctx.companyId, {
      cashSessionId: id,
      difference: session.difference ?? 0,
      currency: session.currency,
      userId: ctx.userId,
    });

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "cash_session_approved", entityType: "cash_session", entityId: id,
      description: `Arqueo aprobado con diferencia ${session.difference ?? 0} ${String(session.currency || "").toUpperCase()}`,
      severity: "info",
      metadata: {
        difference: session.difference ?? 0,
        difference_by_currency: session.difference_by_currency ?? {},
        reason: body.difference_reason || session.difference_reason || null,
      },
    });

    console.log(`[cash] sesión ${session.code} conciliada por ${ctx.email}`);
    return ok({ status: "reconciled", decision, approved_at: approvedAt });
  } catch (err) {
    return fail(err);
  }
}
