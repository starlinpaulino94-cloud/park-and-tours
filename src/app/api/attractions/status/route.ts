import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, tenantCreate, tenantFindOne, tenantUpdate } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";

/**
 * POST /api/attractions/status — live status change from the park control room.
 *
 * Writes the new status, appends an immutable bitácora entry and accumulates
 * downtime when the attraction was not open, which is what makes the daily
 * availability figure trustworthy.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    requireAtLeast(ctx, "operations");

    const body = await readJson<{
      attraction: string; status: string; reason?: string; guests?: number; queueMinutes?: number;
    }>(req);
    if (!body.attraction || !body.status) {
      return fail(Object.assign(new Error("Faltan la atracción y el estado"), { status: 400 }));
    }

    const attraction = await tenantFindOne<any>(ctx.companyId, "attraction", body.attraction);
    const from = attraction.operational_status || "open";
    const now = new Date();

    // Minutes spent in the previous state, credited to downtime when it was not open.
    const since = attraction.last_status_at ? new Date(attraction.last_status_at) : null;
    const elapsed = since ? Math.max(0, Math.round((now.getTime() - since.getTime()) / 60000)) : 0;
    const wasDown = from !== "open";
    const downtimeToday = Number(attraction.downtime_minutes_today ?? 0) + (wasDown ? elapsed : 0);

    await tenantUpdate(ctx.companyId, "attraction", body.attraction, {
      operational_status: body.status,
      last_status_at: now.toISOString(),
      downtime_minutes_today: downtimeToday,
      ...(body.guests !== undefined ? { guests_today: Number(body.guests) } : {}),
      ...(body.queueMinutes !== undefined ? { queue_minutes: Number(body.queueMinutes) } : {}),
    });

    await tenantCreate(ctx.companyId, "attraction_log", {
      attraction: body.attraction,
      logged_at: now.toISOString(),
      event_type: "status_change",
      from_status: from,
      to_status: body.status,
      duration_min: elapsed,
      guests: body.guests !== undefined ? Number(body.guests) : null,
      reason: body.reason || null,
      user: ctx.userId,
    });

    console.log(
      `[api] ${ctx.email} cambió ${attraction.name}: ${from} → ${body.status} ` +
      `(${elapsed} min en el estado anterior, downtime hoy=${downtimeToday})`
    );
    return ok({ from, to: body.status, elapsed, downtimeToday });
  } catch (err) {
    return fail(err);
  }
}
