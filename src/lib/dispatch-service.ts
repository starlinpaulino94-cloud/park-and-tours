import "server-only";
import { requireAtLeast, tenantCreate, tenantQuery, tenantUpdate, type TenantContext } from "@/lib/tenant";
import { companyTimeZone, dayBounds, wallTimeOf } from "@/lib/time";
import { assignmentBlock, certificationsToRenew, dayOf, type CertificationLike } from "@/lib/hr";
import {
  buildRoutes, departureWindow, resourceWindow, resourceConflicts, assignmentIsLive,
  vehicleBlock, vehicleWarnings, vehicleLabel,
  type DispatchConflict, type PlannedRoute, type ResourceUse,
} from "@/lib/dispatch";
import { refId } from "@/lib/types";

/**
 * El despacho, fuera de la ruta HTTP.
 *
 * Todo esto vivía dentro de un `GET`: sin pruebas, sin poder reutilizarse desde
 * el cron ni desde la hoja de ruta, y calculando husos con `toISOString()`. Aquí
 * se leen los datos y se decide con el dominio puro de `dispatch.ts`; lo único
 * que queda en la ruta es la sesión, el permiso y el código de respuesta.
 */

/* ════════════════════════════════════════════════════════ el día completo ══ */

export interface DispatchStaff extends Record<string, unknown> {
  _id?: string;
  role?: string | null;
  certification_blocked: boolean;
  certification_note: string | null;
  certifications_to_renew: number;
}

export interface DispatchVehicle extends Record<string, unknown> {
  _id?: string;
  /** Por qué no puede salir, `null` si puede. */
  blocked_reason: string | null;
  /** Papeles por vencer: avisan, no bloquean. */
  warnings: string[];
}

export interface DispatchItem {
  _id: string;
  product: string;
  product_id: string | null;
  departure_at: string | null;
  /** La hora en la zona de la empresa, que es la que el despacho lee. */
  departure_time: string | null;
  status: string | null;
  capacity: number;
  pax: number;
  bookings_count: number;
  hotels: string[];
  vehicles: DispatchVehicle[];
  vehicle_capacity: number;
  guides: DispatchStaff[];
  staff: DispatchStaff[];
  routes: Record<string, unknown>[];
  pickups_without_route: number;
  alerts: string[];
}

export interface DispatchPayload {
  date: string;
  timezone: string;
  items: DispatchItem[];
  totals: { departures: number; pax: number; vehicles: number; guides: number; hotels: number };
  conflicts: DispatchConflict[];
}

const asArray = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? (value as Record<string, unknown>[]) : [];

