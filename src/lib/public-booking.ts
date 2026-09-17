/**
 * EL MOTOR DE RESERVAS PÚBLICO: las decisiones, en puro.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTA ES LA PRIMERA PUERTA POR LA QUE ENTRA ALGUIEN SIN CUENTA
 *
 * Todo lo demás del sistema tiene detrás una sesión, un rol y una empresa. Aquí
 * no hay nada de eso: hay un desconocido en internet escribiendo en la base de
 * una operadora. Las reglas de este archivo existen para que eso siga siendo
 * seguro, y todas salen de la misma idea:
 *
 *   DEL CLIENTE SOLO SE ACEPTA LO QUE NO SE PUEDE CALCULAR AQUÍ.
 *
 * Su nombre, su correo, su teléfono, cuántos van y qué día: eso solo lo sabe
 * él. El precio, el cupo, la moneda y el estado de la reserva los decide el
 * servidor SIEMPRE, aunque el formulario mande otra cosa. Un motor público que
 * acepta el precio del cliente es una tienda donde cada quien pone su etiqueta.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y LO QUE SE PUBLICA ES EXACTAMENTE LO QUE SE PIDIÓ PUBLICAR
 *
 * Dos interruptores, los dos apagados de fábrica (0047): la empresa activa su
 * página y luego publica producto por producto. Hay excursiones que solo se
 * venden a agencias y otras a medio armar; enseñar el catálogo entero por
 * defecto sería publicar lo que nadie quiso publicar, y eso no se deshace una
 * vez que está indexado.
 */

/* ------------------------------------------------------ la página existe */

export type PublicPageState = "ok" | "not_found" | "disabled" | "suspended";

export interface PublicOrg {
  status?: string | null;
  public_booking_enabled?: boolean | null;
  subscription_status?: string | null;
}

/**
 * ¿Se puede enseñar esta página?
 *
 * `not_found` y `disabled` se responden IGUAL hacia fuera —un 404— porque la
 * diferencia solo le sirve a quien está probando slugs para averiguar qué
 * empresas usan el sistema. Se distinguen aquí porque dentro sí importan: una
 * es un error del enlace y la otra, una empresa que no ha activado su página.
 */
export function publicPageState(org: PublicOrg | null | undefined): PublicPageState {
  if (!org) return "not_found";
  if (org.public_booking_enabled !== true) return "disabled";
  if (org.status && org.status !== "active") return "suspended";
  return "ok";
}

/* ------------------------------------------------------- qué se enseña */

export interface PublicProductRow {
  _id?: string;
  name?: string | null;
  code?: string | null;
  status?: string | null;
  published?: boolean | null;
  short_description?: string | null;
  description?: string | null;
  cover_image_url?: string | null;
  location?: string | null;
  meeting_point?: string | null;
  duration_hours?: number | null;
  min_age?: number | null;
  languages?: string[] | null;
  inclusions?: string | null;
  exclusions?: string | null;
  base_price?: number | null;
  public_price_from?: number | null;
  currency?: string | null;
  featured?: boolean | null;
  sort_order?: number | null;
}

/** Lo que de verdad se ve: publicado Y activo. */
export function isPublishable(product: PublicProductRow): boolean {
  return product.published === true && (product.status ?? "active") === "active";
}

/**
 * La ficha pública de un producto: SOLO lo que se enseña.
 *
 * Se construye por lista blanca y no quitando campos, que es la diferencia
 * entre un error y una fuga: cuando alguien añada `base_cost` o `supplier` al
 * producto, este objeto no cambia. Al revés —quitando— el campo nuevo se
 * publicaría solo, y el margen de la operadora acabaría en su página web.
 */
export interface PublicProductCard {
  id: string;
  name: string;
  summary: string;
  description: string;
  image: string | null;
  location: string | null;
  meetingPoint: string | null;
  durationHours: number | null;
  minAge: number | null;
  languages: string[];
  inclusions: string | null;
  exclusions: string | null;
  priceFrom: number | null;
  currency: string;
  featured: boolean;
}

export function toPublicCard(product: PublicProductRow, fallbackCurrency = "usd"): PublicProductCard {
  return {
    id: String(product._id),
    name: String(product.name || "Excursión"),
    summary: String(product.short_description || ""),
    description: String(product.description || ""),
    image: product.cover_image_url || null,
    location: product.location || null,
    meetingPoint: product.meeting_point || null,
    durationHours: product.duration_hours ?? null,
    minAge: product.min_age ?? null,
    languages: Array.isArray(product.languages) ? product.languages : [],
    inclusions: product.inclusions || null,
    exclusions: product.exclusions || null,
    // El «desde» explícito manda sobre el precio base: es el que la operadora
    // decidió enseñar cuando el real depende de modalidad o temporada.
    priceFrom: product.public_price_from ?? product.base_price ?? null,
    currency: String(product.currency || fallbackCurrency).toLowerCase(),
    featured: product.featured === true,
  };
}

