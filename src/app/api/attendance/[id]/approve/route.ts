import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, tenantFindOne, tenantUpdate, TenantError } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { attendanceHours, type AttendanceLike } from "@/lib/hr";

/**
 * POST /api/attendance/:id/approve — el visto bueno del encargado.
 *
 * Aprobar es lo que convierte un marcaje en horas pagables. Recalcula ANTES de
 * aprobar: si alguien corrigió la entrada a mano después de fichar, lo que se
 * aprueba tiene que ser la resta de lo que hay ahora, no la de cuando se fichó.
 *
 * Un marcaje ya pagado no se re-aprueba: sus horas están en una corrida cerrada
 * y cambiarlas dejaría la nómina diciendo una cosa y la asistencia otra.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "attendance:approve", ctx.userId), limit: 120, windowMs: 60_000 });
    requireAtLeast(ctx, "manager");

    const body = await readJson<{ revoke?: boolean }>(req);
    const att = await tenantFindOne<AttendanceLike>(ctx.companyId, "attendance", id);

    if (att.payroll_run_id) {
      throw new TenantError("Este marcaje ya se pagó en una corrida de nómina.", 409);
    }

    if (body.revoke) {
      await tenantUpdate(ctx.companyId, "attendance", id, { approved_at: null, approved_by: null });
      await writeAudit({
        companyId: ctx.companyId, userId: ctx.userId,
        action: "attendance_unapproved", entityType: "attendance", entityId: id,
        description: "Aprobación de asistencia retirada", severity: "warning",
      });
      return ok({ approved: false });
    }

    const hours = attendanceHours(att);
    await tenantUpdate(ctx.companyId, "attendance", id, {
      hours_worked: hours.worked,
      regular_hours: hours.regular,
      overtime_hours: hours.overtime,
      approved_at: new Date().toISOString(),
      approved_by: ctx.userId,
    });

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "attendance_approved", entityType: "attendance", entityId: id,
      description: `Asistencia aprobada: ${hours.worked} h (${hours.overtime} extra)`,
      severity: "info",
    });

    return ok({ approved: true, hours });
  } catch (err) {
    return fail(err);
  }
}
