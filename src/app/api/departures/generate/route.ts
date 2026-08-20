import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, tenantCreate, tenantQuery } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import type { Product } from "@/lib/types";

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * POST /api/departures/generate
 * Bulk-creates the departure calendar for a product across a date range.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    requireAtLeast(ctx, "operations");

    const body = await readJson<{
      product_id?: string; from?: string; to?: string; times?: string[];
      weekdays?: string[]; capacity?: number; branch_id?: string; cutoff_hours?: number;
    }>(req);

    if (!body.product_id) throw Object.assign(new Error("Selecciona la excursión"), { status: 400 });
    if (!body.from || !body.to) throw Object.assign(new Error("Indica el rango de fechas"), { status: 400 });
    const times = (body.times || []).filter(Boolean);
    if (times.length === 0) throw Object.assign(new Error("Indica al menos un horario de salida"), { status: 400 });

    const product = (await tenantQuery<Product>(ctx.companyId, "product", {
      _filter: { _id: body.product_id }, _limit: 1,
    }))[0];
    if (!product) throw Object.assign(new Error("Excursión no encontrada"), { status: 404 });

    const capacity = body.capacity ?? product.default_capacity ?? 40;
    // AUD-U06: capacity must be a positive whole number of seats.
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw Object.assign(new Error("La capacidad debe ser un número entero positivo"), { status: 400 });
    }
    if (body.cutoff_hours != null && (!Number.isFinite(body.cutoff_hours) || body.cutoff_hours < 0)) {
      throw Object.assign(new Error("El cierre de ventas no puede ser negativo"), { status: 400 });
    }
    const start = new Date(`${body.from}T00:00:00`);
    const end = new Date(`${body.to}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      throw Object.assign(new Error("Rango de fechas inválido"), { status: 400 });
    }
    // AUD-U06/B07: do not generate a calendar that starts in the past.
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    if (end < todayStart) {
      throw Object.assign(new Error("El rango de fechas ya pasó"), { status: 400 });
    }
    const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
    if (days > 366) throw Object.assign(new Error("El rango no puede superar 12 meses"), { status: 400 });

    const existing = await tenantQuery<{ departure_at?: string }>(ctx.companyId, "departure", {
      _filter: {
        product: body.product_id,
        departure_at: { gte: start.toISOString(), lte: new Date(end.getTime() + 86_400_000).toISOString() },
      },
      _limit: 1000,
    });
    const taken = new Set(existing.map((d) => (d.departure_at || "").slice(0, 16)));

    let created = 0;
    let skipped = 0;
    for (let i = 0; i < days; i++) {
      const day = new Date(start);
      day.setDate(day.getDate() + i);
      if (body.weekdays?.length && !body.weekdays.includes(WEEKDAYS[day.getDay()])) continue;

      for (const time of times) {
        const [h, m] = time.split(":").map(Number);
        const at = new Date(day);
        at.setHours(h || 0, m || 0, 0, 0);
        // AUD-U06/B07: within a range that spans past→future, skip the slots
        // that already elapsed instead of creating departures in the past.
        if (at.getTime() < Date.now()) { skipped++; continue; }
        if (taken.has(at.toISOString().slice(0, 16))) { skipped++; continue; }

        await tenantCreate(ctx.companyId, "departure", {
          product: body.product_id,
          branch: body.branch_id || undefined,
          departure_at: at.toISOString(),
          departure_time: time,
          capacity,
          booked_pax: 0, pending_pax: 0, available_pax: capacity, waitlist_pax: 0,
          cutoff_hours: body.cutoff_hours ?? 12,
          status: "available",
          meeting_point: product.meeting_point,
        });
        created++;
      }
    }

    console.log(`[departures] ${created} salidas creadas para ${product.name} (${skipped} ya existían)`);
    return ok({ created, skipped });
  } catch (err) {
    return fail(err);
  }
}
