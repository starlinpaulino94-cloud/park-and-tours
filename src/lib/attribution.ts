/**
 * QUIÉN TRAJO AL CLIENTE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL HECHO Y LA POLÍTICA SON COSAS DISTINTAS
 *
 * Una atribución es un HECHO: «esta persona entró por el enlace de este
 * vendedor, este día, por este canal». No se edita ni se borra — hay un
 * disparador en la base (0058) que lo impide, no solo un comentario.
 *
 * A quién le toca la comisión NO se decide al guardar el hecho. Se decide AL
 * VENDER, leyendo el histórico con la política que la empresa tenga puesta. Por
 * eso esa decisión vive aquí, en una función pura, y no repartida por las rutas.
 *
 * La consecuencia es la que importa: cambiar la política mañana no reescribe el
 * pasado, y «¿cuántos clientes me trajo el QR del hotel?» se responde agrupando
 * filas en vez de reconstruyéndolo de memoria.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LAS TRES POLÍTICAS, Y A QUIÉN PREMIA CADA UNA
 *
 *  · **first** — quien lo trajo. Premia la captación: el conserje que puso el
 *    QR cobra aunque la venta la cierre el mostrador tres días después. Es el
 *    defecto, porque es el trabajo que nadie más iba a hacer.
 *  · **last** — quien lo cerró. Premia el cierre. Ojo con el efecto: una vez
 *    que alguien toca al cliente, se lleva todo lo siguiente hasta que otro lo
 *    toque.
 *  · **booking** — quien tomó la reserva. Si esa venta no nació de una reserva
 *    atribuida, cae a la última: nunca se deja una comisión sin dueño por un
 *    tecnicismo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ CADUCA
 *
 * Un QR escaneado hace ocho meses no es quien trajo la venta de hoy. Pagarlo
 * sería inventar una deuda, así que fuera de la ventana no hay atribución y la
 * venta queda como venta directa de la empresa — que es la verdad.
 *
 * Cero días significa «no caduca nunca», y es una elección legítima de una
 * operadora que trabaja con dos hoteles fijos.
 *
 * Todo lo de aquí es puro. Quien lee la base y escribe es
 * `attribution-service.ts`.
 */

// ── El embudo ───────────────────────────────────────────────────────────────

