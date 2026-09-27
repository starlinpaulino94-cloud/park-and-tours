import "server-only";
import { tenantFindOne, tenantQuery } from "@/lib/tenant";
import { supabaseService } from "@/lib/supabase/service";
import {
  manifestRow, sortByRoute, pickupStops, paxSummary, manifestAlerts, closeBlocker,
  closeTotals, personName, DEAD_BOOKING_STATUSES, CLOSE_BLOCK_MESSAGE,
  type ManifestBookingInput, type ManifestRow, type PickupStop, type PaxSummary, type ManifestAlert,
} from "@/lib/manifest";

/**
 * El armado del manifiesto, en un solo sitio.
 *
 * Lo piden dos rutas —la pantalla y el PDF que el guía se lleva impreso— y las
 * dos tienen que decir exactamente lo mismo. Con la consulta duplicada bastaba
 * con que una olvidara excluir las reservas canceladas para que el papel y la
 * pantalla dieran cuentas distintas de la misma salida.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y AHORA LO PIDE TAMBIÉN UN TRABAJO SIN SESIÓN
 *
 * Desde que el manifiesto SALE por la bandeja (fase 8.8), quien lo compone es el
 * despachador, que corre desde un cron y no tiene cookies. Con
 * `SUPABASE_USE_RLS=true` —obligatorio en producción, lo exige
 * `src/lib/data-backend.ts`— las ayudas de inquilino resuelven el cliente a
 * partir de la petición: un manifiesto armado con ellas desde el cron no habría
 * fallado, habría salido VACÍO. Un PDF con cero pasajeros que se manda igual es
 * el peor fallo posible aquí, porque nadie lo nota hasta que el chofer llega al
 * hotel sin nadie que recoger.
 *
 * Así que de dónde se LEE es un parámetro, con dos implementaciones: la del
 * inquilino (la pantalla, el PDF con sesión) y la de servicio (el cron, la
 * entrega). Lo que se COMPONE con esas filas sigue siendo uno solo, que era el
 * motivo de que este módulo exista.
 */

/**
 * De dónde salen las filas del manifiesto.
 *
 * Son dos consultas y no más a propósito: cuantas más tenga esta interfaz, más
 * sitios donde las dos implementaciones pueden decir cosas distintas.
 */
export interface FuenteDelManifiesto {
  salida(companyId: string, departureId: string): Promise<Record<string, unknown>>;
  reservas(companyId: string, departureId: string): Promise<ManifestBookingInput[]>;
  /**
   * Quién opera la salida: los recursos asignados y las rutas de recogida, con
   * su personal y su empresa de transporte dentro.
   *
   * Vive aquí y no en el servicio del envío porque es la MISMA pregunta —«de
   * dónde leo el mundo de esta salida»— y porque así hay un solo sitio donde las
   * dos implementaciones pueden divergir en vez de dos.
   */
  equipo(companyId: string, departureId: string): Promise<{
    recursos: Record<string, unknown>[];
    rutas: Record<string, unknown>[];
  }>;
}

/** La de siempre: la sesión de quien está mirando la pantalla. */
export const fuenteDeInquilino: FuenteDelManifiesto = {
  salida: (companyId, departureId) =>
    tenantFindOne<Record<string, unknown>>(companyId, "departure", departureId, {
      product: true, branch: true,
      departure_resource: { _limit: 60, vehicle: true, staff: true },
      pickup_route: { _limit: 40, vehicle: true, driver: true, guide: true, zone: true },
    }),
  reservas: (companyId, departureId) =>
    tenantQuery<ManifestBookingInput>(companyId, "booking", {
      _filter: { departure: departureId },
      _limit: 500,
      _sort: { createdAt: "asc" },
      // La zona del hotel va anidada: es lo que agrupa las paradas de la ruta.
      customer: true, pickup_hotel: { zone: true }, partner: true, seller: true,
      participant: { _limit: 200 },
    }),
  equipo: async (companyId, departureId) => {
    const [recursos, rutas] = await Promise.all([
      tenantQuery<Record<string, unknown>>(companyId, "departure_resource", {
        _filter: { departure: departureId }, _limit: 60, staff: true, supplier: true,
      }),
      tenantQuery<Record<string, unknown>>(companyId, "pickup_route", {
        _filter: { departure: departureId }, _limit: 40, driver: true, guide: true, supplier: true,
      }),
    ]);
    return { recursos, rutas };
  },
};

/**
 * La de un trabajo sin sesión: llave de servicio y `organization_id` a mano.
 *
 * El filtro por empresa se escribe en las DOS consultas y no se hereda de
 * ninguna parte: con la llave de servicio no hay RLS detrás que perdone un
 * olvido, así que el aislamiento es exactamente lo que diga este `eq`.
 */
