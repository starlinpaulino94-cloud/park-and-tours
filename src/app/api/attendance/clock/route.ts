import { NextRequest } from "next/server";
import { requireTenant, requireTenantWrite, requireAtLeast, tenantCreate, tenantUpdate, tenantQuery, TenantError } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { clockDecision, dayOf, type AttendanceLike } from "@/lib/hr";
import { attendanceFor } from "@/lib/hr-service";
import { refId } from "@/lib/types";

/**
 * POST /api/attendance/clock — fichar entrada o salida.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ SUSTITUYE
 *
 * `attendance.hours_worked` se tecleaba a mano teniendo la entrada y la salida
 * en la misma pantalla. Es decir: el sistema tenía los dos marcajes y le pedía
 * a una persona que hiciera la resta, todos los días, para cada uno del equipo.
 * De ahí salía la nómina.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUIÉN PUEDE FICHAR A QUIÉN
 *
 * Cualquiera con acceso puede fichar POR SÍ MISMO —su ficha de personal está
 * atada a su usuario—. Fichar por otra persona es rango de operaciones: sin esa
 * separación, cualquiera podría marcarle la entrada a un compañero que aún no
 * ha llegado, que es el fraude clásico de un reloj de fichar.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "attendance:clock", ctx.userId), limit: 30, windowMs: 60_000 });

    const body = await readJson<{ action?: string; staff?: string; notes?: string }>(req);
    const action = body.action === "out" ? "out" : "in";

    // Mi propia ficha de personal, la que está atada a mi usuario.
    const propias = await tenantQuery<{ _id?: string; id?: string }>(ctx.companyId, "staff", {
      _filter: { user: ctx.userId }, _limit: 1,
    });
    const mia = propias[0] ? String(propias[0]._id || propias[0].id) : null;

    const staffId = (body.staff || "").trim() || mia;
    if (!staffId) {
      throw new TenantError(
        "Tu usuario no está enlazado a una ficha de personal. Pídele a quien administra que lo enlace.",
        409
      );
    }
    if (staffId !== mia) requireAtLeast(ctx, "operations");

    const now = new Date();
    const today = dayOf(now.toISOString())!;
    const current = await attendanceFor(ctx.companyId, staffId, today);

    const decision = clockDecision(current, action, now.toISOString());
    if (decision.ok === false) {
      throw Object.assign(new TenantError(decision.reason, 409), { code: decision.code });
    }

    const patch = { ...decision.patch, ...(body.notes ? { notes: body.notes } : {}) };
    const saved = current
      ? await tenantUpdate(ctx.companyId, "attendance", String(current._id || current.id), patch)
      : await tenantCreate(ctx.companyId, "attendance", {
          staff: staffId, attendance_date: today, ...patch,
        });

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: action === "in" ? "attendance_clock_in" : "attendance_clock_out",
      entityType: "attendance", entityId: refId(saved) || null,
      description:
        action === "in"
          ? `Entrada marcada${staffId !== mia ? " por un tercero" : ""}`
          : `Salida marcada: ${decision.hours.worked} h (${decision.hours.overtime} extra)`,
      severity: "info",
    });

    return ok({ attendance: saved, hours: decision.hours, action });
  } catch (err) {
    return fail(err);
  }
}

/**
 * GET /api/attendance/clock — cómo está hoy mi fichaje (o el de alguien).
 *
 * Lectura, así que `requireTenant`: una suscripción vencida bloquea escribir,
 * nunca mirar. Quien tiene la suscripción al día debe poder ver su propio
 * marcaje igual que ve el resto de sus datos.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "attendance:clock:read", ctx.userId), limit: 120, windowMs: 60_000 });

    const propias = await tenantQuery<{ _id?: string; id?: string; full_name?: string }>(ctx.companyId, "staff", {
      _filter: { user: ctx.userId }, _limit: 1,
    });
    const mia = propias[0] ? String(propias[0]._id || propias[0].id) : null;
    const pedido = (req.nextUrl.searchParams.get("staff") || "").trim() || mia;
    if (!pedido) return ok({ linked: false, today: null });
    if (pedido !== mia) requireAtLeast(ctx, "operations");

    const today = dayOf(new Date().toISOString())!;
    const current: AttendanceLike | null = await attendanceFor(ctx.companyId, pedido, today);
    return ok({
      linked: Boolean(mia),
      staffId: pedido,
      staffName: propias[0]?.full_name ?? null,
      today: current,
      canClockIn: !current?.clock_in,
      canClockOut: Boolean(current?.clock_in) && !current?.clock_out,
    });
  } catch (err) {
    return fail(err);
  }
}
