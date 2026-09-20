import "server-only";
import { supabaseService } from "@/lib/supabase/service";
import { createOrderWithBookings } from "@/lib/booking-service";
import { subscriptionState } from "@/lib/plan";
import { linkVisitorToCustomer, recordTouch, resolveLinkBySlug } from "@/lib/attribution-service";
import {
  publicPageState, isPublishable, toPublicCard, splitName,
  type PublicProductRow, type PublicProductCard, type PublicRequest,
} from "@/lib/public-booking";
import type { Company } from "@/lib/types";
import type { TenantContext } from "@/lib/tenant";
import { tryWrite } from "@/lib/supabase/io";

/**
 * El motor público contra la base.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ TODO PASA POR EL ROL DE SERVICIO Y NO POR RLS DE `anon`
 *
 * La tentación es abrir una política de lectura pública sobre `product` y dejar
 * que el navegador consulte. No se hace, y la razón es que entonces «lo
 * público» dejaría de ser una decisión del código para pasar a ser una política
 * de la base que hay que revisar entera cada vez que se añade una tabla. Aquí,
 * lo que sale es lo que estas funciones devuelven: una lista blanca de campos
 * de una lista blanca de filas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y POR QUÉ LA VENTA ENTRA POR EL MISMO SITIO QUE EL PUNTO DE VENTA
 *
 * `createOrderWithBookings` es el único camino que crea reservas: valida cupo,
 * calcula precio, genera comisiones, arma el plan de cobro y avisa al cliente.
 * Escribir aquí una versión «más simple» habría creado un segundo camino que se
 * olvida de la mitad de eso —y los errores de ese camino aparecerían semanas
 * después, en el manifiesto de una salida sobrevendida.
 */

export interface PublicPage {
  state: ReturnType<typeof publicPageState>;
  org: {
    id: string;
    name: string;
    slug: string;
    intro: string | null;
    terms: string | null;
    phone: string | null;
    whatsapp: string | null;
    email: string | null;
    logo: string | null;
    brandColor: string | null;
    currency: string;
  } | null;
  products: PublicProductCard[];
  /** Falso cuando el plan de la empresa no permite escribir: se ve, no se pide. */
  acceptsRequests: boolean;
}

/** La empresa por su slug. Solo inquilinos: un partner no tiene página. */
async function loadOrgBySlug(slug: string) {
  const { data } = await supabaseService()
    .from("organizations")
    .select("*")
    .eq("slug", slug)
    .eq("kind", "tenant")
    .maybeSingle();
  return data;
}

export interface LoadPageOptions {
  /**
   * Arma el catálogo aunque la empresa no tenga su página pública activada.
   *
   * Lo usa la API de socios: vender por API y tener página pública son dos
   * decisiones distintas, y una operadora puede querer la primera sin la
   * segunda. Lo que NO cambia es qué productos salen —siguen siendo solo los
   * publicados—, porque esa decisión es del catálogo, no del escaparate.
   */
  ignoreSwitch?: boolean;
}

export async function loadPublicPage(slug: string, options: LoadPageOptions = {}): Promise<PublicPage> {
  const org = await loadOrgBySlug(slug);
  const state = options.ignoreSwitch && org && (org.status ?? "active") === "active"
    ? "ok"
    : publicPageState(org);
  if (state !== "ok" || !org) return { state, org: null, products: [], acceptsRequests: false };

  const { data: rows } = await supabaseService()
    .from("product")
    .select(
      // Lista blanca también en la CONSULTA: lo que no se pide no puede
      // escaparse en un `console.log` ni en un error con el objeto entero.
      "id,name,code,status,published,short_description,description,cover_image_url," +
      "location,meeting_point,duration_hours,min_age,languages,inclusions,exclusions," +
      "base_price,public_price_from,currency,featured,sort_order"
    )
    .eq("organization_id", org.id)
    .eq("published", true)
    .order("featured", { ascending: false })
    .order("sort_order", { ascending: true })
    .limit(100);

  const products = ((rows ?? []) as unknown as Record<string, unknown>[])
    .map((row) => ({ ...row, _id: row.id }) as PublicProductRow)
    .filter(isPublishable)
    .map((row) => toPublicCard(row, org.currency || "usd"));

  // El plan decide si se PIDE, no si se VE: dejar la página en pie con el
  // teléfono delante salva la venta que el bloqueo iba a matar.
  const plan = subscriptionState(org as unknown as Company);

  return {
    state,
    org: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      intro: org.public_intro ?? null,
      terms: org.public_terms ?? null,
      phone: org.phone ?? null,
      whatsapp: org.whatsapp ?? null,
      email: org.email ?? null,
      logo: org.logo_url ?? null,
      brandColor: org.brand_color ?? null,
      currency: String(org.currency || "usd").toLowerCase(),
    },
    products,
    acceptsRequests: plan.canWrite,
  };
}

