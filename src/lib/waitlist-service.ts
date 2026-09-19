import "server-only";
import { requireAtLeast, tenantCreate, tenantQuery, tenantUpdate, type TenantContext } from "@/lib/tenant";
import { recalculateDeparture } from "@/lib/availability";
import { createOrderWithBookings } from "@/lib/booking-service";
import { notify } from "@/lib/notify-service";
import { writeAudit } from "@/lib/audit";
import {
  queueOf, waitingPax, pickForSeats, offerDeadline, outcomeOf, summarize,
  contactName, contactChannel, OFFER_HOURS,
  type WaitlistEntryLike, type WaitlistSummary,
} from "@/lib/waitlist";
import { refId } from "@/lib/types";

/**
 * La lista de espera, conectada con la venta.
 *
 * LO QUE HACE DISTINTO A ESTE MÓDULO
 *
 * Ofrecer una plaza no es mandar un mensaje: es CREAR LA RESERVA. Entre un
 * aviso y la llamada del cliente, cualquiera compra ese asiento en el
 * mostrador, y el cliente llega habiendo sido avisado de algo que ya no existe.
 *
 * Con una reserva de verdad el asiento está apartado, caduca solo por el camino
 * que ya existía desde la ola 3 (`order.hold_until` + `releaseExpiredHolds`), y
 * convertir es sencillamente cobrar. Ni un mecanismo de retención nuevo ni un
 * cambio en el motor de disponibilidad: la reserva cuenta como `pending_pax`
 * igual que cualquier otra, así que nadie más puede vender esa plaza.
 */

export interface JoinWaitlistInput {
  departure_id: string;
  pax: number;
  customer_id?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  seller_id?: string | null;
  partner_id?: string | null;
  notes?: string | null;
}

export interface WaitlistRow {
  entry: Record<string, unknown>;
  booking: Record<string, unknown> | null;
  outcome: ReturnType<typeof outcomeOf>;
  name: string;
  channel: string | null;
}

/* ═════════════════════════════════════════════════════════════ apuntarse ══ */

/**
 * Apuntar a alguien en la cola de una salida.
 *
 * No comprueba si la salida está llena, y es deliberado: el vendedor apunta a
 * quien se quedó fuera, pero también a quien prefiere una salida que hoy tiene
 * sitio y mañana no. Negarle la cola a un cliente porque «todavía cabe» le
 * obliga a volver a llamar.
 */
export async function joinWaitlist(
  ctx: TenantContext & { companyId: string },
  input: JoinWaitlistInput
): Promise<Record<string, unknown>> {
  requireAtLeast(ctx, "cashier");

  const pax = Math.floor(Number(input.pax) || 0);
  if (pax < 1) {
    throw Object.assign(new Error("Una espera tiene que ser de al menos una persona"), { status: 400 });
  }

  const telefono = String(input.contact_phone || "").trim();
  const correo = String(input.contact_email || "").trim();
  if (!input.customer_id && !telefono && !correo) {
    throw Object.assign(
      new Error("Hace falta un cliente, un teléfono o un correo: sin eso no hay a quién avisar"),
      { status: 400 }
    );
  }

  const [salida] = await tenantQuery<Record<string, unknown>>(ctx.companyId, "departure", {
    _filter: { _id: input.departure_id }, _limit: 1,
  });
  if (!salida) throw Object.assign(new Error("Salida no encontrada"), { status: 404 });

  const entry = await tenantCreate<Record<string, unknown>>(ctx.companyId, "waitlist_entry", {
    departure: input.departure_id,
    customer: input.customer_id || undefined,
    contact_name: String(input.contact_name || "").trim() || undefined,
    contact_phone: telefono || undefined,
    contact_email: correo || undefined,
    seller: input.seller_id || undefined,
    partner: input.partner_id || undefined,
    pax,
    status: "waiting",
    notes: input.notes || undefined,
  });

  await refreshWaitlistCount(ctx.companyId, input.departure_id);

  await writeAudit({
    companyId: ctx.companyId, userId: ctx.userId,
    action: "waitlist.join", entityType: "waitlist_entry", entityId: String(entry._id),
    description: `${pax} pax en lista de espera`,
  });

  return entry;
}

