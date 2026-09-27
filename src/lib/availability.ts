import "server-only";
import { tenantQuery, tenantUpdate } from "@/lib/tenant";
import { supabaseService } from "@/lib/supabase/service";
import type { Departure, DepartureStatus } from "@/lib/types";

/**
 * Availability engine — the single guard against overselling.
 *
 * Confirmed + pending passengers are recomputed from the bookings themselves so
 * the counters can never silently drift out of sync with reality.
 */

/**
 * Las dos listas son la ÚNICA definición de qué cuenta, y viajan a la base como
 * argumento (0094). Antes había además una tercera —`ACTIVE_STATUSES`— que era
 * exactamente la unión de estas dos y servía de filtro de la consulta: dos
 * copias de la misma regla, y la que se quedara vieja habría dejado reservas
 * fuera de la suma sin que nada lo dijera.
 */
const CONFIRMED_STATUSES = ["confirmed", "partially_paid", "paid", "checked_in", "completed"];
const PENDING_STATUSES = ["pending", "pending_payment"];

export interface AvailabilityState {
  departureId: string;
  capacity: number;
  bookedPax: number;
  pendingPax: number;
  /** Plazas retenidas por ventas en curso que aún no escribieron su reserva (0099). */
  heldPax: number;
  availablePax: number;
  status: DepartureStatus;
  departureAt: string | null;
  cutoffHours: number;
}

export class OversellError extends Error {
  constructor(readonly available: number, readonly requested: number) {
    super(
      `Cupo insuficiente: quedan ${available} plazas y se solicitaron ${requested}. ` +
        `Un usuario autorizado puede forzar la reserva dejando registro de auditoría.`
    );
    this.name = "OversellError";
  }
}

function deriveStatus(capacity: number, booked: number, current?: DepartureStatus): DepartureStatus {
  if (current === "cancelled" || current === "closed" || current === "completed") return current;
  if (capacity <= 0) return "available";
  const ratio = booked / capacity;
  if (booked >= capacity) return "full";
  if (ratio >= 0.85) return "almost_full";
  return "available";
}

/**
 * LOS PASAJEROS DE LA SALIDA, CONTADOS EN LA BASE (0094).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTO LEÍA CON `_limit: 1000`
 *
 * Una salida de entrada general de un parque —dos mil entradas al día— pasa de
 * mil reservas sin nada raro. Y pasado el tope la suma salía CORTA, así que
 * `available_pax` salía ALTA y `assertCapacity` dejaba pasar la venta que no
 * cabía. La guarda no fallaba: aprobaba. Y los contadores escritos en la salida
 * quedaban por debajo de la realidad, así que el despacho, la previsión de
 * ocupación y el semáforo de «casi llena» mentían los tres a la vez y en la
 * misma dirección.
 *
 * Es justo lo contrario de lo que promete la cabecera de este módulo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO SE PAGINA
 *
 * Esto corre en CADA venta. Con una salida de cinco mil reservas, paginar
 * traería cinco mil filas por cada entrada vendida para sumar dos números: la
 * operadora que más vende sería la que más lento vende. Una suma es lo que una
 * base hace mejor que nadie, y así vuelve una sola fila, exacta y sin tope.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LAS LISTAS DE ESTADOS VIAJAN COMO ARGUMENTO
 *
 * Y es deliberado: qué cuenta como confirmada y qué como pendiente lo decide
 * ESTE fichero, que es donde está escrito y probado. Copiar las listas a la
 * función de la base habría dejado dos copias de la misma regla, y de dos
 * copias la que se queda vieja es siempre la que nadie mira.
 */
