import "server-only";
import { supabaseService } from "@/lib/supabase/service";
import {
  DEFAULT_WINDOW_DAYS, normalizeChannel, normalizePolicy, resolveAttribution,
  factId, factSeller, funnel, sellerLeaderboard,
  type AttributionPolicy, type FunnelStage, type FunnelStep, type SellerFunnelRow,
} from "@/lib/attribution";

/**
 * La atribución contra la base.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESCRIBE CON EL ROL DE SERVICIO
 *
 * El primer paso del embudo lo deja alguien que no tiene sesión: un turista que
 * escanea un QR pegado en el mostrador de un hotel. No hay usuario, no hay
 * organización en el token y no la va a haber. Igual que el motor público de
 * 0047, esto escribe con el rol de servicio y `organization_id` explícito —no
 * abriendo una política a `anon`, que convertiría «lo público» en algo que hay
 * que revisar entero cada vez que se añade una tabla.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO SE ESCRIBE UNA FILA POR VISITA
 *
 * Un visitante que recarga la página veinte veces dejaría veinte filas. El
 * embudo ya cuenta personas y no clics, así que el recuento saldría bien — pero
 * la tabla crecería sin techo por una superficie que cualquiera puede llamar.
 * Una visita del mismo navegador por el mismo enlace se repite como mucho cada
 * seis horas; lo demás es la misma visita.
 */

/** Cada cuánto vuelve a contar la misma visita del mismo navegador. */
export const VISIT_DEDUPE_HOURS = 6;

export interface TouchInput {
  companyId: string;
  sellerId: string;
  stage: FunnelStage;
  linkId?: string | null;
  customerId?: string | null;
  visitorId?: string | null;
  channel?: string | null;
  landing?: string | null;
  campaign?: string | null;
  orderId?: string | null;
  bookingId?: string | null;
}

/**
 * Escribe un paso del embudo. Nunca lanza: un fallo aquí no puede tumbar la
 * venta que lo provocó. Que no se registre quién trajo al cliente es un
 * problema; que no se pueda vender es otro mucho peor.
 */