export function fuenteDeServicio(): FuenteDelManifiesto {
  return {
    async salida(companyId, departureId) {
      const { data, error } = await supabaseService()
        .from("departure")
        .select(
          "*, product:product_id (*), branch:branch_id (*), " +
          "departure_resource (*, vehicle:vehicle_id (*), staff:staff_id (*)), " +
          "pickup_route (*, vehicle:vehicle_id (*), driver:driver_id (*), guide:guide_id (*), zone:zone_id (*))"
        )
        .eq("organization_id", companyId)
        .eq("id", departureId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw Object.assign(new Error("Salida no encontrada"), { status: 404 });
      return data as unknown as Record<string, unknown>;
    },
    async reservas(companyId, departureId) {
      const { data, error } = await supabaseService()
        .from("booking")
        .select(
          "*, customer:customer_id (*), " +
          // En `booking` la columna es `hotel_id` y la aplicación la lee como
          // `pickup_hotel`: sin el alias, `manifestRow` no encuentra el hotel y
          // todas las paradas salen como «Punto de encuentro».
          "pickup_hotel:hotel_id (*, zone:zone_id (*)), " +
          "partner:partner_id (*), seller:seller_id (*), participant (*)"
        )
        .eq("organization_id", companyId)
        .eq("departure_id", departureId)
        .order("created_at", { ascending: true })
        .limit(500);
      if (error) throw new Error(error.message);
      const filas = (data ?? []) as unknown as Record<string, unknown>[];
      return filas.map((row) => ({ ...row, _id: String(row.id) })) as unknown as ManifestBookingInput[];
    },
    async equipo(companyId, departureId) {
      const sb = supabaseService();
      const [recursos, rutas] = await Promise.all([
        sb.from("departure_resource")
          .select("*, staff:staff_id (*), supplier:supplier_id (*)")
          .eq("organization_id", companyId).eq("departure_id", departureId).limit(60),
        sb.from("pickup_route")
          .select("*, driver:driver_id (*), guide:guide_id (*), supplier:supplier_id (*)")
          .eq("organization_id", companyId).eq("departure_id", departureId).limit(40),
      ]);
      if (recursos.error) throw new Error(recursos.error.message);
      if (rutas.error) throw new Error(rutas.error.message);
      const conId = (filas: unknown) =>
        ((filas ?? []) as unknown as Record<string, unknown>[]).map((r) => ({ ...r, _id: String(r.id) }));
      return { recursos: conId(recursos.data), rutas: conId(rutas.data) };
    },
  };
}

export interface ManifestPayload {
  departure: Record<string, unknown> & { _id: string };
  product: Record<string, unknown> | null;
  vehicles: Record<string, unknown>[];
  staff: Record<string, unknown>[];
  routes: Record<string, unknown>[];
  vehicleSeats: number;
  rows: ManifestRow[];
  stops: PickupStop[];
  summary: PaxSummary;
  alerts: ManifestAlert[];
  close: { blocker: string | null; message: string | null; totals: ReturnType<typeof closeTotals> };
  excluded: number;
}

export async function loadManifest(
  companyId: string,
  departureId: string,
  fuente: FuenteDelManifiesto = fuenteDeInquilino
): Promise<ManifestPayload> {
  const [departure, bookings] = await Promise.all([
    fuente.salida(companyId, departureId),
    fuente.reservas(companyId, departureId),
  ]);

  // Una reserva cancelada o reembolsada no viaja: dejarla en la lista hace que
  // el guía cuente cabezas que no existen y que el cupo parezca lleno.
  const travelling = bookings.filter((b) => !DEAD_BOOKING_STATUSES.has(String(b.status || "")));
  const rows = sortByRoute(travelling.map(manifestRow));

  const resources = (departure.departure_resource as Record<string, unknown>[]) || [];
  const vehicles = resources
    .map((r) => r.vehicle)
    .filter((v): v is Record<string, unknown> => Boolean(v && typeof v === "object"));
  const staff: Record<string, unknown>[] = resources
    .filter((r) => r.staff && typeof r.staff === "object")
    .map((r) => ({ ...(r.staff as Record<string, unknown>), resource_role: r.resource_role }));
  const guides = staff.filter((s) => s.resource_role === "guide" || s.staff_type === "guide");
  const vehicleSeats = vehicles.reduce((s, v) => s + (Number(v.capacity) || 0), 0);

  const product = (departure.product as Record<string, unknown>) || null;
  const blocker = closeBlocker(departure as never, rows);

  return {
    departure: { ...departure, _id: departureId },
    product,
    vehicles,
    staff,
    routes: (departure.pickup_route as Record<string, unknown>[]) || [],
    vehicleSeats,
    rows,
    stops: pickupStops(rows),
    summary: paxSummary(rows),
    alerts: manifestAlerts(rows, {
      capacity: Number(departure.capacity) || 0,
      vehicleSeats,
      vehicles: vehicles.length,
      guides: guides.length,
      meetingPoint: (departure.meeting_point as string) || (product?.meeting_point as string) || null,
    }),
    close: {
      blocker,
      message: blocker ? CLOSE_BLOCK_MESSAGE[blocker] : null,
      totals: closeTotals(rows),
    },
    excluded: bookings.length - travelling.length,
  };
}

/** Nombre presentable de una persona relacionada, reexportado por comodidad. */
export { personName };
