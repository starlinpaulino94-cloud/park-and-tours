import "server-only";
import {
  tenantCreate, tenantFindOne, tenantQuery, tenantUpdate, TenantError,
} from "@/lib/tenant";

/**
 * "Activo caído → cupo caído."
 *
 * When an asset that carries capacity leaves service, the seats it was
 * providing stop existing. Selling them anyway is how a park ends up with 60
 * paid guests and a boat for 40. So a status change here does three things:
 *
 *   1. recomputes the capacity of every future departure that consumes the asset,
 *   2. blocks sales on the departures that can no longer be served,
 *   3. surfaces the bookings already sold above the new capacity, so a human
 *      decides who gets moved — the system never silently cancels a guest.
 *
 * Returning the asset to service reverses steps 1 and 2.
 */

export type AssetStatus = "in_service" | "maintenance" | "out_of_service" | "retired";

const DOWN: AssetStatus[] = ["maintenance", "out_of_service", "retired"];

export interface AssetImpact {
  assetId: string;
  assetName: string;
  from: string;
  to: string;
  blocksCapacity: boolean;
  seatsLost: number;
  departuresAffected: {
    _id: string;
    product: string;
    departureAt: string | null;
    capacityBefore: number;
    capacityAfter: number;
    bookedPax: number;
    /** Guests sold beyond what can now be served. */
    oversold: number;
    closed: boolean;
  }[];
  bookingsAtRisk: { _id: string; bookingNumber: string; pax: number; customer: string }[];
}

/**
 * Future departures that consume this asset, resolved through the
 * `departure_resource` assignments and the asset's linked vehicle.
 */
async function departuresUsing(companyId: string, asset: any) {
  const vehicleId = typeof asset.vehicle === "object" ? asset.vehicle?._id : asset.vehicle;
  if (!vehicleId) return [];

  const assignments = await tenantQuery<any>(companyId, "departure_resource", {
    departure: { product: true },
    _filter: {
      vehicle: vehicleId,
      status: { in: ["planned", "confirmed", "in_progress"] },
    },
    _limit: 500,
  });

  const now = new Date();
  return assignments
    .map((a) => a.departure)
    .filter((d: any) => d && (!d.departure_at || new Date(d.departure_at) >= now));
}

/**
 * Applies a status change and propagates it to sellable capacity.
 * `dryRun` computes the impact without writing anything — used by the UI to
 * show the consequence before the operator confirms.
 */