export const FUNNEL_STAGES = ["visit", "signup", "booking", "purchase"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const STAGE_LABEL: Record<FunnelStage, string> = {
  visit: "Visitas",
  signup: "Clientes captados",
  booking: "Reservas",
  purchase: "Compras",
};

export function isStage(value: unknown): value is FunnelStage {
  return typeof value === "string" && (FUNNEL_STAGES as readonly string[]).includes(value);
}

// ── El canal declarado del enlace ───────────────────────────────────────────

export const LINK_CHANNELS = ["qr", "link", "whatsapp", "social", "email", "print"] as const;
export type LinkChannel = (typeof LINK_CHANNELS)[number];

export const CHANNEL_LABEL: Record<LinkChannel, string> = {
  qr: "QR impreso",
  link: "Enlace",
  whatsapp: "WhatsApp",
  social: "Redes sociales",
  email: "Correo",
  print: "Material impreso",
};

/**
 * El canal llega de la URL (`?c=qr`), o sea de cualquiera. Lo que no
 * reconocemos es un enlace normal: un dato honesto y genérico vale más que una
 * precisión inventada, y sobre todo no mete basura en el informe por canal.
 */
export function normalizeChannel(value: unknown): LinkChannel {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (LINK_CHANNELS as readonly string[]).includes(v) ? (v as LinkChannel) : "link";
}

// ── La política de la empresa ───────────────────────────────────────────────

export const ATTRIBUTION_POLICIES = ["first", "last", "booking"] as const;
export type AttributionPolicy = (typeof ATTRIBUTION_POLICIES)[number];

export const POLICY_LABEL: Record<AttributionPolicy, string> = {
  first: "Primer contacto (quien lo trajo)",
  last: "Último contacto (quien lo cerró)",
  booking: "Quien tomó la reserva",
};

export function normalizePolicy(value: unknown): AttributionPolicy {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (ATTRIBUTION_POLICIES as readonly string[]).includes(v)
    ? (v as AttributionPolicy)
    : "first";
}

/** Días que vive una atribución sin convertirse. */
export const DEFAULT_WINDOW_DAYS = 30;

/** Nombre de la cookie del visitante: lo único que hay antes de que exista el cliente. */
export const VISITOR_COOKIE = "pt_vis";
/** Nombre de la cookie del enlace que lo trajo. */
export const REFERRAL_COOKIE = "pt_ref";

/**
 * Cuánto vive la cookie. Se le da margen sobre la ventana porque la cookie que
 * caduca antes que la ventana convierte una atribución viva en una venta
 * huérfana: el hecho seguía siendo válido y nadie pudo leerlo.
 */
export function cookieMaxAgeSeconds(windowDays: number): number {
  const days = Number.isFinite(windowDays) && windowDays > 0 ? windowDays : 365;
  return Math.min(Math.round(days * 1.5), 400) * 24 * 60 * 60;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** ¿Este hecho sigue vivo a fecha de `now`? Cero o menos = no caduca. */
export function withinWindow(at: unknown, windowDays: number, now: Date = new Date()): boolean {
  const date = toDate(at);
  if (!date) return false;
  if (!Number.isFinite(windowDays) || windowDays <= 0) return true;
  return date.getTime() >= now.getTime() - windowDays * 86_400_000;
}

// ── Resolver a quién le toca ────────────────────────────────────────────────

export interface AttributionFact {
  _id?: string | null;
  id?: string | null;
  seller_id?: string | null;
  seller?: unknown;
  stage?: string | null;
  channel?: string | null;
  created_at?: string | Date | null;
}

/** El id del hecho, venga del traductor (`_id`) o de la fila cruda (`id`). */
export function factId(fact: AttributionFact): string | null {
  return fact._id ?? fact.id ?? null;
}

/**
 * El id del vendedor del hecho. La fila cruda trae `seller_id`; la expandida
 * trae `seller` como objeto. Un hecho sin vendedor no atribuye nada.
 */
export function factSeller(fact: AttributionFact): string | null {
  if (fact.seller_id) return fact.seller_id;
  const s = fact.seller;
  if (typeof s === "string") return s || null;
  if (s && typeof s === "object") {
    const o = s as Record<string, unknown>;
    const id = o._id ?? o.id;
    return typeof id === "string" && id ? id : null;
  }
  return null;
}

export interface ResolveOptions {
  policy?: AttributionPolicy;
  windowDays?: number;
  now?: Date;
}

/**
 * El hecho que gana esta venta, o `null` si no hay ninguno vivo.
 *
 * Devuelve el HECHO entero y no solo el id del vendedor a propósito: la venta
 * congela cuál fue (`sales_order.attribution_id`), y sin eso una comisión
 * discutida seis semanas después solo se podría defender repitiendo el cálculo
 * con las reglas de hoy — que son justo las que pueden haber cambiado.
 */
export function resolveAttribution(
  facts: AttributionFact[],
  options: ResolveOptions = {}
): AttributionFact | null {
  const now = options.now ?? new Date();
  const policy = normalizePolicy(options.policy);
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;

  const alive = facts
    .filter((f) => factSeller(f) && withinWindow(f.created_at, windowDays, now))
    .sort((a, b) => {
      const ta = toDate(a.created_at)?.getTime() ?? 0;
      const tb = toDate(b.created_at)?.getTime() ?? 0;
      return ta - tb;
    });

  if (alive.length === 0) return null;

  if (policy === "booking") {
    const fromBooking = alive.filter((f) => f.stage === "booking");
    if (fromBooking.length > 0) return fromBooking[fromBooking.length - 1];
    return alive[alive.length - 1];
  }
  if (policy === "last") return alive[alive.length - 1];
  return alive[0];
}

// ── El embudo, contado ──────────────────────────────────────────────────────

export interface FunnelStep {
  stage: FunnelStage;
  label: string;
  count: number;
  /**
   * Conversión desde la etapa anterior, en porcentaje. `null` en la primera
   * etapa y cuando la anterior es cero: dividir entre cero y pintar «0 %»
   * diría que el vendedor convierte mal, cuando lo que pasa es que aún no ha
   * traído a nadie.
   */
  conversionPct: number | null;
}

/**
 * Cuenta PERSONAS, no eventos.
 *
 * Un visitante que recarga la página cinco veces deja cinco filas; contarlas
 * como cinco visitas infla el embudo del vendedor que más recargas provoca. Se
 * cuenta por persona: la ficha del cliente si ya existe, y si no la cookie.
 */
export function funnel(
  facts: (AttributionFact & { customer_id?: string | null; visitor_id?: string | null })[]
): FunnelStep[] {
  const buckets = new Map<FunnelStage, Set<string>>();
  for (const stage of FUNNEL_STAGES) buckets.set(stage, new Set());

  for (const fact of facts) {
    if (!isStage(fact.stage)) continue;
    const who = fact.customer_id || fact.visitor_id || factId(fact);
    if (!who) continue;
    buckets.get(fact.stage)!.add(who);
  }

  let previous: number | null = null;
  return FUNNEL_STAGES.map((stage) => {
    const count = buckets.get(stage)!.size;
    const conversionPct =
      previous === null || previous === 0 ? null : Math.round((count / previous) * 1000) / 10;
    previous = count;
    return { stage, label: STAGE_LABEL[stage], count, conversionPct };
  });
}

// ── El slug del enlace ──────────────────────────────────────────────────────

/**
 * El slug va impreso en un QR pegado en un mostrador, así que se teclea a mano
 * el día que la cámara falla. Por eso no lleva guiones, ni acentos, ni
 * minúsculas mezcladas: nada que haya que explicar por teléfono.
 *
 * Tampoco se deriva del nombre. El nombre cambia —una persona se casa, un hotel
 * cambia de marca— y el QR ya está impreso y pegado.
 */
export function slugify(seed: string): string {
  return (seed || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    // Se corta: un slug que no cabe bajo el QR impreso se lee mal y se teclea peor.
    .slice(0, 16);
}

/**
 * Los dos miembros de cada pareja que se confunde al leerla de un papel están
 * fuera: O/0, I/1, L/1, S/5, B/8. Se quitan LOS DOS y no uno: dejar el 8 y
 * quitar la B no arregla nada, porque quien lee «8» en un cartel impreso a 300
 * ppp sigue tecleando «B». Un slug mal tecleado no lleva a ningún sitio y nadie
 * sabe por qué.
 */
const SAFE_ALPHABET = "ACDEFGHJKMNPQRTUVWXYZ234679";

export function randomSuffix(length = 4, random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += SAFE_ALPHABET[Math.floor(random() * SAFE_ALPHABET.length) % SAFE_ALPHABET.length];
  }
  return out;
}

/**
 * Propone el slug de un enlace nuevo: el código comercial del vendedor más un
 * sufijo, porque un mismo vendedor tiene varios QR («mostrador», «playa»).
 */
export function proposeSlug(
  sellerCode: string | null | undefined,
  random: () => number = Math.random
): string {
  const base = slugify(sellerCode || "") || "VEN";
  return `${base.slice(0, 10)}${randomSuffix(4, random)}`;
}

/** La URL que se imprime bajo el QR. Sin barra final: se copia a mano. */
export function linkUrl(baseUrl: string, slug: string): string {
  const root = (baseUrl || "").replace(/\/+$/, "");
  return `${root}/e/${encodeURIComponent(slug)}`;
}

// ── La ficha del vendedor ───────────────────────────────────────────────────

export interface SellerFunnelRow {
  seller_id: string;
  seller_name: string;
  visits: number;
  signups: number;
  bookings: number;
  purchases: number;
  /** De cada cien visitas, cuántas acabaron en compra. */
  closePct: number | null;
}

/**
 * El cuadro comparativo de la red comercial. Ordena por compras y, a igualdad,
 * por clientes captados: dos vendedores con una venta cada uno no son lo mismo
 * si uno trajo veinte clientes y el otro dos.
 */
export function sellerLeaderboard(
  facts: (AttributionFact & {
    customer_id?: string | null;
    visitor_id?: string | null;
    seller_name?: string | null;
  })[]
): SellerFunnelRow[] {
  const bySeller = new Map<string, typeof facts>();
  for (const fact of facts) {
    const seller = factSeller(fact);
    if (!seller) continue;
    const list = bySeller.get(seller) ?? [];
    list.push(fact);
    bySeller.set(seller, list);
  }

  const rows: SellerFunnelRow[] = [];
  for (const [seller_id, list] of bySeller) {
    const steps = funnel(list);
    const at = (s: FunnelStage) => steps.find((x) => x.stage === s)?.count ?? 0;
    const visits = at("visit");
    const purchases = at("purchase");
    rows.push({
      seller_id,
      seller_name: list.find((f) => f.seller_name)?.seller_name || "Vendedor",
      visits,
      signups: at("signup"),
      bookings: at("booking"),
      purchases,
      closePct: visits > 0 ? Math.round((purchases / visits) * 1000) / 10 : null,
    });
  }

  return rows.sort((a, b) => b.purchases - a.purchases || b.signups - a.signups);
}