export async function recordTouch(input: TouchInput): Promise<string | null> {
  try {
    const sb = supabaseService();

    if (input.stage === "visit" && (input.visitorId || input.customerId)) {
      const since = new Date(Date.now() - VISIT_DEDUPE_HOURS * 3_600_000).toISOString();
      let recent = sb
        .from("seller_attribution")
        .select("id")
        .eq("organization_id", input.companyId)
        .eq("seller_id", input.sellerId)
        .eq("stage", "visit")
        .gte("created_at", since)
        .limit(1);
      recent = input.visitorId
        ? recent.eq("visitor_id", input.visitorId)
        : recent.eq("customer_id", input.customerId!);
      /**
       * Si esta lectura falla se escribe igual, y es lo correcto AQUÍ.
       *
       * La deduplicación existe para que la tabla no crezca sin techo por una
       * superficie que cualquiera puede llamar, no para que el recuento salga
       * bien: el embudo cuenta personas, no filas, así que una visita repetida
       * no desvía ningún número. Ante la duda se prefiere una fila de más a
       * perder el paso que dice quién trajo a este cliente.
       *
       * Es justo lo contrario de `recordPurchaseOnce`, y la diferencia es que
       * allí la fila de más SÍ desvía el número. Se dice en la consola para que
       * un crecimiento raro de la tabla tenga dónde mirarse.
       */
      const { data: already, error: errorDeVisitas } = await recent;
      if (errorDeVisitas) {
        console.error("[attribution] no se pudo comprobar si la visita era repetida:", errorDeVisitas.message);
      }
      if (already && already.length > 0) return already[0].id as string;
    }

    const { data, error } = await sb
      .from("seller_attribution")
      .insert({
        organization_id: input.companyId,
        seller_id: input.sellerId,
        link_id: input.linkId || null,
        customer_id: input.customerId || null,
        visitor_id: input.visitorId || null,
        stage: input.stage,
        channel: input.channel ? normalizeChannel(input.channel) : null,
        landing: input.landing?.slice(0, 300) || null,
        campaign: input.campaign?.slice(0, 120) || null,
        order_id: input.orderId || null,
        booking_id: input.bookingId || null,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[attribution] no se pudo registrar el paso del embudo:", error.message);
      return null;
    }
    return data.id as string;
  } catch (err) {
    console.error("[attribution] no se pudo registrar el paso del embudo:", err);
    return null;
  }
}

/**
 * Enlaza las visitas anónimas de un navegador con la ficha que acaba de nacer.
 *
 * Es la única edición que la base permite sobre un hecho, y por una razón
 * concreta: sin ella, el conserje que trajo al cliente pierde la atribución en
 * el momento exacto en que ese cliente se convierte en cliente. Completa el
 * hecho, no lo reescribe — el disparador de 0058 rechaza cualquier otra cosa.
 */
export async function linkVisitorToCustomer(
  companyId: string,
  visitorId: string | null | undefined,
  customerId: string
): Promise<number> {
  if (!visitorId || !customerId) return 0;
  try {
    const { data, error } = await supabaseService()
      .from("seller_attribution")
      .update({ customer_id: customerId })
      .eq("organization_id", companyId)
      .eq("visitor_id", visitorId)
      .is("customer_id", null)
      .select("id");
    if (error) {
      console.error("[attribution] no se pudo enlazar el visitante con su ficha:", error.message);
      return 0;
    }
    return data?.length ?? 0;
  } catch (err) {
    console.error("[attribution] no se pudo enlazar el visitante con su ficha:", err);
    return 0;
  }
}

/**
 * El paso «compra», y solo una vez por venta.
 *
 * `syncOrderTotals` se ejecuta con cada pago, cada abono y cada cancelación de
 * una línea. Sin esta comprobación, una venta cobrada en tres plazos dejaría
 * tres compras en el embudo y el vendedor que cobra a plazos parecería el
 * triple de bueno que el que cobra de una vez.
 */
export async function recordPurchaseOnce(
  companyId: string,
  orderId: string,
  sellerId: string,
  extra: { customerId?: string | null; channel?: string | null } = {}
): Promise<void> {
  try {
    const { data, error } = await supabaseService()
      .from("seller_attribution")
      .select("id")
      .eq("organization_id", companyId)
      .eq("order_id", orderId)
      .eq("stage", "purchase")
      .limit(1);
    /**
     * NO PODER COMPROBARLO NO ES «TODAVÍA NO HAY NINGUNA».
     *
     * PostgREST no lanza: devolvía `{ data: null, error }`, el error se
     * descartaba y la comprobación caía de largo hasta escribir. O sea que la
     * regla que este comentario explica —una compra por venta— se apagaba sola
     * justo cuando la base va mal, y encima de la peor manera: `syncOrderTotals`
     * corre con CADA pago, así que la venta cobrada en tres plazos deja tres
     * compras y el vendedor que cobra a plazos parece el triple de bueno.
     *
     * Aquí se falla cerrado, al revés que la visita de `recordTouch`: un paso
     * de embudo que falta es un hueco en un informe, y una compra de más es un
     * número equivocado con toda la pinta de bueno. El segundo no se ve.
     */
    if (error) {
      console.error("[attribution] no se pudo comprobar si la venta ya estaba en el embudo:", error.message);
      return;
    }
    if (data && data.length > 0) return;

    await recordTouch({
      companyId,
      sellerId,
      stage: "purchase",
      orderId,
      customerId: extra.customerId ?? null,
      channel: extra.channel ?? null,
    });
  } catch (err) {
    console.error("[attribution] no se pudo registrar la compra:", err);
  }
}

/* ----------------------------------------------- el enlace, desde el mundo */

export interface ResolvedLink {
  linkId: string;
  slug: string;
  companyId: string;
  orgSlug: string;
  sellerId: string;
  sellerName: string;
  channel: string;
  campaign: string | null;
  productId: string | null;
  windowDays: number;
}

/**
 * El enlace de un QR, resuelto desde fuera: quien lo escanea no ha dicho de qué
 * empresa es cliente, así que el slug tiene que resolver la empresa él solo.
 *
 * Un enlace inactivo, de un vendedor que ya no está o de una empresa con la
 * página apagada se contesta igual que uno que no existe: la diferencia solo le
 * serviría a quien prueba slugs para averiguar quién usa el sistema.
 */
export async function resolveLinkBySlug(slug: string): Promise<ResolvedLink | null> {
  const clean = String(slug || "").trim();
  if (!clean || clean.length > 64) return null;
  /**
   * EL SLUG ES UN SLUG, NO UN PATRÓN.
   *
   * Abajo se compara con `ilike`, que es lo correcto —el código va impreso bajo
   * un QR y quien lo teclea puede escribirlo en minúsculas—, pero `ilike`
   * interpreta `%` y `_`: son comodines, y esto viene de la URL sin tocar. Con
   * `/e/%` el patrón casa con TODOS los enlaces activos de la base, y con `_`
   * se pueden tantear slugs de uno en uno. Cuando casa exactamente uno, quien
   * lo probó se lleva la atribución de ese vendedor sin haber tenido nunca su
   * QR delante.
   *
   * `slugify` solo produce `[A-Z0-9]`, así que exigir eso no rechaza ningún
   * enlace que exista: rechaza justo lo que nunca fue un enlace.
   */
  if (!/^[A-Za-z0-9]+$/.test(clean)) return null;

  const { data: link } = await supabaseService()
    .from("seller_link")
    .select("id, slug, organization_id, seller_id, channel, campaign, product_id, status")
    .ilike("slug", clean)
    .eq("status", "active")
    .maybeSingle();
  if (!link) return null;

  const [{ data: org }, { data: seller }] = await Promise.all([
    supabaseService()
      .from("organizations")
      .select("id, slug, kind, public_booking_enabled, attribution_window_days")
      .eq("id", link.organization_id as string)
      .maybeSingle(),
    supabaseService()
      .from("seller")
      .select("id, first_name, last_name, status")
      .eq("organization_id", link.organization_id as string)
      .eq("id", link.seller_id as string)
      .maybeSingle(),
  ]);

  if (!org || org.kind !== "tenant" || !org.public_booking_enabled || !org.slug) return null;
  if (!seller || seller.status !== "active") return null;

  return {
    linkId: link.id as string,
    slug: link.slug as string,
    companyId: link.organization_id as string,
    orgSlug: org.slug as string,
    sellerId: seller.id as string,
    sellerName: [seller.first_name, seller.last_name].filter(Boolean).join(" ") || "Vendedor",
    channel: String(link.channel || "link"),
    campaign: (link.campaign as string) || null,
    productId: (link.product_id as string) || null,
    windowDays: Number(org.attribution_window_days ?? DEFAULT_WINDOW_DAYS),
  };
}

/* --------------------------------------------- a quién le toca esta venta */

export interface OrderAttribution {
  attributionId: string | null;
  sellerId: string;
  policy: AttributionPolicy;
}

/**
 * El vendedor que se lleva esta venta, según el histórico y la política de la
 * empresa. `null` cuando no hay nadie vivo: la venta es directa de la empresa,
 * que es la verdad y no un hueco que haya que rellenar.
 *
 * Se lee por ficha Y por cookie porque son dos momentos distintos: la ficha
 * cubre al cliente que vuelve tres meses después desde otro móvil, y la cookie
 * al visitante que todavía no era nadie cuando escaneó el QR.
 */
export async function resolveOrderAttribution(
  companyId: string,
  who: { customerId?: string | null; visitorId?: string | null },
  company?: { attribution_policy?: string | null; attribution_window_days?: number | null } | null
): Promise<OrderAttribution | null> {
  if (!who.customerId && !who.visitorId) return null;

  const policy = normalizePolicy(company?.attribution_policy);
  const windowDays = Number(company?.attribution_window_days ?? DEFAULT_WINDOW_DAYS);

  try {
    const sb = supabaseService();
    const columns = "id, seller_id, stage, channel, created_at, customer_id, visitor_id";
    const queries = [];
    if (who.customerId) {
      queries.push(
        sb.from("seller_attribution").select(columns)
          .eq("organization_id", companyId).eq("customer_id", who.customerId)
          .order("created_at", { ascending: true }).limit(200)
      );
    }
    if (who.visitorId) {
      queries.push(
        sb.from("seller_attribution").select(columns)
          .eq("organization_id", companyId).eq("visitor_id", who.visitorId)
          .order("created_at", { ascending: true }).limit(200)
      );
    }

    const results = await Promise.all(queries);

    /**
     * UN CONJUNTO INCOMPLETO NO DECIDE QUIÉN COBRA.
     *
     * Las dos consultas —por ficha y por cookie— se descartaban con
     * `for (const { data } of results)`, así que un error en cualquiera de las
     * dos salía de aquí como «ese cliente no tiene histórico». Y eso tiene dos
     * caras, las dos malas:
     *
     *  · devolver `null` es decir que la venta es DIRECTA, y el docblock de
     *    arriba dice que eso «es la verdad». Con una lectura rota no es la
     *    verdad: es el conserje que trajo al cliente quedándose sin comisión,
     *    en silencio y sin nada que revisar después;
     *  · y con política de último toque, resolver sobre la mitad de los hechos
     *    es peor todavía: el ganador puede ser OTRO vendedor, y entonces no se
     *    pierde una comisión, se le paga a quien no la hizo.
     *
     * Así que si falla una, no se resuelve con la otra. Se dice y se devuelve
     * sin atribución, que sigue siendo lo único que no tumba la venta.
     */
    const rota = results.find((r) => r.error);
    if (rota) {
      console.error(
        "[attribution] no se pudo leer el histórico completo de atribución " +
        `(cliente ${who.customerId ?? "—"}, visitante ${who.visitorId ?? "—"}): ${rota.error?.message}. ` +
        "La venta queda SIN atribuir en vez de atribuirse a medias."
      );
      return null;
    }

    const seen = new Set<string>();
    const facts: Record<string, unknown>[] = [];
    for (const { data } of results) {
      for (const row of data ?? []) {
        const id = row.id as string;
        if (seen.has(id)) continue;
        seen.add(id);
        facts.push(row);
      }
    }

    const winner = resolveAttribution(facts, { policy, windowDays });
    if (!winner) return null;
    const sellerId = factSeller(winner);
    if (!sellerId) return null;

    return { attributionId: factId(winner), sellerId, policy };
  } catch (err) {
    console.error("[attribution] no se pudo resolver la atribución de la venta:", err);
    return null;
  }
}

/* ------------------------------------------------------ para las pantallas */

export interface FunnelReport {
  steps: FunnelStep[];
  leaderboard: SellerFunnelRow[];
  /** Filas leídas. Si toca el tope, el informe lo dice en vez de mentir. */
  rows: number;
  truncated: boolean;
}

/** Tope de filas leídas: un informe que tarda un minuto no se mira. */
export const MAX_FUNNEL_ROWS = 5000;

/**
 * El embudo de la red comercial en un rango de fechas.
 *
 * Lee con el rol de servicio y filtro explícito de empresa, igual que la
 * analítica de la ola 6: el traductor de consultas no expresa rangos de fecha
 * sobre `created_at`, y un informe que lo hiciera en memoria tendría que
 * traerse la tabla entera para descartar la mitad.
 */
export async function funnelReport(
  companyId: string,
  options: { sellerId?: string | null; from?: string | null; to?: string | null } = {}
): Promise<FunnelReport> {
  let query = supabaseService()
    .from("seller_attribution")
    .select("id, seller_id, stage, channel, created_at, customer_id, visitor_id, link_id")
    .eq("organization_id", companyId)
    .order("created_at", { ascending: false })
    .limit(MAX_FUNNEL_ROWS);

  if (options.sellerId) query = query.eq("seller_id", options.sellerId);
  if (options.from) query = query.gte("created_at", options.from);
  if (options.to) query = query.lte("created_at", options.to);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  // Los nombres, en una sola consulta: uno por vendedor y no uno por fila.
  const sellerIds = [...new Set(rows.map((r) => r.seller_id as string).filter(Boolean))];
  const names = new Map<string, string>();
  if (sellerIds.length > 0) {
    // Si esta falla, el ranking sale con todo el mundo llamándose «Vendedor» y
    // nadie sabe por qué. No tumba el informe —los números siguen siendo
    // buenos— pero se dice.
    const { data: sellers, error: errorDeNombres } = await supabaseService()
      .from("seller")
      .select("id, first_name, last_name")
      .eq("organization_id", companyId)
      .in("id", sellerIds);
    if (errorDeNombres) {
      console.error("[attribution] no se pudieron leer los nombres de los vendedores:", errorDeNombres.message);
    }
    for (const s of sellers ?? []) {
      names.set(
        s.id as string,
        [s.first_name, s.last_name].filter(Boolean).join(" ") || "Vendedor"
      );
    }
  }

  const facts = rows.map((row) => ({
    ...row,
    seller_name: names.get(row.seller_id as string) ?? null,
  }));

  return {
    steps: funnel(facts as never),
    leaderboard: sellerLeaderboard(facts as never),
    rows: rows.length,
    truncated: rows.length >= MAX_FUNNEL_ROWS,
  };
}
