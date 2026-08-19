import { NextRequest } from "next/server";
import { requireTenant, tenantQuery } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import type { Departure } from "@/lib/types";

/**
 * GET /api/operations/dispatch?date=YYYY-MM-DD
 * Everything the operations desk needs for a single day: departures, pax,
 * vehicles, guides, hotels and resource conflicts.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    const dateParam = req.nextUrl.searchParams.get("date");
    const day = dateParam ? new Date(`${dateParam}T00:00:00`) : new Date();
    const from = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0);
    const to = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59);

    const departures = await tenantQuery<Departure>(ctx.companyId, "departure", {
      _filter: { departure_at: { gte: from.toISOString(), lte: to.toISOString() } },
      _sort: { departure_at: "asc" },
      _limit: 200,
      product: true,
      booking: {
        _limit: 300,
        _filter: { status: { nin: ["cancelled", "refunded"] } },
        customer: true, pickup_hotel: true,
      },
      departure_resource: { _limit: 60, vehicle: true, staff: true },
      pickup_route: { _limit: 40, vehicle: true, driver: true, guide: true, zone: true },
    });

    // Detect double-booked drivers/guides/vehicles across the day.
    const staffUse = new Map<string, string[]>();
    const vehicleUse = new Map<string, string[]>();

    const items = departures.map((d) => {
      const bookings = (d.booking || []) as any[];
      const pax = bookings.reduce((s, b) => s + (b.pax_total ?? 0), 0);
      const hotels = new Set<string>();
      for (const b of bookings) {
        const h = b.pickup_hotel;
        if (h && typeof h === "object" && h.name) hotels.add(h.name);
      }
      const resources = (d.departure_resource || []) as any[];
      const vehicles = resources.filter((r) => r.vehicle).map((r) => r.vehicle);
      const staff = resources.filter((r) => r.staff).map((r) => ({ ...r.staff, role: r.resource_role }));
      const guides = staff.filter((s) => s.role === "guide" || s.staff_type === "guide");

      const label = `${typeof d.product === "object" ? d.product?.name : "Salida"} ${new Date(d.departure_at || "").toISOString().slice(11, 16)}`;
      for (const s of staff) if (s?._id) staffUse.set(s._id, [...(staffUse.get(s._id) || []), label]);
      for (const v of vehicles) if (v?._id) vehicleUse.set(v._id, [...(vehicleUse.get(v._id) || []), label]);

      const vehicleCapacity = vehicles.reduce((s: number, v: any) => s + (v?.capacity ?? 0), 0);

      return {
        _id: d._id,
        product: typeof d.product === "object" ? d.product?.name : "Salida",
        product_id: typeof d.product === "object" ? d.product?._id : d.product,
        departure_at: d.departure_at,
        status: d.status,
        capacity: d.capacity ?? 0,
        pax,
        bookings_count: bookings.length,
        hotels: [...hotels],
        vehicles,
        vehicle_capacity: vehicleCapacity,
        guides,
        staff,
        routes: d.pickup_route || [],
        alerts: [
          ...(vehicleCapacity > 0 && pax > vehicleCapacity
            ? [`Capacidad de vehículos insuficiente: ${pax} pax para ${vehicleCapacity} plazas`]
            : []),
          ...(vehicles.length === 0 && pax > 0 ? ["Sin vehículo asignado"] : []),
          ...(guides.length === 0 && pax > 0 ? ["Sin guía asignado"] : []),
        ],
      };
    });

    const conflicts = [
      ...[...staffUse.entries()]
        .filter(([, uses]) => uses.length > 1)
        .map(([id, uses]) => ({ type: "staff", id, message: `Personal asignado a ${uses.length} salidas: ${uses.join(", ")}` })),
      ...[...vehicleUse.entries()]
        .filter(([, uses]) => uses.length > 1)
        .map(([id, uses]) => ({ type: "vehicle", id, message: `Vehículo asignado a ${uses.length} salidas: ${uses.join(", ")}` })),
    ];

    const totals = items.reduce(
      (acc, i) => ({
        departures: acc.departures + 1,
        pax: acc.pax + i.pax,
        vehicles: acc.vehicles + i.vehicles.length,
        guides: acc.guides + i.guides.length,
        hotels: acc.hotels + i.hotels.length,
      }),
      { departures: 0, pax: 0, vehicles: 0, guides: 0, hotels: 0 }
    );

    console.log(`[dispatch] ${dateParam ?? "hoy"}: ${items.length} salidas · ${totals.pax} pax · ${conflicts.length} conflictos`);
    return ok({ date: from.toISOString().slice(0, 10), items, totals, conflicts });
  } catch (err) {
    return fail(err);
  }
}