export async function changeAssetStatus(
  companyId: string,
  assetId: string,
  to: AssetStatus,
  opts: { reason?: string | null; userId?: string; dryRun?: boolean } = {}
): Promise<AssetImpact> {
  const asset = await tenantFindOne<any>(companyId, "asset", assetId, { vehicle: true, attraction: true });
  const from = (asset.operational_status as string) || "in_service";
  if (from === to && !opts.dryRun) {
    throw new TenantError(`El activo ya está en estado "${to}"`, 400);
  }

  const goingDown = DOWN.includes(to);
  const blocksCapacity = asset.blocks_capacity === "yes";
  const assetCapacity = Number(asset.capacity ?? 0);

  const impact: AssetImpact = {
    assetId,
    assetName: asset.name || assetId,
    from,
    to,
    blocksCapacity,
    seatsLost: goingDown && blocksCapacity ? assetCapacity : 0,
    departuresAffected: [],
    bookingsAtRisk: [],
  };

  const departures = blocksCapacity ? await departuresUsing(companyId, asset) : [];

  for (const dep of departures) {
    const capacityBefore = Number(dep.capacity ?? 0);
    const bookedPax = Number(dep.booked_pax ?? 0);
    const capacityAfter = goingDown
      ? Math.max(0, capacityBefore - assetCapacity)
      : capacityBefore + assetCapacity;
    const oversold = Math.max(0, bookedPax - capacityAfter);
    const closed = goingDown && capacityAfter <= bookedPax;

    impact.departuresAffected.push({
      _id: dep._id,
      product: dep.product?.name || "—",
      departureAt: dep.departure_at || null,
      capacityBefore,
      capacityAfter,
      bookedPax,
      oversold,
      closed,
    });

    if (opts.dryRun) continue;

    await tenantUpdate(companyId, "departure", dep._id, {
      capacity: capacityAfter,
      available_pax: Math.max(0, capacityAfter - bookedPax),
      // Closing the departure is what actually stops the next sale.
      status: closed ? "closed" : capacityAfter > bookedPax ? "available" : dep.status,
      notes: [dep.notes, goingDown
        ? `Cupo reducido por ${asset.name} fuera de servicio${opts.reason ? `: ${opts.reason}` : ""}.`
        : `Cupo restituido: ${asset.name} volvió a servicio.`].filter(Boolean).join(" "),
    });

    // Bookings sold above the new capacity need a human decision.
    if (oversold > 0) {
      const bookings = await tenantQuery<any>(companyId, "booking", {
        customer: true,
        _filter: {
          departure: dep._id,
          status: { in: ["pending", "pending_payment", "confirmed", "partially_paid", "paid"] },
        },
        _sort: { booking_date: "desc" },
        _limit: 100,
      });
      let remaining = oversold;
      for (const b of bookings) {
        if (remaining <= 0) break;
        impact.bookingsAtRisk.push({
          _id: b._id,
          bookingNumber: b.booking_number || b._id,
          pax: Number(b.pax_total ?? 0),
          customer: `${b.customer?.first_name || ""} ${b.customer?.last_name || ""}`.trim() || "Cliente",
        });
        remaining -= Number(b.pax_total ?? 0);
      }
    }
  }

  if (opts.dryRun) return impact;

  await tenantUpdate(companyId, "asset", assetId, {
    operational_status: to,
    ...(goingDown ? {} : { downtime_minutes_month: Number(asset.downtime_minutes_month ?? 0) }),
  });

  // An attraction backed by this asset follows it down, and the change is logged.
  const attractionId = typeof asset.attraction === "object" ? asset.attraction?._id : asset.attraction;
  if (attractionId) {
    const attractionStatus = goingDown ? "maintenance" : "open";
    await tenantUpdate(companyId, "attraction", attractionId, {
      operational_status: attractionStatus,
      last_status_at: new Date().toISOString(),
    });
    await tenantCreate(companyId, "attraction_log", {
      attraction: attractionId,
      logged_at: new Date().toISOString(),
      event_type: "status_change",
      from_status: asset.attraction?.operational_status || null,
      to_status: attractionStatus,
      reason: `Activo ${asset.name}: ${from} → ${to}${opts.reason ? `. ${opts.reason}` : ""}`,
      user: opts.userId || null,
    });
  }

  // One task per affected departure so nobody has to remember to call the guests.
  if (impact.bookingsAtRisk.length > 0) {
    await tenantCreate(companyId, "task", {
      title: `Reubicar ${impact.bookingsAtRisk.length} reserva(s) por ${asset.name} fuera de servicio`,
      description:
        `El activo ${asset.name} pasó a "${to}". Las siguientes reservas quedaron sobre el cupo disponible: ` +
        impact.bookingsAtRisk.map((b) => `${b.bookingNumber} (${b.pax} pax)`).join(", ") +
        ". Contacta a los clientes para reubicar o reembolsar.",
      status: "todo",
      priority: "urgent",
      task_type: "operational",
      source: "automatic",
      due_at: new Date().toISOString(),
      assigned_to: opts.userId || null,
    });
  }

  console.log(
    `[asset-impact] ${asset.name}: ${from} → ${to}. ` +
    `Salidas afectadas=${impact.departuresAffected.length}, reservas en riesgo=${impact.bookingsAtRisk.length}`
  );
  return impact;
}
