import "server-only";
import { supabaseService } from "@/lib/supabase/service";
import { tenantQuery, type TenantContext } from "@/lib/tenant";
import {
  autoResolve, validateItinerary, blockOf, dayOf, addDays, sellBlocker,
  byDay, spanDays, tightestSeats, startsAt,
  type BundleItem, type Slot, type Block, type AutoResolveResult,
} from "@/lib/bundles";
import type { Product } from "@/lib/types";

/**
 * Los combos contra la base.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LAS SALIDAS SON LAS QUE HAY
 *
 * Este servicio lee las salidas REALES de cada actividad, con las plazas que de
 * verdad quedan, y se las da al motor. El motor no inventa ninguna: un paquete
 * que «encuentra» una salida que no existe es un paquete que no se puede
 * operar, y eso se descubre el día del viaje.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL DÍA ES EL DE LA OPERADORA, NO EL DE UTC
 *
 * Una salida a las 21:00 de Santo Domingo es del día 10 allí y del 11 en UTC.
 * Resolver el itinerario en UTC pondría un combo de un día en dos días
 * distintos, y el manifiesto del autobús tendría a esa gente el día que no es.
 */

/** Cuántos días por delante se buscan salidas. */
export const SEARCH_HORIZON_DAYS = 3;
/** Tope de salidas leídas: más no mejora el itinerario y sí la espera. */
export const MAX_SLOTS = 400;

export interface BundleDefinition {
  bundle: Product & { bundle_buffer_minutes?: number };
  items: BundleItem[];
  bufferMin: number;
}

interface BundleItemRow {
  _id: string;
  product?: unknown;
  modality?: unknown;
  day_offset?: number | null;
  sort_order?: number | null;
  fixed_time?: string | null;
  allow_overlap?: boolean | null;
  is_optional?: boolean | null;
}

function refOf(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (value && typeof value === "object") {
    const id = (value as Record<string, unknown>)._id ?? (value as Record<string, unknown>).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

function nameOf(value: unknown, fallback: string): string {
  if (value && typeof value === "object") {
    const n = (value as Record<string, unknown>).name;
    if (typeof n === "string" && n) return n;
  }
  return fallback;
}

function durationOfProduct(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const hours = Number((value as Record<string, unknown>).duration_hours ?? 0);
  return Number.isFinite(hours) && hours > 0 ? Math.round(hours * 60) : null;
}

/** El paquete y sus componentes, tal como el motor los necesita. */
export async function loadBundle(companyId: string, bundleId: string): Promise<BundleDefinition | null> {
  const [bundle] = await tenantQuery<Product & { is_bundle?: boolean; bundle_buffer_minutes?: number }>(
    companyId, "product", { _filter: { _id: bundleId }, _limit: 1 }
  );
  if (!bundle || !bundle.is_bundle) return null;

  const rows = await tenantQuery<BundleItemRow>(companyId, "product_bundle_item", {
    _filter: { bundle: bundleId },
    _sort: { day_offset: "asc" },
    _limit: 50,
    product: true,
    modality: true,
  } as never);

  const items: BundleItem[] = [];
  for (const row of rows) {
    const productId = refOf(row.product);
    if (!productId) continue;
    items.push({
      id: row._id,
      productId,
      productName: nameOf(row.product, "Actividad"),
      modalityId: refOf(row.modality),
      dayOffset: Math.max(0, Number(row.day_offset ?? 0)),
      sortOrder: Number(row.sort_order ?? 0),
      fixedTime: row.fixed_time ?? null,
      allowOverlap: row.allow_overlap === true,
      isOptional: row.is_optional === true,
      durationMin: durationOfProduct(row.product),
    });
  }

  return {
    bundle,
    items,
    bufferMin: Math.max(0, Number(bundle.bundle_buffer_minutes ?? 30)),
  };
}

/**
 * Las salidas servibles de las actividades de un paquete.
 *
 * Se leen de una vez para todas las actividades y todos los días del paquete:
 * una consulta por componente y por día haría veinte viajes a la base para
 * armar un combo de tres días.
 */
export async function slotsFor(
  companyId: string,
  items: BundleItem[],
  startDay: string,
  timeZone?: string
): Promise<Slot[]> {
  const productIds = [...new Set(items.map((i) => i.productId))];
  if (productIds.length === 0) return [];

  const maxOffset = Math.max(...items.map((i) => i.dayOffset), 0);
  // Se lee un día antes y varios después: el margen de un día por cada lado
  // cubre la salida nocturna que en la zona de la operadora es del día anterior.
  const from = `${addDays(startDay, -1)}T00:00:00.000Z`;
  const to = `${addDays(startDay, maxOffset + SEARCH_HORIZON_DAYS)}T23:59:59.999Z`;

  const { data, error } = await supabaseService()
    .from("departure")
    .select("id, product_id, departure_at, capacity, booked_pax, pending_pax, status")
    .eq("organization_id", companyId)
    .in("product_id", productIds)
    // Una salida cerrada, llena o cancelada no sirve para armar nada.
    .in("status", ["available", "almost_full"])
    .gte("departure_at", from)
    .lte("departure_at", to)
    .order("departure_at", { ascending: true })
    .limit(MAX_SLOTS);

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const at = String(row.departure_at);
    const capacity = Number(row.capacity ?? 0);
    // Aforo cero significa «sin declarar», no «sin plazas»: es la convención
    // del esquema desde 0004 y confundirla vaciaría el catálogo entero.
    const seatsLeft = capacity > 0
      ? Math.max(0, capacity - Number(row.booked_pax ?? 0) - Number(row.pending_pax ?? 0))
      : null;
    const day = dayOf(at, timeZone);
    const local = timeZone
      ? new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(at))
      : at.slice(11, 16);
    return {
      departureId: row.id as string,
      productId: row.product_id as string,
      at,
      seatsLeft,
      localDay: day,
      localTime: local,
    };
  });
}