async function paxDeLaSalida(
  companyId: string,
  departureId: string
): Promise<{ booked: number; pending: number; held: number }> {
  const { data, error } = await supabaseService().rpc("departure_pax_totals", {
    p_org: companyId,
    p_departure: departureId,
    p_confirmed: CONFIRMED_STATUSES,
    p_pending: PENDING_STATUSES,
  });

  /**
   * UN RECUENTO QUE NO SE PUDO HACER NO ES CERO.
   *
   * Devolver ceros aquí sería decir «la salida está vacía», y el efecto de eso
   * es que cabe todo el mundo: la sobreventa entraría por el hueco de una
   * consulta caída. Se lanza, y la venta no se registra — que es la respuesta
   * correcta cuando no se sabe si hay sitio.
   */
  if (error) {
    throw new Error(`No se pudieron contar los pasajeros de la salida ${departureId}: ${error.message}`);
  }
   const fila = data as { found?: boolean; booked?: number; pending?: number; held?: number } | null;
  if (!fila || fila.found !== true) throw new Error("Salida no encontrada");

  return {
    booked: Number(fila.booked ?? 0),
    pending: Number(fila.pending ?? 0),
    held: Number(fila.held ?? 0),
  };
}

/** Recomputes a departure's occupancy from its bookings and persists the counters. */
export async function recalculateDeparture(
  companyId: string,
  departureId: string
): Promise<AvailabilityState> {
  const [departures, totales] = await Promise.all([
    tenantQuery<Departure>(companyId, "departure", { _filter: { _id: departureId }, _limit: 1 }),
    paxDeLaSalida(companyId, departureId),
  ]);

  const departure = departures[0] ?? null;
  if (!departure) throw new Error("Salida no encontrada");

  const { booked: bookedPax, pending: pendingPax, held: heldPax } = totales;

  const capacity = departure.capacity ?? 0;
  const ocupadas = bookedPax + pendingPax + heldPax;
  const availablePax = Math.max(0, capacity - ocupadas);
  const status = deriveStatus(capacity, ocupadas, departure.status);

  /**
   * LO QUE ESTE RECÁLCULO NO ESCRIBE: `hold_pax`.
   *
   * Es deliberado y es la mitad del arreglo de 0099. Las retenciones las lleva
   * la base —`reserve_departure_capacity` las pone, `release_...` las suelta y
   * caducan solas—, porque son las plazas de ventas que TODAVÍA no tienen fila
   * y este recálculo cuenta filas: escribirlas desde aquí sería borrarlas.
   *
   * Esa era exactamente la puerta por la que la carrera volvía a entrar: una
   * venta retiene, otra recalcula y le borra la retención, y las dos venden la
   * misma plaza. Medido: 19 reservas en una salida de 10.
   */
  await tenantUpdate(companyId, "departure", departureId, {
    booked_pax: bookedPax,
    pending_pax: pendingPax,
    available_pax: availablePax,
    status,
  });

  console.log(
    `[Availability] salida ${departureId}: cap=${capacity} conf=${bookedPax} pend=${pendingPax} ret=${heldPax} libre=${availablePax} (${status})`
  );

  return {
    departureId, capacity, bookedPax, pendingPax, heldPax, availablePax, status,
    departureAt: departure.departure_at ?? null,
    cutoffHours: departure.cutoff_hours ?? 0,
  };
}

/**
 * Verifies there is room for `pax` on the departure.
 * Throws `OversellError` unless `override` is true (which must be audited by the caller).
 */
