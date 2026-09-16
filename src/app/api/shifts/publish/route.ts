import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, tenantQuery, tenantUpdate, TenantError } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { publishDecision, type ShiftLike } from "@/lib/hr";
import { assertStaffAssignable, findShiftConflict } from "@/lib/hr-service";
import { refId } from "@/lib/types";

/**
 * POST /api/shifts/publish — publicar el cuadrante de una semana.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PUBLICAR NO ES CAMBIAR UN DESPLEGABLE
 *
 * El estado «publicado» existía desde 0009 como una opción más del `select`, al
 * lado de «planificado» y «confirmado». Publicar un cuadrante es decirle al
 * equipo «esta es tu semana», y eso obliga a comprobar antes las dos cosas que
 * convierten un cuadrante en un problema: que nadie esté en dos sitios a la vez
 * y que nadie tenga los papeles vencidos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TODO O NADA, NO
 *
 * Publica los que puede y devuelve la lista de los que no, con el motivo. Parar
 * la semana entera porque un turno choca deja al resto del equipo sin saber su
 * horario por culpa de un problema que no es suyo.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "shifts:publish", ctx.userId), limit: 20, windowMs: 60_000 });
    requireAtLeast(ctx, "manager");

    const body = await readJson<{ ids?: string[]; from?: string; to?: string }>(req);

    let candidatos: ShiftLike[];
    if (Array.isArray(body.ids) && body.ids.length > 0) {
      candidatos = await tenantQuery<ShiftLike>(ctx.companyId, "shift", {
        _filter: { _id: { in: body.ids.slice(0, 500) } }, _limit: 500,
      });
    } else if (body.from && body.to) {
      candidatos = await tenantQuery<ShiftLike>(ctx.companyId, "shift", {
        _filter: { shift_date: { gte: body.from, lte: body.to }, status: "planned" },
        _limit: 500,
      });
    } else {
      throw new TenantError("Indica los turnos o el rango de fechas a publicar.", 400);
    }

    const published: string[] = [];
    const rejected: { id: string; label: string; reason: string }[] = [];
    const now = new Date().toISOString();

    for (const shift of candidatos) {
      const id = String(shift._id || shift.id || "");
      const label = `${shift.shift_date ?? "?"} ${shift.role_label ?? ""}`.trim();

      const decision = publishDecision(shift);
      if (decision.ok === false) {
        rejected.push({ id, label, reason: decision.reason });
        continue;
      }

      const staffId = refId(shift.staff);
      if (staffId) {
        try {
          await assertStaffAssignable(ctx.companyId, staffId);
        } catch (err) {
          rejected.push({ id, label, reason: (err as Error).message });
          continue;
        }
      }

      const choque = await findShiftConflict(ctx.companyId, shift);
      if (choque) {
        rejected.push({
          id, label,
          reason: `Se pisa con otro turno del ${choque.shift_date ?? "mismo día"}.`,
        });
        continue;
      }

      await tenantUpdate(ctx.companyId, "shift", id, {
        status: "published",
        published_at: now,
        published_by: ctx.userId,
      });
      published.push(id);
    }

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "shifts_published", entityType: "shift", entityId: null,
      description: `Cuadrante publicado: ${published.length} turnos${rejected.length ? `, ${rejected.length} rechazados` : ""}`,
      severity: rejected.length > 0 ? "warning" : "info",
    });

    console.log(`[shifts] publicados ${published.length}, rechazados ${rejected.length}`);
    return ok({ published: published.length, rejected });
  } catch (err) {
    return fail(err);
  }
}