/** Da de baja una espera. Lo que una persona decidió no lo pisa ningún barrido. */
export async function leaveWaitlist(
  ctx: TenantContext & { companyId: string },
  entryId: string,
  reason?: string | null
): Promise<void> {
  requireAtLeast(ctx, "cashier");
  const [entry] = await tenantQuery<Record<string, unknown>>(ctx.companyId, "waitlist_entry", {
    _filter: { _id: entryId }, _limit: 1,
  });
  if (!entry) throw Object.assign(new Error("Espera no encontrada"), { status: 404 });

  await tenantUpdate(ctx.companyId, "waitlist_entry", entryId, {
    status: "cancelled",
    notes: reason ? String(reason).slice(0, 500) : (entry.notes as string) ?? undefined,
  });
  await refreshWaitlistCount(ctx.companyId, String(refId(entry.departure) ?? ""));
}

/**
 * `departure.waitlist_pax` deja de ser un cero escrito a mano.
 *
 * Cuenta a quien ESPERA, no a quien ya tiene oferta: los que tienen oferta ya
 * ocupan su plaza como `pending_pax` de una reserva normal, y sumarlos aquí los
 * contaría dos veces. Lo que mide este número es la demanda que se está
 * perdiendo.
 */
export async function refreshWaitlistCount(companyId: string, departureId: string): Promise<number> {
  if (!departureId) return 0;
  const entries = await tenantQuery<WaitlistEntryLike>(companyId, "waitlist_entry", {
    _filter: { departure: departureId }, _limit: 500,
  });
  const pax = waitingPax(entries);
  await tenantUpdate(companyId, "departure", departureId, { waitlist_pax: pax });
  return pax;
}

/* ═══════════════════════════════════════════════ ofrecer al liberarse plaza ══ */

export interface OfferReport {
  departureId: string;
  freeSeats: number;
  offered: { entryId: string; pax: number; bookingId: string | null; name: string }[];
  problems: string[];
}

/**
 * Ofrece las plazas libres a quien lleva más tiempo esperando.
 *
 * Se llama cuando se libera algo —una cancelación, una retención vencida— y no
 * desde un reloj. Es la misma lección que ya estaba escrita para el cupo de las
 * OTA: una plaza bloqueada de más solo hace daño cuando alguien intenta
 * comprarla, y una plaza libre solo sirve cuando hay alguien esperándola.
 *
 * NUNCA TUMBA A QUIEN LA LLAMA. Va siempre dentro de un intento: que la lista
 * de espera falle no puede dejar a medias una cancelación que el cliente ya
 * tiene confirmada. Lo que no salga queda en `problems` y en el registro.
 */