export interface PublicDeparture {
  id: string;
  at: string;
  seatsLeft: number | null;
  meetingPoint: string | null;
}

/**
 * Las salidas que el cliente puede elegir.
 *
 * Solo futuras, solo abiertas y solo con plaza. Enseñar una salida llena para
 * que el formulario la rechace después es la peor manera de perder una venta:
 * el cliente ya escribió sus datos.
 */
export async function loadPublicDepartures(
  orgId: string,
  productId: string,
  limit = 60
): Promise<PublicDeparture[]> {
  const { data } = await supabaseService()
    .from("departure")
    .select("id,departure_at,capacity,available_pax,status,meeting_point")
    .eq("organization_id", orgId)
    .eq("product_id", productId)
    .gte("departure_at", new Date().toISOString())
    .in("status", ["available", "almost_full"])
    .order("departure_at", { ascending: true })
    .limit(limit);

  return (data ?? [])
    .map((row) => ({
      id: row.id as string,
      at: row.departure_at as string,
      // Sin capacidad declarada no hay techo que enseñar: `null` es «no
      // aplica», nunca «cero».
      seatsLeft: Number(row.capacity ?? 0) > 0 ? Number(row.available_pax ?? 0) : null,
      meetingPoint: (row.meeting_point as string) ?? null,
    }))
    .filter((departure) => departure.seatsLeft === null || departure.seatsLeft > 0);
}

/* ------------------------------------------------------- crear la reserva */

/**
 * La ficha del cliente: se reutiliza la que ya existe por correo o teléfono.
 *
 * Devuelve también si la ficha ACABA de nacer, porque el embudo lo necesita:
 * «cliente captado» es la primera vez, no cada vez que el mismo señor vuelve a
 * reservar. Contar las vueltas como captaciones premiaría al vendedor cuyos
 * clientes repiten como si trajera clientes nuevos.
 */