export interface PlanInput {
  bundleId: string;
  startDay: string;
  pax: number;
  includeOptional?: boolean;
  /** Salidas ya elegidas a mano: `itemId → departureId`. */
  chosen?: Record<string, string>;
}

export interface BundlePlan extends AutoResolveResult {
  bundleId: string;
  bundleName: string;
  bufferMin: number;
  startDay: string;
  days: ReturnType<typeof byDay>;
  span: number;
  seatsLeft: number | null;
  travelAt: string | null;
  /** Lo que impide venderlo, en la voz en que se le dice al cliente. */
  blocker: string | null;
}

/**
 * Arma el itinerario de un paquete para una fecha y un grupo.
 *
 * Con `chosen` se valida lo que una persona eligió a mano en vez de resolver:
 * el mostrador a veces sabe algo que el sistema no —que ese guía lleva a ese
 * grupo— y quitarle esa decisión convierte una herramienta en un obstáculo.
 */
export async function planBundle(
  ctx: TenantContext & { companyId: string },
  input: PlanInput
): Promise<BundlePlan | null> {
  const definition = await loadBundle(ctx.companyId, input.bundleId);
  if (!definition) return null;

  const timeZone = (ctx.company as { timezone?: string } | null)?.timezone || undefined;
  const slots = await slotsFor(ctx.companyId, definition.items, input.startDay, timeZone);

  const options = {
    startDay: input.startDay,
    pax: Math.max(1, Math.floor(input.pax || 1)),
    bufferMin: definition.bufferMin,
    includeOptional: input.includeOptional !== false,
  };

  let result: AutoResolveResult;

  if (input.chosen && Object.keys(input.chosen).length > 0) {
    const blocks: Block[] = [];
    const unresolved: AutoResolveResult["unresolved"] = [];
    for (const item of definition.items) {
      const departureId = input.chosen[item.id];
      if (!departureId) {
        if (!item.isOptional) {
          unresolved.push({
            itemId: item.id,
            productName: item.productName,
            reason: `Falta elegir la salida de «${item.productName}».`,
          });
        }
        continue;
      }
      const slot = slots.find((s) => s.departureId === departureId && s.productId === item.productId);
      if (!slot) {
        // Una salida que ya no está —se cerró, se llenó, se canceló— entre que
        // se pintó la pantalla y se pulsó el botón. Decirlo es lo único que
        // evita vender una plaza que ya no existe.
        unresolved.push({
          itemId: item.id,
          productName: item.productName,
          reason: `La salida elegida de «${item.productName}» ya no está disponible.`,
        });
        continue;
      }
      blocks.push(blockOf(item, slot));
    }
    const validated = validateItinerary(blocks, definition.bufferMin);
    result = {
      ...validated,
      ok: validated.ok && unresolved.length === 0,
      unresolved,
      alternatives: [],
      truncated: false,
    };
  } else {
    result = autoResolve(definition.items, slots, options);
  }

  return {
    ...result,
    bundleId: input.bundleId,
    bundleName: definition.bundle.name || "Paquete",
    bufferMin: definition.bufferMin,
    startDay: input.startDay,
    days: byDay(result.blocks),
    span: spanDays(result.blocks),
    seatsLeft: tightestSeats(result.blocks),
    travelAt: startsAt(result.blocks),
    blocker: sellBlocker(result, options.pax),
  };
}

/**
 * Las líneas de venta de un paquete: la cabecera y sus componentes.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DÓNDE ESTÁ EL DINERO, Y POR QUÉ
 *
 * En la CABECERA, entera. Los componentes valen cero.
 *
 * La alternativa era repartir el precio del paquete entre sus actividades, y se
 * descartó: el descuento del paquete no se puede repartir de una forma que no
 * mienta —¿proporcional al precio de catálogo? ¿a la duración?— y el día que el
 * cliente quiera cancelar UNA actividad habría que decidir cuánto vale esa
 * parte de un precio que nunca fue por partes.
 *
 * Con la cabecera, la respuesta es la que el negocio ya usa: se cancela el
 * paquete entero con su política, o no se cancela.
 *
 * Los componentes NO son decorativos: llevan los pasajeros y la salida, así que
 * consumen cupo de verdad y salen en el manifiesto de su autobús. Eso es lo que
 * hace que un combo se pueda operar.
 */
export interface BundleLines {
  header: {
    product_id: string;
    adults: number;
    children: number;
    infants: number;
  };
  components: {
    product_id: string;
    departure_id: string;
    modality_id?: string | null;
    bundle_item_id: string;
    adults: number;
    children: number;
    infants: number;
  }[];
}

export function bundleLines(
  plan: BundlePlan,
  items: BundleItem[],
  pax: { adults: number; children: number; infants: number }
): BundleLines {
  return {
    header: {
      product_id: plan.bundleId,
      adults: pax.adults,
      children: pax.children,
      infants: pax.infants,
    },
    components: plan.blocks.map((block) => ({
      product_id: block.productId,
      departure_id: block.departureId,
      modality_id: items.find((i) => i.id === block.itemId)?.modalityId ?? null,
      bundle_item_id: block.itemId,
      // Los mismos pasajeros en cada actividad: el paquete lo compra el grupo
      // entero. Si alguien no fuera a una de ellas, sería otro producto.
      adults: pax.adults,
      children: pax.children,
      infants: pax.infants,
    })),
  };
}