export async function assertCapacity(
  companyId: string,
  departureId: string,
  pax: number,
  override = false
): Promise<AvailabilityState> {
  const state = await recalculateDeparture(companyId, departureId);

  if (state.status === "cancelled") throw new Error("La salida está cancelada");
  if (state.status === "closed" && !override) throw new Error("La salida está cerrada para nuevas reservas");
  if (state.status === "completed" && !override) throw new Error("La salida ya se realizó");

  // AUD-B07: reject sales on departures that have already left or are inside
  // their booking cutoff window. Previously `cutoff_hours` was stored but never
  // evaluated, so the sales-close time was purely decorative.
  if (!override && state.departureAt) {
    const departAt = new Date(state.departureAt).getTime();
    if (Number.isFinite(departAt)) {
      const cutoffMs = (state.cutoffHours ?? 0) * 3_600_000;
      if (departAt - cutoffMs <= Date.now()) {
        throw new Error(
          state.cutoffHours > 0
            ? `La salida está cerrada para reservas (cierre ${state.cutoffHours} h antes)`
            : "La salida ya no admite reservas"
        );
      }
    }
  }

  /**
   * AQUÍ SE RETIENE LA PLAZA, NO SE OPINA SOBRE ELLA (0099, F-001).
   *
   * ──────────────────────────────────────────────────────────────────────────
   * LO QUE HABÍA, Y LO QUE COSTABA
   *
   * Esto comparaba `pax > state.availablePax` — un número leído arriba — y
   * dejaba que la venta insertara sus filas después. Entre la lectura y la
   * escritura no había NADA, así que dos ventas de la última plaza pasaban las
   * dos. Medido con treinta ventas simultáneas contra una salida de diez:
   * **19 reservas**. Nueve pasajeros con asiento que no existe.
   *
   * La reserva atómica que cierra esto —`reserve_departure_capacity`, con su
   * cerrojo de fila— existe desde 0008, se escribió para esto, se endureció en
   * 0017 y en 0019, y otras tres migraciones la citan como el modo correcto de
   * hacerlo. No la llamaba nadie. La misma carrera contra ella da diez.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * POR QUÉ ES UNA RETENCIÓN Y NO UNA COMPROBACIÓN
   *
   * Porque PostgREST no da transacciones de varias sentencias: el cerrojo se
   * suelta cuando la función vuelve, así que «comprobar dentro del cerrojo» no
   * protege la inserción que viene después. Lo único que cruza esa frontera es
   * dejar la plaza COGIDA. Quien la coge la suelta —`liberarRetencion`— cuando
   * la reserva ya está escrita o cuando la venta se cae, y si nadie la suelta
   * caduca sola en dos minutos.
   *
   * El `false` no es un error de la base: es la respuesta «no cabe», y se
   * traduce al mismo `OversellError` de siempre para que quien lo captura
   * —el POS, el portal, la API— no tenga que aprender nada nuevo.
   */
  if (state.capacity > 0 && !override) {
    const { data, error } = await supabaseService().rpc("reserve_departure_capacity", {
      p_departure_id: departureId,
      p_pax: pax,
      p_override: false,
    });
    /**
     * Y UN FALLO AL RETENER NO ES UN «SÍ».
     *
     * Si la llamada revienta no se sabe si la plaza está: tragarse el error y
     * seguir sería vender a ciegas, que es el fallo del que venimos.
     */
    if (error) throw new Error(`No se pudo reservar la plaza: ${error.message}`);
    if (data !== true) {
      console.warn(`[Availability] intento de sobreventa en ${departureId}: ${pax} > ${state.availablePax}`);
      throw new OversellError(state.availablePax, pax);
    }
    return { ...state, heldPax: state.heldPax + pax, availablePax: Math.max(0, state.availablePax - pax) };
  }
  return state;
}

/**
 * Suelta las plazas retenidas por `assertCapacity`.
 *
 * Se llama en dos momentos y por el mismo motivo: la retención ya no hace
 * falta. Con la reserva escrita, quien cuenta es el recálculo; con la venta
 * caída, la plaza tiene que volver al mostrador YA y no dentro de dos minutos.
 *
 * No lanza. Una retención que no se suelta caduca sola, así que convertir esto
 * en un error rompería una venta que por lo demás salió bien — y dejaría la
 * plaza igual de cogida.
 */
export async function liberarRetencion(departureId: string, pax: number): Promise<void> {
  if (!departureId || pax < 1) return;
  const { error } = await supabaseService().rpc("release_departure_capacity", {
    p_departure_id: departureId,
    p_pax: pax,
  });
  if (error) {
    console.error(`[Availability] no se pudo soltar la retención de ${departureId}: ${error.message}`);
  }
}