/* --------------------------------------------------- la petición que llega */

export interface PublicRequestInput {
  productId?: unknown;
  departureId?: unknown;
  date?: unknown;
  adults?: unknown;
  children?: unknown;
  infants?: unknown;
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  hotel?: unknown;
  room?: unknown;
  notes?: unknown;
  language?: unknown;
  /** Campo trampa: los humanos no lo ven, los robots lo rellenan. */
  website?: unknown;
}

export interface PublicRequest {
  productId: string;
  departureId: string | null;
  adults: number;
  children: number;
  infants: number;
  name: string;
  email: string;
  phone: string;
  hotel: string;
  room: string;
  notes: string;
  language: string;
}

export type RequestProblem =
  | "spam"
  | "product"
  | "departure"
  | "pax"
  | "too_many"
  | "name"
  | "contact"
  | "email";

export const REQUEST_PROBLEM_MESSAGE: Record<RequestProblem, string> = {
  spam: "No pudimos procesar la solicitud.",
  product: "Elige la excursión que quieres reservar.",
  departure: "Elige la fecha de tu excursión.",
  pax: "Indica al menos una persona.",
  too_many: "Para grupos grandes, escríbenos: te preparamos una cotización a medida.",
  name: "Escribe tu nombre completo.",
  contact: "Déjanos un correo o un teléfono para confirmarte.",
  email: "Ese correo no parece válido.",
};

/**
 * A partir de cuántas personas deja de ser una reserva web.
 *
 * Doce. No es una limitación técnica: un grupo de treinta necesita otro precio,
 * otro transporte y una conversación. Dejarlo entrar como reserva normal le
 * promete al cliente una plaza que quizá no exista y le rompe el día a
 * operaciones.
 */
export const MAX_PUBLIC_PAX = 12;

const text = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const count = (value: unknown): number => {
  const n = Math.floor(Number(value ?? 0));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 99) : 0;
};

/**
 * Valida y limpia lo que llegó del formulario.
 *
 * Devuelve el problema MÁS importante, no todos: una lista de siete errores en
 * un formulario público consigue que el cliente cierre la pestaña.
 */
export function readPublicRequest(
  input: PublicRequestInput
): { ok: true; request: PublicRequest } | { ok: false; problem: RequestProblem } {
  // El campo trampa: si viene relleno, lo rellenó un robot. Se responde con un
  // error genérico en vez de «detectamos un robot», que solo le enseña al
  // siguiente cómo evitarlo.
  if (text(input.website, 200) !== "") return { ok: false, problem: "spam" };

  const productId = text(input.productId, 64);
  if (!productId) return { ok: false, problem: "product" };

  const adults = count(input.adults);
  const children = count(input.children);
  const infants = count(input.infants);
  const pax = adults + children + infants;
  if (pax === 0) return { ok: false, problem: "pax" };
  if (pax > MAX_PUBLIC_PAX) return { ok: false, problem: "too_many" };

  const name = text(input.name, 120);
  if (name.length < 3) return { ok: false, problem: "name" };

  const email = text(input.email, 160).toLowerCase();
  const phone = text(input.phone, 40);
  if (!email && !phone) return { ok: false, problem: "contact" };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, problem: "email" };

  return {
    ok: true,
    request: {
      productId,
      departureId: text(input.departureId, 64) || null,
      adults, children, infants,
      name, email, phone,
      hotel: text(input.hotel, 120),
      room: text(input.room, 30),
      notes: text(input.notes, 500),
      language: text(input.language, 10) || "es",
    },
  };
}

/** El nombre partido como lo guarda la ficha de cliente. */
export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  // Dos apellidos son lo normal aquí: se parte por la PRIMERA palabra, no por
  // la última, para no convertir «Ana María Pérez Gómez» en «Gómez, Ana María
  // Pérez».
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

/* ------------------------------------------------ lo que se le contesta */

export interface PublicConfirmation {
  reference: string;
  product: string;
  date: string | null;
  pax: number;
  total: number | null;
  currency: string;
  payNote: string;
}

/**
 * Lo que ve el cliente al terminar.
 *
 * Dice SOLICITUD y no «reserva confirmada» cuando todavía no hay pago: una
 * página que dice «confirmada» y luego llama para decir que no había cupo es
 * peor que no tener página.
 */
export function confirmationNote(hasPayment: boolean, terms?: string | null): string {
  if (terms && terms.trim()) return terms.trim();
  return hasPayment
    ? "Tu reserva está confirmada. Te enviamos el voucher por correo."
    : "Recibimos tu solicitud. Te confirmamos la plaza y el pago por correo o WhatsApp en breve.";
}