export async function offerFreedSeats(
  ctx: TenantContext & { companyId: string },
  departureId: string
): Promise<OfferReport> {
  const report: OfferReport = { departureId, freeSeats: 0, offered: [], problems: [] };
  if (!departureId) return report;

  const estado = await recalculateDeparture(ctx.companyId, departureId);
  report.freeSeats = estado.availablePax;

  /**
   * Sin plazas libres no hay nada que ofrecer.
   *
   * Aquí había también un `if (estado.capacity <= 0) return` para el caso de la
   * salida sin límite —«no hay plazas que liberar porque nunca faltaron»—. Se
   * quitó al comprobar que era código muerto: `availablePax` es
   * `max(0, capacity − booked − pending)`, así que con capacidad 0 vale 0
   * siempre y esta misma línea ya lo atrapa. Una guarda que no puede fallar es
   * una guarda que nadie mantiene y que hace creer que protege algo.
   */
  if (estado.availablePax <= 0) return report;

  const entries = await tenantQuery<Record<string, unknown>>(ctx.companyId, "waitlist_entry", {
    _filter: { departure: departureId }, _limit: 500,
    customer: true,
  });

  const picks = pickForSeats(entries as WaitlistEntryLike[], estado.availablePax);
  if (picks.length === 0) return report;

  const [salida] = await tenantQuery<Record<string, unknown>>(ctx.companyId, "departure", {
    _filter: { _id: departureId }, _limit: 1, product: true,
  });
  const productId = refId(salida?.product);
  if (!productId) {
    report.problems.push("La salida no tiene producto: no se puede armar la reserva de la oferta.");
    return report;
  }

  for (const pick of picks) {
    const entry = pick.entry as Record<string, unknown>;
    const entryId = String(entry._id ?? "");
    const nombre = contactName(entry as WaitlistEntryLike);
    try {
      const customerId = await ensureCustomer(ctx, entry);

      const venta = await createOrderWithBookings(ctx, {
        customer_id: customerId,
        seller_id: (refId(entry.seller) as string) ?? null,
        partner_id: (refId(entry.partner) as string) ?? null,
        channel: "direct",
        notes: `Plaza ofrecida desde la lista de espera`,
        items: [{ product_id: productId, departure_id: departureId, adults: pick.pax }],
      });

      /**
       * El plazo de la oferta se escribe AQUÍ y no se hereda de la empresa.
       *
       * `createOrderWithBookings` pone `hold_until` solo si la empresa tiene
       * política de retención. Una operadora sin esa política dejaría la plaza
       * guardada para siempre a nombre de quien no contestó, y la lista de
       * espera pasaría de recuperar ventas a bloquearlas.
       */
      const vence = offerDeadline(new Date(), (salida?.departure_at as string) ?? null, OFFER_HOURS);
      await tenantUpdate(ctx.companyId, "order", String(venta.order._id), { hold_until: vence });

      await tenantUpdate(ctx.companyId, "waitlist_entry", entryId, {
        status: "offered",
        offered_at: new Date().toISOString(),
        offer_expires_at: vence,
        booking: venta.bookings[0]?._id ?? undefined,
      });

      report.offered.push({
        entryId, pax: pick.pax,
        bookingId: (venta.bookings[0]?._id as string) ?? null,
        name: nombre,
      });

      // El aviso va fuera de lo crítico: que el correo esté caído no puede
      // deshacer una plaza que ya está apartada de verdad.
      try {
        await notify({
          companyId: ctx.companyId,
          event: "waitlist_offer",
          vars: {
            name: nombre,
            pax: String(pick.pax),
            channel: contactChannel(entry as WaitlistEntryLike) ?? "sin contacto",
            expires: vence,
            booking: String(venta.bookings[0]?.booking_number ?? ""),
          },
        });
      } catch (err) {
        console.error("[waitlist] no se pudo avisar de la oferta:", err);
      }
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      report.problems.push(`${nombre}: ${motivo}`);
      console.error(`[waitlist] no se pudo ofrecer la plaza a ${nombre}:`, err);
    }
  }

  await refreshWaitlistCount(ctx.companyId, departureId);

  if (report.offered.length > 0) {
    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "waitlist.offer", entityType: "departure", entityId: departureId,
      description:
        `${report.offered.length} oferta(s) de lista de espera por ` +
        `${report.offered.reduce((s, o) => s + o.pax, 0)} pax`,
      metadata: { offered: report.offered, problems: report.problems.slice(0, 10) },
    });
  }

  console.log(
    `[waitlist] salida ${departureId}: ${estado.availablePax} libres · ` +
      `${report.offered.length} ofertas · ${report.problems.length} problemas`
  );
  return report;
}

/**
 * Ofrecer desde un cron, que corre sin sesión.
 *
 * El contexto se arma aquí y no en la ruta del cron por dos motivos. Uno, que
 * la empresa hay que CARGARLA: sin ella la venta que nace de la oferta se
 * quedaría sin la moneda base de la operadora y sin su sucursal, y una reserva
 * en la moneda equivocada es peor que no haberla hecho. Y dos, que la mentira
 * al sistema de tipos —esto no es una sesión de verdad— se queda en un solo
 * sitio, con el motivo escrito, en vez de repetirse en cada llamador.
 *
 * Es el mismo patrón que ya usan el conector de OTAs y el motor público.
 */
export async function offerFreedSeatsForCompany(
  companyId: string,
  departureId: string
): Promise<OfferReport> {
  const [empresa] = await tenantQuery<Record<string, unknown>>(companyId, "company", {
    _filter: { _id: companyId }, _limit: 1,
  });

  const ctx = {
    userId: "", email: "", name: "Sistema", role: "operations",
    companyId, partnerId: null, branchId: null, company: empresa ?? null,
  } as unknown as TenantContext & { companyId: string };

  return offerFreedSeats(ctx, departureId);
}

/**
 * La ficha del cliente, creándola si la espera era de mostrador.
 *
 * Es el momento natural: quien acepta una plaza deja de ser «un teléfono en una
 * libreta» y pasa a tener una reserva a su nombre. Exigir la ficha al
 * apuntarse habría convertido un gesto de diez segundos en un alta, y el
 * vendedor no lo habría hecho.
 */
async function ensureCustomer(
  ctx: TenantContext & { companyId: string },
  entry: Record<string, unknown>
): Promise<string> {
  const existente = refId(entry.customer);
  if (existente) return existente;

  const completo = String(entry.contact_name || "").trim();
  const corte = completo.indexOf(" ");
  const cliente = await tenantCreate<Record<string, unknown>>(ctx.companyId, "customer", {
    first_name: corte > 0 ? completo.slice(0, corte) : completo || "Cliente",
    last_name: corte > 0 ? completo.slice(corte + 1) : undefined,
    phone: (entry.contact_phone as string) || undefined,
    email: (entry.contact_email as string) || undefined,
    status: "active",
    notes: "Ficha creada al aceptar una plaza de la lista de espera.",
  });
  await tenantUpdate(ctx.companyId, "waitlist_entry", String(entry._id), { customer: cliente._id });
  return String(cliente._id);
}