async function findOrCreateCustomer(
  orgId: string, request: PublicRequest
): Promise<{ id: string; created: boolean }> {
  const sb = supabaseService();
  if (request.email || request.phone) {
    const query = sb.from("customer").select("id").eq("organization_id", orgId).limit(1);
    const { data } = request.email
      ? await query.eq("email", request.email)
      : await query.eq("phone", request.phone);
    if (data && data[0]) {
      /**
       * El idioma de la ficha se refresca con el de esta reserva.
       *
       * Quien reservó en español el año pasado y hoy está reservando en inglés
       * está diciendo en qué idioma quiere que le escriban AHORA. Dejar el
       * viejo haría que el recordatorio de la víspera —el que lleva la hora de
       * recogida— saliera en el idioma equivocado.
       */
      const id = data[0].id as string;
      if (request.language) {
        // No lanza: el cliente ya existe y la reserva puede seguir. Lo que se
        // pierde si falla es el idioma del recordatorio de la víspera, y eso se
        // arregla leyendo el registro, no cancelando una venta.
        await tryWrite("actualizar el idioma del cliente",
          sb.from("customer").update({ language: request.language })
            .eq("organization_id", orgId).eq("id", id));
      }
      return { id, created: false };
    }
  }

  const { first, last } = splitName(request.name);
  const { data, error } = await sb
    .from("customer")
    .insert({
      organization_id: orgId,
      first_name: first,
      last_name: last,
      email: request.email || null,
      phone: request.phone || null,
      language: request.language,
      // De dónde salió esta ficha, para que no parezca tecleada por el equipo.
      source: "web",
      status: "active",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id as string, created: true };
}

export interface PublicBookingResult {
  /** El número de la reserva: lo que el cliente ve y dice por teléfono. */
  reference: string;
  /** El número de la venta que la contiene, por donde se le pega la clave. */
  orderNumber: string;
  total: number;
  currency: string;
  travelDate: string | null;
}

/**
 * Lo que el navegador trae del QR que trajo al cliente (0058).
 *
 * Las dos cosas vienen de cookies, o sea del cliente, así que ninguna se cree
 * a ciegas: el slug se vuelve a resolver contra la base —un enlace borrado o de
 * otra empresa no atribuye nada— y el visitante solo sirve para buscar hechos
 * que ya están escritos.
 */
export interface VisitorTrace {
  visitorId?: string | null;
  referralSlug?: string | null;
}

export async function createPublicBooking(
  page: PublicPage,
  request: PublicRequest,
  company: Company | null,
  trace: VisitorTrace = {}
): Promise<PublicBookingResult> {
  if (!page.org) throw Object.assign(new Error("La página no está disponible"), { status: 404 });
  const orgId = page.org.id;

  const { id: customerId, created } = await findOrCreateCustomer(orgId, request);

  /**
   * Las visitas anónimas de este navegador pasan a ser de esta ficha.
   *
   * Sin esto, el conserje que trajo al cliente pierde la atribución justo en el
   * momento en que ese visitante se convierte en cliente — que es el momento en
   * que empieza a valer dinero.
   */
  await linkVisitorToCustomer(orgId, trace.visitorId, customerId);

  /**
   * El enlace se resuelve otra vez contra la base, aunque la cookie diga quién
   * es. La cookie la escribe el cliente: creerle sería dejar que cualquiera se
   * atribuyera las ventas de la operadora entera editando una cadena.
   */
  const link = trace.referralSlug ? await resolveLinkBySlug(trace.referralSlug) : null;
  const sameCompany = link && link.companyId === orgId ? link : null;

  if (sameCompany && created) {
    await recordTouch({
      companyId: orgId,
      sellerId: sameCompany.sellerId,
      linkId: sameCompany.linkId,
      stage: "signup",
      customerId,
      visitorId: trace.visitorId,
      channel: sameCompany.channel,
      campaign: sameCompany.campaign,
    });
  }

  /**
   * El contexto de una venta SIN usuario.
   *
   * No hay sesión: el rol es el mínimo que permite vender y el identificador de
   * usuario va vacío a propósito, para que la reserva quede marcada como lo que
   * es —entrada por la web— en vez de atribuírsela a alguien del equipo.
   */
  const ctx = {
    userId: "",
    email: "",
    name: "Web",
    role: "seller",
    companyId: orgId,
    partnerId: null,
    branchId: null,
    company,
  } as unknown as TenantContext & { companyId: string };

  const result = await createOrderWithBookings(ctx, {
    customer_id: customerId,
    channel: "web",
    // La cookie del visitante viaja hasta el motor de ventas: es lo único que
    // encuentra al conserje que trajo a alguien que todavía no tenía ficha.
    visitor_id: trace.visitorId || null,
    items: [
      {
        product_id: request.productId,
        departure_id: request.departureId || undefined,
        adults: request.adults,
        children: request.children,
        infants: request.infants,
        pickup_hotel_id: undefined,
        pickup_location: request.hotel || undefined,
        room_number: request.room || undefined,
        notes: request.notes || undefined,
      },
    ],
  } as never);

  const booking = result.bookings[0];
  if (booking?._id) {
    // La petición tal cual, para poder reconstruir después una reserva que no
    // cuadra: qué escribió el cliente, con qué hotel y en qué idioma.
    // Tampoco lanza, y por el mismo motivo al revés: la reserva YA está
    // creada. Contestar error aquí haría que el cliente volviera a reservar y
    // pagara dos veces por no haber podido guardar una copia del formulario.
    await tryWrite("guardar la petición original de la reserva", supabaseService()
      .from("booking")
      .update({ public_request: request })
      .eq("organization_id", orgId)
      .eq("id", booking._id));
  }

  return {
    reference: String(booking?.booking_number || result.order.order_number),
    orderNumber: String(result.order.order_number),
    total: Number(result.order.total ?? 0),
    currency: String(result.order.currency || page.org.currency),
    travelDate: (booking?.travel_date as string) || null,
  };
}
