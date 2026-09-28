import "server-only";
import { tenantQuery, tenantUpdate, TenantError } from "@/lib/tenant";
import { supabaseService } from "@/lib/supabase/service";
import { refId } from "@/lib/types";
import { leerTodoElRecurso } from "@/lib/barrido";
import {
  pickAllotment, allotmentState, saleBlocker, SALE_BLOCK_MESSAGE,
  shouldRelease, releasableSeats, allotmentMatrix,
  type AllotmentRow, type AllotmentState, type MatrixCell,
} from "@/lib/allotments";

/**
 * El cupo del socio contra la base.
 *
 * Tres decisiones que no son obvias:
 *
 *  · **El cupo se consume en la VENTA, no al confirmar.** Entre reservar y
 *    confirmar pasan días, y en esos días el socio puede vender la misma plaza
 *    dos veces. Apartarla al vender es lo que hace que un cupo signifique algo.
 *
 *  · **Cancelar devuelve la plaza a SU cupo, no al que aplicaría hoy.** Por eso
 *    la reserva guarda qué cupo consumió y cuántas plazas: si el contrato
 *    cambió de temporada entre la venta y la cancelación, devolverlo al cupo
 *    vigente le regalaría plazas a la temporada nueva.
 *
 *  · **Un cupo sin plazas NO bloquea a la operadora, solo al socio.** El
 *    vendedor de la casa sigue vendiendo contra la capacidad de la salida: el
 *    cupo es un contrato con la agencia, no un límite del negocio.
 */

const int = (v: unknown) => Math.max(0, Math.floor(Number(v ?? 0) || 0));

/** Los cupos activos de un socio. */
export async function allotmentsOf(companyId: string, partnerId: string): Promise<AllotmentRow[]> {
  return tenantQuery<AllotmentRow>(companyId, "allotment", {
    _filter: { partner: partnerId, status: "active" },
    _limit: 500,
  });
}

export interface AllotmentQuery {
  partnerId: string;
  productId?: string | null;
  departureId?: string | null;
  travelDate?: string | null;
}

/** El cupo que aplica a esta venta y cómo está. */
export async function resolveAllotment(
  companyId: string,
  query: AllotmentQuery
): Promise<{ row: AllotmentRow | null; state: AllotmentState }> {
  const rows = await allotmentsOf(companyId, query.partnerId);
  const row = pickAllotment(rows, query);
  return { row, state: allotmentState(row) };
}

/**
 * Impide que el socio venda por encima de su contrato.
 *
 * 409 y no 403: no le faltan permisos —es que no le quedan plazas—, y el
 * mensaje lo dice para que el comercial pueda ampliarle el cupo en vez de
 * quedarse mirando un «prohibido».
 */
export async function assertAllotment(
  companyId: string,
  query: AllotmentQuery,
  pax: number
): Promise<{ row: AllotmentRow | null; state: AllotmentState }> {
  const resolved = await resolveAllotment(companyId, query);
  const block = saleBlocker(resolved.state, pax);
  if (block) {
    throw Object.assign(new TenantError(SALE_BLOCK_MESSAGE[block], 409), {
      code: `ALLOTMENT_${block.toUpperCase()}`,
      remaining: Number.isFinite(resolved.state.remaining) ? resolved.state.remaining : null,
    });
  }
  return resolved;
}

/**
 * RECLAMA plazas del cupo. No las apunta: las coge (0100).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE HACÍA ANTES, Y LO QUE COSTABA
 *
 * Escribía `seats_used = <lo que leyó `assertAllotment` al empezar la venta> +
 * pax`. Un valor ABSOLUTO calculado sobre una lectura vieja, con la venta
 * entera de por medio —precio, capacidad de la salida, reservas, cobro,
 * monedero—.
 *
 * Medido: treinta ventas simultáneas de una plaza contra un cupo garantizado
 * de 10 dejaban `seats_used` en **2**, y las treinta pasaban. No es que se
 * pasara del tope: es que el contador se PERDÍA. El socio vendía 30 plazas de
 * un contrato de 10 y la matriz enseñaba «2 usadas, 8 libres», así que el
 * comercial volvía a vender el mismo hueco. Ni siquiera hace falta
 * concurrencia: dos ventas que se solapen un instante ya se pisan.
 *
 * Ahora es una sola sentencia en la base que incrementa SI CABE y dice si
 * cupo. Sin lectura previa, no hay ventana.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y SÍ TUMBA LA VENTA, QUE ES EL CAMBIO
 *
 * Antes no: «un contador mal puesto no puede dejar a un cliente sin su
 * reserva». Pero eso convertía el cupo en un adorno —la única comprobación
 * real era la lectura vieja de `assertAllotment`— y el contrato con la agencia
 * en una sugerencia.
 *
 * Que no quepa aquí significa que otra venta se llevó las plazas mientras ésta
 * se armaba, que es exactamente lo que `assertAllotment` rechaza con un 409 y
 * el mismo mensaje. Por eso se reclama ANTES de escribir la venta, y quien
 * reclama suelta si la venta se cae.
 *
 * Solo los cupos que APARTAN plazas llevan cuenta: en venta libre `seats_used`
 * sería un contador sin significado que además hay que mantener. Esa regla se
 * queda aquí y no baja a la base, para no tener dos sitios donde se decide lo
 * mismo.
 */