/** Todo lo que la mesa de operaciones necesita para un día. */
export async function loadDispatch(
  ctx: TenantContext & { companyId: string },
  dateParam: string | null
): Promise<DispatchPayload> {
  const timeZone = companyTimeZone(ctx.company ?? null);

  // El día se recorta en la zona de la empresa, no en la del servidor. En Vercel
  // el proceso corre en UTC: recortado ahí, la salida de las 21:00 de un martes
  // aparecería en el despacho del miércoles.
  const reference = dateParam ? new Date(`${dateParam}T12:00:00Z`) : new Date();
  const { start: from, end: to } = dayBounds(reference, timeZone);
  const day = dayOf(from.toISOString()) ?? new Date().toISOString().slice(0, 10);

  // Las acreditaciones del equipo, para el mismo día: el despacho es donde se
  // decide quién sale, y enseñar aquí la licencia vencida evita descubrirla en
  // el muelle. La lista entera cabe de sobra en una consulta.
  const certificaciones = await tenantQuery<CertificationLike>(ctx.companyId, "certification", { _limit: 2000 });
  const certsPorPersona = new Map<string, CertificationLike[]>();
  for (const c of certificaciones) {
    const sid = refId(c.staff);
    if (!sid) continue;
    certsPorPersona.set(sid, [...(certsPorPersona.get(sid) || []), c]);
  }

  const departures = await tenantQuery<Record<string, unknown>>(ctx.companyId, "departure", {
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

  const usos: ResourceUse[] = [];

  const items: DispatchItem[] = departures.map((d) => {
    const departureId = String(d._id ?? "");
    const bookings = asArray(d.booking);
    const pax = bookings.reduce((s, b) => s + (Number(b.pax_total) || 0), 0);

    const hotels = new Set<string>();
    for (const b of bookings) {
      const h = b.pickup_hotel;
      if (h && typeof h === "object" && (h as { name?: string }).name) {
        hotels.add(String((h as { name?: string }).name));
      }
    }

    const ventana = departureWindow(d as never);
    const productName = (d.product && typeof d.product === "object"
      ? String((d.product as { name?: string }).name ?? "Salida")
      : "Salida");
    const horaLocal = d.departure_at ? wallTimeOf(new Date(String(d.departure_at)), timeZone) : null;
    const etiqueta = `${productName}${horaLocal ? ` ${horaLocal}` : ""}`;

    const resources = asArray(d.departure_resource);

    const vehicles: DispatchVehicle[] = [];
    const staff: DispatchStaff[] = [];

    for (const r of resources) {
      const vivo = assignmentIsLive(r as never);

      if (r.vehicle && typeof r.vehicle === "object") {
        const v = r.vehicle as Record<string, unknown>;
        const bloqueo = vehicleBlock(v as never, day);
        vehicles.push({ ...v, blocked_reason: bloqueo?.reason ?? null, warnings: vehicleWarnings(v as never, day) });
        const vid = String(v._id ?? "");
        if (vid && vivo && ventana) {
          usos.push({
            kind: "vehicle", resourceId: vid, resourceName: vehicleLabel(v as never),
            departureId, departureLabel: etiqueta,
            window: resourceWindow(r as never, ventana, timeZone),
          });
        }
      }

      if (r.staff && typeof r.staff === "object") {
        const s = r.staff as Record<string, unknown>;
        const sid = String(s._id ?? "");
        const misCerts = certsPorPersona.get(sid) || [];
        const bloqueo = assignmentBlock(misCerts, day);
        staff.push({
          ...s,
          role: (r.resource_role as string) ?? null,
          certification_blocked: Boolean(bloqueo),
          certification_note: bloqueo?.reason ?? null,
          certifications_to_renew: certificationsToRenew(misCerts, day).length,
        });
        if (sid && vivo && ventana) {
          usos.push({
            kind: "staff", resourceId: sid, resourceName: String(s.full_name || "Personal"),
            departureId, departureLabel: etiqueta,
            window: resourceWindow(r as never, ventana, timeZone),
          });
        }
      }
    }

    const guides = staff.filter((s) => s.role === "guide" || s.staff_type === "guide");
    const vehicleCapacity = vehicles.reduce((s, v) => s + (Number(v.capacity) || 0), 0);

    const rutas = asArray(d.pickup_route);
    const conRuta = new Set<string>();
    for (const r of rutas) for (const p of asArray(r.pickup)) conRuta.add(String(p._id ?? ""));
    const conHotel = bookings.filter((b) => b.pickup_hotel).length;

    return {
      _id: departureId,
      product: productName,
      product_id: d.product && typeof d.product === "object" ? String((d.product as { _id?: string })._id ?? "") : null,
      departure_at: (d.departure_at as string) ?? null,
      departure_time: horaLocal,
      status: (d.status as string) ?? null,
      capacity: Number(d.capacity) || 0,
      pax,
      bookings_count: bookings.length,
      hotels: [...hotels],
      vehicles,
      vehicle_capacity: vehicleCapacity,
      guides,
      staff,
      routes: rutas,
      pickups_without_route: Math.max(0, conHotel - conRuta.size),
      alerts: [
        ...(vehicleCapacity > 0 && pax > vehicleCapacity
          ? [`Capacidad de vehículos insuficiente: ${pax} pax para ${vehicleCapacity} plazas`]
          : []),
        ...(vehicles.length === 0 && pax > 0 ? ["Sin vehículo asignado"] : []),
        ...(guides.length === 0 && pax > 0 ? ["Sin guía asignado"] : []),
        // Las alertas nombran a la persona y al vehículo: «hay algo vencido»
        // obliga a abrir cinco fichas para saber qué sustituir.
        ...staff.filter((s) => s.certification_blocked).map((s) => `${s.full_name || "Personal"}: ${s.certification_note}`),
        ...vehicles.filter((v) => v.blocked_reason).map((v) => String(v.blocked_reason)),
        ...(conHotel > conRuta.size && rutas.length > 0
          ? [`${conHotel - conRuta.size} recogidas sin ruta asignada`]
          : []),
      ],
    };
  });

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

  const conflicts = resourceConflicts(usos);

  console.log(
    `[dispatch] ${day}: ${items.length} salidas · ${totals.pax} pax · ${conflicts.length} choques reales`
  );

  return { date: day, timezone: timeZone, items, totals, conflicts };
}

/* ═══════════════════════════════════════════════════ armar y persistir ══ */

export interface BuildDayResult {
  departureId: string;
  routes: PlannedRoute[];
  warnings: string[];
  created: number;
  updated: number;
  stopsAssigned: number;
}

/**
 * Arma las rutas de una salida y las guarda.
 *
 * DOS COSAS QUE NO HACE, Y QUE SON LA RAZÓN DE QUE SE PUEDA REPETIR:
 *
 * No toca las rutas hechas a mano (las que no tienen `auto_key`), ni las
 * recogidas que ya están en una de ellas. Alguien las puso ahí por algo.
 *
 * No borra y rehace: actualiza la ruta con la misma huella. Borrar perdería el
 * conductor y el guía que el despacho asignó, que es trabajo humano y no se
 * puede regenerar.
 */
export async function buildDayRoutes(
  ctx: TenantContext & { companyId: string },
  departureId: string
): Promise<BuildDayResult> {
  requireAtLeast(ctx, "operations");
  const timeZone = companyTimeZone(ctx.company ?? null);
  const today = dayOf(new Date().toISOString())!;

  const [departures, rutasExistentes, zones] = await Promise.all([
    tenantQuery<Record<string, unknown>>(ctx.companyId, "departure", {
      _filter: { _id: departureId }, _limit: 1,
      product: true,
      departure_resource: { _limit: 60, vehicle: true },
    }),
    tenantQuery<Record<string, unknown>>(ctx.companyId, "pickup_route", {
      _filter: { departure: departureId }, _limit: 100,
      pickup: { _limit: 300 },
    }),
    tenantQuery<Record<string, unknown>>(ctx.companyId, "zone", { _limit: 300 }),
  ]);

  const departure = departures[0];
  if (!departure) throw Object.assign(new Error("Salida no encontrada"), { status: 404 });

  const bookings = await tenantQuery<Record<string, unknown>>(ctx.companyId, "booking", {
    _filter: { departure: departureId, status: { nin: ["cancelled", "refunded"] } },
    _limit: 500,
    pickup_hotel: { zone: true },
  });
  const bookingIds = new Set(bookings.map((b) => String(b._id ?? "")));

  const pickups = await tenantQuery<Record<string, unknown>>(ctx.companyId, "pickup", {
    _filter: { booking: { in: [...bookingIds] } }, _limit: 500,
    hotel: { zone: true },
  });

  // Las recogidas colocadas a mano se respetan: solo se planifican las libres y
  // las que están en una ruta que armó el motor.
  const manuales = new Set<string>();
  for (const r of rutasExistentes) {
    if (r.auto_key) continue;
    for (const p of asArray(r.pickup)) manuales.add(String(p._id ?? ""));
  }
  const planificables = pickups.filter((p) => !manuales.has(String(p._id ?? "")));

  const hotels = pickups
    .map((p) => p.hotel)
    .filter((h): h is Record<string, unknown> => Boolean(h && typeof h === "object"));

  const vehicles = asArray(departure.departure_resource)
    .filter((r) => assignmentIsLive(r as never) && r.vehicle && typeof r.vehicle === "object")
    .map((r) => r.vehicle as Record<string, unknown>);

  const { routes, warnings } = buildRoutes({
    departure: departure as never,
    pickups: planificables as never,
    hotels: hotels as never,
    zones: zones as never,
    vehicles: vehicles as never,
    timeZone,
    today,
  });

  /* ── guardar ─────────────────────────────────────────────────────────────── */
  const porHuella = new Map<string, Record<string, unknown>>();
  for (const r of rutasExistentes) {
    if (r.auto_key) porHuella.set(String(r.auto_key), r);
  }

  let created = 0;
  let updated = 0;
  let stopsAssigned = 0;

  for (const plan of routes) {
    const existente = porHuella.get(plan.autoKey);
    const campos = {
      departure: departureId,
      zone: plan.zoneId ?? null,
      name: plan.name,
      start_time: plan.startTime,
      pax_total: plan.paxTotal,
      stops_count: plan.stopsCount,
      auto_key: plan.autoKey,
    };

    let routeId: string;
    if (existente) {
      // El vehículo solo se propone cuando la ruta no tiene ninguno: si el
      // despacho ya eligió uno, esa decisión gana sobre la del motor.
      const conserva = existente.vehicle ? {} : { vehicle: plan.vehicleId ?? null };
      await tenantUpdate(ctx.companyId, "pickup_route", String(existente._id), { ...campos, ...conserva });
      routeId = String(existente._id);
      updated += 1;
    } else {
      const nueva = await tenantCreate<Record<string, unknown>>(ctx.companyId, "pickup_route", {
        ...campos, vehicle: plan.vehicleId ?? null, status: "planned",
      });
      routeId = String(nueva._id);
      created += 1;
    }

    for (const stop of plan.stops) {
      // `pickup_time` NO se toca: es lo que el cliente tiene en su voucher.
      await tenantUpdate(ctx.companyId, "pickup", stop.pickupId, {
        route: routeId,
        sequence: stop.sequence,
        planned_time: stop.plannedTime,
      });
      stopsAssigned += 1;
    }
    porHuella.delete(plan.autoKey);
  }

  // Las rutas automáticas que ya no arma el motor —la zona se quedó sin gente—
  // se vacían y se cancelan. Borrarlas dejaría a sus recogidas apuntando a una
  // ruta que ya no existe.
  for (const sobrante of porHuella.values()) {
    for (const p of asArray(sobrante.pickup)) {
      await tenantUpdate(ctx.companyId, "pickup", String(p._id), { route: null, sequence: null });
    }
    await tenantUpdate(ctx.companyId, "pickup_route", String(sobrante._id), {
      status: "cancelled", pax_total: 0, stops_count: 0,
    });
  }

  console.log(
    `[dispatch] salida ${departureId}: ${routes.length} rutas (${created} nuevas, ${updated} actualizadas) · ` +
      `${stopsAssigned} paradas · ${warnings.length} avisos`
  );

  return { departureId, routes, warnings, created, updated, stopsAssigned };
}

/* ═════════════════════════════════════════════════════════ hoja de ruta ══ */

export interface RunSheetStop {
  sequence: number;
  time: string | null;
  planned_time: string | null;
  hotel: string;
  location: string;
  room: string | null;
  pax: number;
  customer: string | null;
  phone: string | null;
  status: string | null;
  note: string | null;
}

export interface RunSheet {
  route: Record<string, unknown>;
  departure: Record<string, unknown> | null;
  stops: RunSheetStop[];
  paxTotal: number;
}

/**
 * La hoja que el conductor se lleva: paradas en orden, con la hora, el hotel,
 * la habitación y a quién busca.
 *
 * Va ordenada por `sequence` y, si falta, por la hora: una hoja de ruta
 * desordenada obliga a decidir el recorrido en la calle, que es justo lo que
 * esta pantalla existe para evitar.
 */
export async function loadRunSheet(companyId: string, routeId: string): Promise<RunSheet> {
  const rutas = await tenantQuery<Record<string, unknown>>(companyId, "pickup_route", {
    _filter: { _id: routeId }, _limit: 1,
    vehicle: true, driver: true, guide: true, zone: true,
    departure: { product: true },
  });
  const route = rutas[0];
  if (!route) throw Object.assign(new Error("Ruta no encontrada"), { status: 404 });

  const pickups = await tenantQuery<Record<string, unknown>>(companyId, "pickup", {
    _filter: { route: routeId }, _limit: 300,
    _sort: { sequence: "asc" },
    hotel: true,
    booking: { customer: true },
  });

  const stops: RunSheetStop[] = pickups
    .map((p) => {
      const hotel = (p.hotel as Record<string, unknown>) ?? null;
      const booking = (p.booking as Record<string, unknown>) ?? null;
      const customer = (booking?.customer as Record<string, unknown>) ?? null;
      const nombre = customer
        ? [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim() || null
        : null;
      const hotelName = String(hotel?.name || "Sin hotel");
      return {
        sequence: Number(p.sequence) || 0,
        time: (p.pickup_time as string) || (p.planned_time as string) || null,
        planned_time: (p.planned_time as string) || null,
        hotel: hotelName,
        location: String(p.location || hotel?.pickup_point || hotelName),
        room: (p.room as string) || null,
        pax: Number(p.pax) || 0,
        customer: nombre,
        phone: (customer?.phone as string) || (customer?.whatsapp as string) || null,
        status: (p.status as string) ?? null,
        note: (p.notes as string) || null,
      };
    })
    .sort((a, b) => {
      if (a.sequence && b.sequence && a.sequence !== b.sequence) return a.sequence - b.sequence;
      if (a.sequence !== b.sequence) return (a.sequence || 9999) - (b.sequence || 9999);
      return String(a.time ?? "99:99").localeCompare(String(b.time ?? "99:99"));
    });

  return {
    route,
    departure: (route.departure as Record<string, unknown>) ?? null,
    stops,
    paxTotal: stops.reduce((s, x) => s + x.pax, 0),
  };
}