/* ═══════════════════════════════════════════════════════ ofertas vencidas ══ */

export interface ExpireReport {
  expired: number;
  departures: string[];
}

/**
 * Marca vencidas las ofertas a las que se les pasó el plazo.
 *
 * NO cancela sus reservas: de eso se encarga `releaseExpiredHolds`, que ya sabe
 * hacerlo y que solo toca las que nadie pagó. Duplicar esa lógica aquí habría
 * sido la forma de que las dos acabaran discrepando.
 *
 * Devuelve las salidas afectadas para que quien llame vuelva a ofrecer: la
 * plaza que se acaba de soltar le toca al siguiente de la cola.
 */
export async function expireOffers(companyId: string, now: Date = new Date()): Promise<ExpireReport> {
  const vencidas = await tenantQuery<Record<string, unknown>>(companyId, "waitlist_entry", {
    _filter: { status: "offered", offer_expires_at: { lt: now.toISOString() } },
    _limit: 500,
  });

  const departures = new Set<string>();
  for (const entry of vencidas) {
    await tenantUpdate(companyId, "waitlist_entry", String(entry._id), { status: "expired" });
    const dep = refId(entry.departure);
    if (dep) departures.add(dep);
  }

  if (vencidas.length > 0) {
    console.warn(`[waitlist] ${vencidas.length} oferta(s) vencida(s) sin respuesta`);
  }
  return { expired: vencidas.length, departures: [...departures] };
}

/**
 * La espera pasa a `converted` cuando su reserva cobra algo.
 *
 * Se llama desde donde entra el dinero. Estar en la tabla y no derivarlo al
 * leer tiene un motivo: es el número con el que la operadora decide si la lista
 * sirve, y un número que se recalcula cada vez que se mira cambia de valor si
 * la reserva se reembolsa después. Lo que se quiere contar es que la lista
 * RECUPERÓ esa venta, y eso ya pasó.
 */
export async function markConvertedByBooking(companyId: string, bookingId: string): Promise<boolean> {
  if (!bookingId) return false;
  const [entry] = await tenantQuery<Record<string, unknown>>(companyId, "waitlist_entry", {
    _filter: { booking: bookingId, status: "offered" }, _limit: 1,
  });
  if (!entry) return false;
  await tenantUpdate(companyId, "waitlist_entry", String(entry._id), { status: "converted" });
  console.log(`[waitlist] espera ${entry._id} convertida en venta`);
  return true;
}

/* ═════════════════════════════════════════════════════════════ la pantalla ══ */

export interface WaitlistPayload {
  departureId: string;
  rows: WaitlistRow[];
  queue: WaitlistRow[];
  summary: WaitlistSummary;
  freeSeats: number;
  capacity: number;
}

/** La cola de una salida, con el desenlace de cada espera ya resuelto. */
export async function loadWaitlist(companyId: string, departureId: string): Promise<WaitlistPayload> {
  const entries = await tenantQuery<Record<string, unknown>>(companyId, "waitlist_entry", {
    _filter: { departure: departureId }, _limit: 500,
    customer: true, seller: true, booking: true,
  });

  const now = new Date();
  const rows: WaitlistRow[] = entries.map((entry) => {
    const booking = (entry.booking as Record<string, unknown>) ?? null;
    return {
      entry,
      booking,
      outcome: outcomeOf(entry as WaitlistEntryLike, booking, now),
      name: contactName(entry as WaitlistEntryLike),
      channel: contactChannel(entry as WaitlistEntryLike),
    };
  });

  const estado = await recalculateDeparture(companyId, departureId);
  const colaIds = new Set(queueOf(entries as WaitlistEntryLike[]).map((e) => String(e._id ?? e.id)));

  return {
    departureId,
    rows,
    queue: rows
      .filter((r) => colaIds.has(String(r.entry._id)))
      .sort((a, b) => String(a.entry.created_at ?? "").localeCompare(String(b.entry.created_at ?? ""))),
    summary: summarize(rows.map((r) => ({ entry: r.entry as WaitlistEntryLike, booking: r.booking })), now),
    freeSeats: estado.availablePax,
    capacity: estado.capacity,
  };
}