export async function consumeAllotment(
  companyId: string,
  row: AllotmentRow | null,
  pax: number
): Promise<{ allotmentId: string; seats: number } | null> {
  const state = allotmentState(row);
  if (!row || !state.holds || int(pax) <= 0) return null;
  const id = String(row._id || row.id || "");
  if (!id) return null;

  const { data, error } = await supabaseService().rpc("claim_allotment_seats", {
    p_allotment: id,
    p_pax: int(pax),
  });

  /**
   * Un fallo de lectura NO deja pasar la venta.
   *
   * Antes se escribía en la consola y se seguía, que es vender contra un
   * contrato sin saber si queda sitio. Misma decisión que `assertCapacity`:
   * ante la duda, se rechaza. Lo que se pierde es una venta; lo que se evitaba
   * perder era el contrato.
   */
  if (error) {
    throw Object.assign(
      new TenantError(`No se pudo reclamar el cupo del socio: ${error.message}`, 409),
      { code: "ALLOTMENT_UNAVAILABLE" }
    );
  }
  if (data !== true) {
    throw Object.assign(new TenantError(SALE_BLOCK_MESSAGE.no_seats, 409), {
      code: "ALLOTMENT_NO_SEATS",
      remaining: Number.isFinite(state.remaining) ? state.remaining : null,
    });
  }

  return { allotmentId: id, seats: int(pax) };
}

/**
 * Devuelve al cupo las plazas de una reserva cancelada.
 *
 * Se devuelve a SU cupo y por SUS plazas, las que la reserva guardó. Nunca baja
 * de cero: si alguien editó `seats_used` a mano por el camino, un negativo aquí
 * dejaría el cupo prometiendo plazas que no existen.
 */
export async function releaseBookingAllotment(
  companyId: string,
  booking: { allotment?: unknown; allotment_seats?: number | null }
): Promise<number> {
  const id = refId(booking.allotment);
  const seats = int(booking.allotment_seats);
  if (!id || seats <= 0) return 0;

  /**
   * También en una sola sentencia, y por lo mismo (0100).
   *
   * Leía la fila y escribía `max(0, leído - plazas)`. Dos cancelaciones a la
   * vez devolvían UNA sola plaza, y el socio se quedaba sin cupo que sí había
   * pagado — el error que nadie reclama, porque nadie mira un contador que va
   * de menos.
   *
   * Al revés que el reclamo, un fallo aquí no tumba nada: no devolver una
   * plaza deja un cupo corto y eso se arregla; tumbar la cancelación de un
   * cliente porque el contador no respondió, no.
   */
  try {
    const { data, error } = await supabaseService().rpc("release_allotment_seats", {
      p_allotment: id,
      p_pax: seats,
    });
    if (error) {
      console.error(`[cupo] no se pudieron devolver las plazas al cupo ${id}:`, error.message);
      return 0;
    }
    return int(data);
  } catch (err) {
    console.error(`[cupo] no se pudieron devolver las plazas al cupo ${id}:`, err);
    return 0;
  }
}

export interface ReleaseReport {
  reviewed: number;
  released: number;
  seats: number;
  details: { allotmentId: string; seats: number; departureAt: string }[];
}

/**
 * La liberación automática: lo que el socio no vendió vuelve a la venta libre.
 *
 * Solo toca cupos GARANTIZADOS atados a una salida concreta: un cupo de
 * producto sin salida no tiene fecha contra la que contar los días, y liberarlo
 * «por si acaso» le quitaría plazas a un contrato que sigue vigente.
 *
 * Es idempotente: `seats_released` acumula, así que un segundo barrido del
 * mismo día no encuentra nada que liberar.
 */
export async function releaseExpiredAllotments(
  companyId: string,
  now: Date = new Date()
): Promise<ReleaseReport> {
  const out: ReleaseReport = { reviewed: 0, released: 0, seats: 0, details: [] };

  // Entero: lo que se quede fuera son plazas garantizadas a un socio que ya no
  // las va a usar y que nadie más puede vender. Y como el orden no cambia entre
  // pasadas, serían siempre las mismas.
  const rows = await leerTodoElRecurso<AllotmentRow>("allotment", (limite, salto) =>
    tenantQuery(companyId, "allotment", {
      _filter: { allotment_type: "guaranteed", status: "active" },
      departure: true,
      _sort: { created_at: "asc", _id: "asc" },
      _limit: limite, _offset: salto,
    }));

  for (const row of rows) {
    const departure = row.departure as { _id?: string; departure_at?: string } | null;
    const departureAt = departure?.departure_at;
    if (!departureAt) continue;
    out.reviewed += 1;

    if (!shouldRelease(row, departureAt, now)) continue;
    const seats = releasableSeats(row);
    if (seats <= 0) continue;

    const id = String(row._id || row.id || "");
    try {
      await tenantUpdate(companyId, "allotment", id, {
        seats_released: int(row.seats_released) + seats,
        released_at: now.toISOString(),
        release_runs: int((row as { release_runs?: number }).release_runs) + 1,
      });
      out.released += 1;
      out.seats += seats;
      out.details.push({ allotmentId: id, seats, departureAt });
    } catch (err) {
      console.error(`[cupo] no se pudo liberar ${id}:`, err);
    }
  }

  if (out.released > 0) {
    console.log(`[cupo] ${out.released} cupos liberados, ${out.seats} plazas devueltas a venta libre`);
  }
  return out;
}

/** La matriz de un socio: qué le queda día a día. */
export async function partnerMatrix(
  companyId: string,
  partnerId: string,
  dates: string[],
  productId?: string | null
): Promise<MatrixCell[]> {
  const rows = await allotmentsOf(companyId, partnerId);
  return allotmentMatrix(rows, partnerId, dates, productId);
}
