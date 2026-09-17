/**
 * EL ESTÁNDAR OCTO, LADO PROVEEDOR.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ES ESTO Y POR QUÉ NO ES «UN CONECTOR DE VIATOR»
 *
 * OCTO —Open Connectivity for Tours, Activities and Attractions— es la
 * especificación abierta con la que las OTA de excursiones se conectan a los
 * proveedores. Define los mismos endpoints, los mismos nombres de campo y los
 * mismos estados para todos, y la consumen GetYourGuide, Viator, Klook y las
 * plataformas de conectividad que revenden a decenas más.
 *
 * Aquí la operadora es el PROVEEDOR: tiene el inventario y los demás le
 * compran. Por eso se implementa el lado proveedor y no un cliente: se publica
 * una dirección y se conecta cualquiera que hable el estándar, en vez de
 * escribir —y mantener— una integración distinta por cada OTA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL MAPEO, QUE ES TODA LA DECISIÓN
 *
 *   Supplier      → la empresa
 *   Product       → `product`
 *   Option        → `product_modality`, más una opción `default` para el
 *                   producto que no tiene modalidades
 *   Unit          → ADULT / CHILD / INFANT, que es exactamente lo que la
 *                   reserva ya guarda (`adults`, `children`, `infants`)
 *   Availability  → `departure`, y su `id` es el id de la salida
 *   Booking       → una `booking`
 *
 * La tentación era mapear Option a «salida» y Unit a «modalidad». Sería más
 * cómodo de escribir y estaría mal: en OCTO la Option se elige UNA vez por
 * reserva y las Units se cuentan por viajero, que es literalmente cómo funciona
 * `resolvePrice` (una modalidad por línea, adultos/niños/infantes aparte).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOS DOS ESTADOS QUE NO SON LOS NUESTROS
 *
 * OCTO distingue ON_HOLD de CONFIRMED —la retención antes del pago— y, sobre
 * todo, EXPIRED de CANCELLED. Para una OTA no es lo mismo que la retención
 * venciera (culpa suya, no hay incidencia) a que alguien cancelara (hay que
 * decidir reembolso). Nuestro `status` no sabe distinguirlo, así que el estado
 * OCTO se guarda aparte y aquí se RECONCILIA con la realidad.
 *
 * Todo lo de este archivo es puro. Quien lee la base y escribe es
 * `octo-service.ts`.
 */

/* ════════════════════════════════════════════════════ tipos del estándar ══ */

export type OctoBookingStatus =
  | "ON_HOLD" | "CONFIRMED" | "EXPIRED" | "CANCELLED" | "REDEEMED" | "PENDING" | "REJECTED";

export type OctoAvailabilityStatus =
  | "AVAILABLE" | "FREESALE" | "SOLD_OUT" | "LIMITED" | "CLOSED";

export type OctoUnitType =
  | "ADULT" | "YOUTH" | "CHILD" | "INFANT" | "FAMILY" | "SENIOR" | "STUDENT" | "MILITARY" | "OTHER";

export type OctoAvailabilityType = "START_TIME" | "OPENING_HOURS";
export type OctoDeliveryFormat = "PDF_URL" | "QRCODE" | "CODE128" | "PKPASS_URL" | "AZTECCODE";
export type OctoDeliveryMethod = "VOUCHER" | "TICKET";
export type OctoRedemptionMethod = "DIGITAL" | "PRINT" | "MANIFEST";
export type OctoPricingPer = "BOOKING" | "UNIT";
export type OctoDurationUnit = "minute" | "hour" | "day";

/**
 * Los códigos de error del estándar, tal cual.
 *
 * No son decorativos: el revendedor ramifica su lógica sobre esta cadena. Un
 * `INVALID_AVAILABILITY_ID` hace que vuelva a pedir disponibilidad; un
 * `UNPROCESSABLE_ENTITY` hace que avise a un humano. Devolver el código
 * equivocado —o uno inventado— es peor que devolver un 500: el otro lado actúa
 * con confianza sobre una conclusión falsa.
 */
export type OctoErrorCode =
  | "INVALID_PRODUCT_ID"
  | "INVALID_OPTION_ID"
  | "INVALID_UNIT_ID"
  | "INVALID_AVAILABILITY_ID"
  | "INVALID_BOOKING_UUID"
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "UNPROCESSABLE_ENTITY"
  | "INTERNAL_SERVER_ERROR";

/** El código HTTP con el que viaja cada error del estándar. */
export const OCTO_ERROR_STATUS: Record<OctoErrorCode, number> = {
  INVALID_PRODUCT_ID: 400,
  INVALID_OPTION_ID: 400,
  INVALID_UNIT_ID: 400,
  INVALID_AVAILABILITY_ID: 400,
  INVALID_BOOKING_UUID: 400,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  UNPROCESSABLE_ENTITY: 422,
  INTERNAL_SERVER_ERROR: 500,
};

export interface OctoErrorBody {
  error: OctoErrorCode;
  errorMessage: string;
  [extra: string]: unknown;
}

/** Construye el cuerpo de error del estándar, con el campo señalado si lo hay. */
export function octoErrorBody(
  code: OctoErrorCode,
  message: string,
  pointer?: { productId?: string; optionId?: string; unitId?: string; availabilityId?: string; uuid?: string }
): OctoErrorBody {
  return { error: code, errorMessage: message, ...(pointer ?? {}) };
}

/* ══════════════════════════════════════════════════════════ capacidades ══ */

export type OctoCapability =
  | "octo/content" | "octo/pricing" | "octo/pickups" | "octo/cart" | "octo/adjustments"
  | "octo/mappings" | "octo/offers" | "octo/packages" | "octo/questions" | "octo/webhooks";

/**
 * Lo que esta implementación sabe hacer de verdad.
 *
 * La lista corta es una decisión, no una carencia disimulada: anunciar una
 * capacidad que no se cumple es la forma más rápida de romper una conexión en
 * producción, porque el revendedor deja de mandar los campos que compensaban su
 * ausencia. `octo/content` (textos e imágenes del producto), `octo/pricing`
 * (precios) y `octo/pickups` (recogida en hotel) son las tres que este sistema
 * puede sostener con los datos que ya tiene.
 */
export const SUPPORTED_CAPABILITIES: OctoCapability[] = ["octo/content", "octo/pricing", "octo/pickups"];

export interface CapabilityDescriptor {
  id: OctoCapability;
  revision: number;
  required: boolean;
  dependencies: OctoCapability[];
  docs: string | null;
}

export function capabilityCatalog(): CapabilityDescriptor[] {
  return SUPPORTED_CAPABILITIES.map((id) => ({
    id,
    revision: 1,
    required: false,
    dependencies: [],
    docs: null,
  }));
}

/**
 * Lee la cabecera `Octo-Capabilities` (o el parámetro `_capabilities`).
 *
 * Se ignoran en silencio las que no soportamos, que es lo que manda el
 * estándar: un revendedor pide todo lo que sabe usar y espera recibir lo que
 * haya. Fallar aquí dejaría fuera a media industria por pedir algo de más.
 */
export function parseCapabilities(raw: string | null | undefined): OctoCapability[] {
  if (!raw) return [];
  const asked = raw.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean);
  const supported = new Set<string>(SUPPORTED_CAPABILITIES);
  const out: OctoCapability[] = [];
  for (const one of asked) {
    if (supported.has(one) && !out.includes(one as OctoCapability)) out.push(one as OctoCapability);
  }
  return out;
}

export function hasCapability(active: OctoCapability[], wanted: OctoCapability): boolean {
  return active.includes(wanted);
}

/* ═══════════════════════════════════════════════════════════════ fechas ══ */

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * El desplazamiento horario de una zona en un instante, en minutos.
 *
 * Hace falta porque OCTO pide `localDateTimeStart` en ISO 8601 CON offset
 * («2026-11-17T09:00:00-04:00»), y no basta con recortar la fecha: un
 * revendedor que reciba la hora sin offset la interpreta en SU zona y le enseña
 * al cliente una salida a las 3 de la mañana.
 *
 * Se resuelve con `Intl`, que es quien conoce el horario de verano, en vez de
 * con una tabla de offsets que caduca.
 */
export function offsetMinutes(instant: Date, timeZone: string): number {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const parts: Record<string, string> = {};
    for (const part of fmt.formatToParts(instant)) parts[part.type] = part.value;
    // `Date.UTC` sobre las partes leídas en esa zona da el instante que
    // tendría esa misma lectura en UTC; la diferencia es el desplazamiento.
    const asUtc = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour === "24" ? "0" : parts.hour), Number(parts.minute), Number(parts.second)
    );
    return Math.round((asUtc - instant.getTime()) / 60_000);
  } catch {
    return 0;
  }
}

/** «2026-11-17T09:00:00-04:00»: la hora local del producto, con su offset. */
export function localDateTime(iso: string, timeZone: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return iso;
  const offset = offsetMinutes(instant, timeZone);
  const shifted = new Date(instant.getTime() + offset * 60_000);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** «2026-11-17»: el día local del producto, que es por el que agrupa el calendario. */
export function localDate(iso: string, timeZone: string): string {
  return localDateTime(iso, timeZone).slice(0, 10);
}

/** El instante en UTC con el formato que el estándar espera («…Z»). */
export function utc(iso: string | Date | null | undefined): string | null {
  if (!iso) return null;
  const date = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** ¿Es un día válido en formato ISO corto? */
export function isLocalDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/* ═════════════════════════════════════════════════════════════ unidades ══ */

/**
 * Las tres unidades, y por qué son exactamente tres.
 *
 * La reserva guarda `adults`, `children` e `infants`. Ofrecer más tipos de
 * unidad (SENIOR, STUDENT) obligaría a inventar dónde se cuentan, y acabarían
 * sumándose a adultos sin que el revendedor lo supiera: vendería una entrada de
 * estudiante y recibiría una de adulto al precio de adulto.
 *
 * Las modalidades que SÍ son tramos de precio distintos (residente,
 * extranjero, VIP) se ofrecen como OPCIONES, que es donde el estándar las pone
 * y donde nuestro motor de precios las resuelve.
 */
export const OCTO_UNITS = [
  { id: "adult", type: "ADULT" as OctoUnitType, internalName: "Adulto", paxCount: 1 },
  { id: "child", type: "CHILD" as OctoUnitType, internalName: "Niño", paxCount: 1 },
  { id: "infant", type: "INFANT" as OctoUnitType, internalName: "Infante", paxCount: 1 },
];

export const UNIT_IDS = new Set(OCTO_UNITS.map((u) => u.id));

export interface OctoUnit {
  id: string;
  internalName: string;
  reference: string | null;
  type: OctoUnitType;
  restrictions: {
    minAge: number;
    maxAge: number;
    idRequired: boolean;
    minQuantity: number | null;
    maxQuantity: number | null;
    paxCount: number;
    accompaniedBy: string[];
  };
  requiredContactFields: string[];
  title?: string | null;
  pricingFrom?: OctoPricing[];
}

export interface ProductLike {
  _id: string;
  name?: string;
  code?: string;
  short_description?: string | null;
  description?: string | null;
  cover_image_url?: string | null;
  location?: string | null;
  meeting_point?: string | null;
  duration_hours?: number | null;
  min_age?: number | null;
  base_price?: number | null;
  currency?: string | null;
  status?: string | null;
  published?: boolean | null;
  inclusions?: string | null;
  exclusions?: string | null;
}

export interface ModalityLike {
  _id: string;
  name?: string;
  code?: string;
  modality_type?: string | null;
  price?: number | null;
  currency?: string | null;
  min_pax?: number | null;
  max_pax?: number | null;
  age_from?: number | null;
  age_to?: number | null;
  sort_order?: number | null;
  status?: string | null;
}

/**
 * El tramo de edad de cada unidad.
 *
 * Sale de las modalidades cuando existen —una operadora que cobra al niño de 3
 * a 11 lo tiene escrito ahí— y de la edad mínima del producto cuando no. Sin
 * esto, el revendedor no puede validar en su formulario y manda un niño de 2
 * años como niño de pago, que es exactamente la discusión del mostrador.
 */
export function unitAges(product: ProductLike, modalities: ModalityLike[]): Record<string, { from: number; to: number }> {
  const byType = new Map<string, ModalityLike>();
  for (const m of modalities) {
    const kind = (m.modality_type ?? "").toLowerCase();
    if (!byType.has(kind)) byType.set(kind, m);
  }
  const minAge = Math.max(0, Math.floor(Number(product.min_age ?? 0) || 0));
  const from = (kind: string, fallback: number) => {
    const found = byType.get(kind);
    const value = Number(found?.age_from ?? NaN);
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
  };
  const to = (kind: string, fallback: number) => {
    const found = byType.get(kind);
    const value = Number(found?.age_to ?? NaN);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  };
  return {
    adult: { from: from("adult", Math.max(minAge, 12)), to: to("adult", 99) },
    child: { from: from("child", Math.max(minAge, 2)), to: to("child", 11) },
    infant: { from: from("infant", 0), to: to("infant", 1) },
  };
}

export function unitsOf(product: ProductLike, modalities: ModalityLike[]): OctoUnit[] {
  const ages = unitAges(product, modalities);
  return OCTO_UNITS.map((unit) => ({
    id: unit.id,
    internalName: unit.internalName,
    reference: unit.id,
    type: unit.type,
    restrictions: {
      minAge: ages[unit.id].from,
      maxAge: ages[unit.id].to,
      idRequired: false,
      minQuantity: null,
      maxQuantity: null,
      // El infante no ocupa plaza: va en brazos y no se le cuenta contra el
      // cupo. Decirlo aquí evita que el revendedor crea que una salida con una
      // sola plaza libre no admite a una madre con su bebé.
      paxCount: unit.id === "infant" ? 0 : 1,
      accompaniedBy: unit.id === "infant" ? ["adult"] : [],
    },
    requiredContactFields: [],
  }));
}

/* ═══════════════════════════════════════════════════════════════ precio ══ */

export interface OctoPricing {
  original: number;
  retail: number;
  net: number | null;
  currency: string;
  currencyPrecision: number;
  includedTaxes: { name: string; amount: number; currency: string; currencyPrecision: number }[];
}

/**
 * OCTO cuenta el dinero en la unidad MÍNIMA de la moneda: 25.50 USD son 2550.
 *
 * Es el error clásico de estas integraciones y el más caro: mandar 25.5 en vez
 * de 2550 le vende la excursión al revendedor por veinticinco centavos.
 */
export function minorUnits(amount: number, precision = 2): number {
  const factor = Math.pow(10, precision);
  return Math.round((Number(amount) || 0) * factor);
}

export function pricing(amount: number, currency: string, precision = 2): OctoPricing {
  const value = minorUnits(amount, precision);
  return {
    original: value,
    retail: value,
    net: null,
    currency: (currency || "usd").toUpperCase(),
    currencyPrecision: precision,
    includedTaxes: [],
  };
}

/* ════════════════════════════════════════════════════════════ opciones ══ */

export interface OctoOption {
  id: string;
  default: boolean;
  internalName: string;
  reference: string | null;
  availabilityLocalStartTimes: string[];
  cancellationCutoff: string;
  cancellationCutoffAmount: number;
  cancellationCutoffUnit: OctoDurationUnit;
  requiredContactFields: string[];
  restrictions: { minUnits: number | null; maxUnits: number | null };
  units: OctoUnit[];
  title?: string;
  pricingFrom?: OctoPricing[];
}

export const DEFAULT_OPTION_ID = "default";

/**
 * Las modalidades que son OPCIÓN y no tramo de edad.
 *
 * Adulto, niño e infante ya viajan como unidades; volver a ofrecerlas como
 * opción haría que el revendedor pudiera pedir «opción: niño, unidad: adulto»,
 * que no significa nada y que nuestro motor de precios resolvería de alguna
 * manera silenciosa.
 */
const UNIT_LIKE_MODALITIES = new Set(["adult", "child", "infant"]);

export function isOptionModality(modality: ModalityLike): boolean {
  if ((modality.status ?? "active") !== "active") return false;
  return !UNIT_LIKE_MODALITIES.has((modality.modality_type ?? "").toLowerCase());
}

export interface CancellationTierLike { hours_before: number; refund_pct: number }

/**
 * Hasta cuándo se puede cancelar sin penalización.
 *
 * Es el tramo MÁS CERCANO a la salida que todavía devuelve el 100 %. El
 * revendedor lo enseña en su ficha («cancelación gratuita hasta 24 h antes») y
 * lo usa para decidir si acepta una cancelación sin preguntar. Sin política
 * definida se contesta 24 h, que es lo que la industria da por supuesto —y se
 * documenta, para que la operadora sepa que le conviene definirla.
 */
export const DEFAULT_CANCELLATION_HOURS = 24;

export function cancellationCutoffHours(tiers: CancellationTierLike[] | null | undefined): number {
  const full = (tiers ?? []).filter((t) => Number(t.refund_pct) >= 100 && Number.isFinite(Number(t.hours_before)));
  if (full.length === 0) return DEFAULT_CANCELLATION_HOURS;
  return Math.max(0, Math.min(...full.map((t) => Math.floor(Number(t.hours_before)))));
}

/** «24 hours» / «3 days»: el formato legible que el estándar acompaña al número. */
export function cutoffLabel(hours: number): { amount: number; unit: OctoDurationUnit; label: string } {
  if (hours >= 24 && hours % 24 === 0) {
    const days = hours / 24;
    return { amount: days, unit: "day", label: `${days} day${days === 1 ? "" : "s"}` };
  }
  if (hours >= 1) return { amount: hours, unit: "hour", label: `${hours} hour${hours === 1 ? "" : "s"}` };
  const minutes = Math.max(0, Math.round(hours * 60));
  return { amount: minutes, unit: "minute", label: `${minutes} minute${minutes === 1 ? "" : "s"}` };
}

export interface OptionInput {
  product: ProductLike;
  modalities: ModalityLike[];
  startTimes: string[];
  cancellationTiers: CancellationTierLike[] | null;
  currency: string;
  capabilities: OctoCapability[];
}

export function optionsOf(input: OptionInput): OctoOption[] {
  const { product, modalities, startTimes, cancellationTiers, currency, capabilities } = input;
  const units = unitsOf(product, modalities);
  const hours = cancellationCutoffHours(cancellationTiers);
  const cutoff = cutoffLabel(hours);
  const withPricing = hasCapability(capabilities, "octo/pricing");

  const build = (id: string, name: string, reference: string | null, price: number, isDefault: boolean): OctoOption => ({
    id,
    default: isDefault,
    internalName: name,
    reference,
    availabilityLocalStartTimes: startTimes,
    cancellationCutoff: cutoff.label,
    cancellationCutoffAmount: cutoff.amount,
    cancellationCutoffUnit: cutoff.unit,
    requiredContactFields: ["firstName", "lastName"],
    restrictions: { minUnits: 1, maxUnits: null },
    units: withPricing
      ? units.map((unit) => ({ ...unit, pricingFrom: [pricing(unitPrice(price, unit.id), currency)] }))
      : units,
    ...(hasCapability(capabilities, "octo/content") ? { title: name } : {}),
    ...(withPricing ? { pricingFrom: [pricing(price, currency)] } : {}),
  });

  const options = modalities
    .filter(isOptionModality)
    .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
    .map((modality) =>
      build(
        modality._id,
        modality.name || modality.code || "Opción",
        modality.code ?? null,
        Number(modality.price ?? product.base_price ?? 0),
        false
      )
    );

  // Siempre hay una opción por defecto: el estándar exige al menos una, y un
  // producto sin modalidades —la mayoría— no tiene ninguna fila que ofrecer.
  const base = build(
    DEFAULT_OPTION_ID,
    product.name || "Estándar",
    product.code ?? null,
    Number(product.base_price ?? 0),
    true
  );
  return [base, ...options];
}

/**
 * El precio de referencia por unidad.
 *
 * Es `pricingFrom`: «desde», orientativo. El precio REAL de la reserva lo
 * calcula `resolvePrice` con la tarifa del socio, la temporada y las
 * promociones, y ninguna de esas tres cosas se puede anticipar aquí sin
 * mentir. El infante no paga, que es la única regla que sí es siempre cierta.
 */
export function unitPrice(basePrice: number, unitId: string): number {
  if (unitId === "infant") return 0;
  return Number(basePrice) || 0;
}

/* ═══════════════════════════════════════════════════════════ productos ══ */

export interface OctoProduct {
  id: string;
  internalName: string;
  reference: string | null;
  locale: string;
  timeZone: string;
  allowFreesale: boolean;
  instantConfirmation: boolean;
  instantDelivery: boolean;
  availabilityRequired: boolean;
  availabilityType: OctoAvailabilityType;
  deliveryFormats: OctoDeliveryFormat[];
  deliveryMethods: OctoDeliveryMethod[];
  redemptionMethod: OctoRedemptionMethod;
  options: OctoOption[];
  defaultCurrency?: string;
  availableCurrencies?: string[];
  pricingPer?: OctoPricingPer;
  title?: string;
  shortDescription?: string | null;
  description?: string | null;
  durationMinutesFrom?: number;
  durationMinutesTo?: number | null;
  locations?: { title: string }[];
}

export interface ProductInput extends OptionInput {
  timeZone: string;
  locale: string;
  hasDepartures: boolean;
}

/**
 * ¿Este producto se vende contra salidas o es de venta libre?
 *
 * No es cosmético. Si se declara `availabilityRequired: true` y el producto no
 * tiene ni una salida cargada, el revendedor pide disponibilidad, recibe una
 * lista vacía y concluye que la operadora está agotada todo el año. Si se
 * declara `false` cuando sí hay salidas, vendería sin mirar el cupo.
 */
export function toOctoProduct(input: ProductInput): OctoProduct {
  const { product, timeZone, locale, hasDepartures, capabilities, currency } = input;
  const withContent = hasCapability(capabilities, "octo/content");
  const duration = Number(product.duration_hours ?? 0);

  return {
    id: product._id,
    internalName: product.name || product.code || product._id,
    reference: product.code ?? null,
    locale,
    timeZone,
    allowFreesale: !hasDepartures,
    // La reserva nace retenida y se confirma aparte: eso ES el ciclo OCTO, no
    // una limitación. Decir `instantConfirmation: true` prometería que un
    // `reserve` ya es plaza cerrada.
    instantConfirmation: false,
    instantDelivery: true,
    availabilityRequired: hasDepartures,
    availabilityType: "START_TIME",
    deliveryFormats: ["QRCODE", "PDF_URL"],
    deliveryMethods: ["VOUCHER"],
    redemptionMethod: "DIGITAL",
    options: optionsOf(input),
    defaultCurrency: (currency || "usd").toUpperCase(),
    availableCurrencies: [(currency || "usd").toUpperCase()],
    pricingPer: "UNIT",
    ...(withContent
      ? {
          title: product.name || "",
          shortDescription: product.short_description ?? null,
          description: product.description ?? null,
          durationMinutesFrom: duration > 0 ? Math.round(duration * 60) : undefined,
          durationMinutesTo: duration > 0 ? Math.round(duration * 60) : null,
          locations: product.location ? [{ title: product.location }] : [],
        }
      : {}),
  };
}

/* ═════════════════════════════════════════════════════ disponibilidad ══ */

export interface DepartureLike {
  _id: string;
  departure_at?: string | null;
  capacity?: number | null;
  available_pax?: number | null;
  cutoff_hours?: number | null;
  status?: string | null;
  meeting_point?: string | null;
}

export interface OctoAvailability {
  id: string;
  localDateTimeStart: string;
  localDateTimeEnd: string;
  utcCutoffAt: string;
  allDay: boolean;
  available: boolean;
  status: OctoAvailabilityStatus;
  vacancies: number | null;
  capacity: number | null;
  maxUnits: number | null;
  openingHours: { from: string; to: string }[];
  unitPricing?: (OctoPricing & { unitId: string })[];
  pricing?: OctoPricing;
}

/** Los estados de salida que siguen admitiendo venta. */
export const SELLABLE_DEPARTURE = new Set(["available", "almost_full"]);

/**
 * El estado de una fecha según el estándar.
 *
 * `LIMITED` no es adorno: el revendedor lo usa para pintar «quedan pocas» y
 * para priorizar. El umbral del estándar es menos del 50 % de la capacidad.
 */
export function availabilityStatus(
  departure: DepartureLike,
  now: Date = new Date()
): OctoAvailabilityStatus {
  if (!SELLABLE_DEPARTURE.has((departure.status ?? "").toLowerCase())) return "CLOSED";
  if (departure.departure_at && new Date(departure.departure_at).getTime() <= now.getTime()) return "CLOSED";

  const capacity = Number(departure.capacity ?? 0);
  // Sin capacidad declarada la salida no tiene techo: es venta libre.
  if (!(capacity > 0)) return "FREESALE";

  const free = Math.max(0, Math.floor(Number(departure.available_pax ?? 0)));
  if (free <= 0) return "SOLD_OUT";
  return free < capacity / 2 ? "LIMITED" : "AVAILABLE";
}

/**
 * Hasta cuándo se admite reservar esa salida.
 *
 * `cutoff_hours` de la salida es el corte real de la operación: a dos horas de
 * salir, el conductor ya tiene la lista. Devolverlo deja que el revendedor
 * cierre la venta en su web en vez de aceptar una reserva que rebotaría.
 */
export function cutoffAt(departure: DepartureLike): string | null {
  if (!departure.departure_at) return null;
  const at = new Date(departure.departure_at);
  if (Number.isNaN(at.getTime())) return null;
  const hours = Math.max(0, Number(departure.cutoff_hours ?? 0) || 0);
  return new Date(at.getTime() - hours * 3_600_000).toISOString();
}

export interface AvailabilityInput {
  departure: DepartureLike;
  durationHours: number;
  timeZone: string;
  currency: string;
  unitPrices: { unitId: string; amount: number }[];
  capabilities: OctoCapability[];
  now?: Date;
}

export function toOctoAvailability(input: AvailabilityInput): OctoAvailability {
  const { departure, durationHours, timeZone, currency, unitPrices, capabilities } = input;
  const now = input.now ?? new Date();
  const status = availabilityStatus(departure, now);
  const startISO = departure.departure_at ?? new Date().toISOString();
  const endISO = new Date(new Date(startISO).getTime() + Math.max(0, durationHours) * 3_600_000).toISOString();
  const capacity = Number(departure.capacity ?? 0) > 0 ? Math.floor(Number(departure.capacity)) : null;
  const vacancies = status === "FREESALE" ? null : Math.max(0, Math.floor(Number(departure.available_pax ?? 0)));
  const start = localDateTime(startISO, timeZone);
  const end = localDateTime(endISO, timeZone);

  return {
    id: departure._id,
    localDateTimeStart: start,
    localDateTimeEnd: end,
    utcCutoffAt: cutoffAt(departure) ?? new Date(startISO).toISOString(),
    allDay: false,
    available: status === "AVAILABLE" || status === "LIMITED" || status === "FREESALE",
    status,
    vacancies,
    capacity,
    maxUnits: vacancies,
    openingHours: [{ from: start.slice(11, 16), to: end.slice(11, 16) }],
    ...(hasCapability(capabilities, "octo/pricing")
      ? {
          unitPricing: unitPrices.map((p) => ({ unitId: p.unitId, ...pricing(p.amount, currency) })),
          pricing: pricing(unitPrices.find((p) => p.unitId === "adult")?.amount ?? 0, currency),
        }
      : {}),
  };
}

export interface OctoCalendarDay {
  localDate: string;
  available: boolean;
  status: OctoAvailabilityStatus;
  vacancies: number | null;
  capacity: number | null;
  openingHours: { from: string; to: string }[];
  unitPricingFrom?: (OctoPricing & { unitId: string })[];
  pricingFrom?: OctoPricing;
}

/**
 * El calendario: un día por fila, resumiendo TODAS las salidas de ese día.
 *
 * El estándar pide que `vacancies` sea el máximo de las salidas del día, no la
 * suma. Es lo correcto aunque suene raro: el cliente compra una salida, y
 * decirle «quedan 30» cuando son 10 en tres horarios distintos hace que su
 * grupo de 20 elija ese día y no quepa en ninguno.
 */
export function toOctoCalendar(
  departures: DepartureLike[],
  timeZone: string,
  extras?: { currency?: string; unitPrices?: { unitId: string; amount: number }[]; capabilities?: OctoCapability[]; now?: Date }
): OctoCalendarDay[] {
  const now = extras?.now ?? new Date();
  const byDay = new Map<string, DepartureLike[]>();
  for (const departure of departures) {
    if (!departure.departure_at) continue;
    const day = localDate(departure.departure_at, timeZone);
    const list = byDay.get(day);
    if (list) list.push(departure);
    else byDay.set(day, [departure]);
  }

  const capabilities = extras?.capabilities ?? [];
  const withPricing = hasCapability(capabilities, "octo/pricing");

  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, list]) => {
      const states = list.map((departure) => ({ departure, status: availabilityStatus(departure, now) }));
      const open = states.filter((s) => s.status !== "CLOSED");
      const freesale = open.some((s) => s.status === "FREESALE");
      const vacancies = freesale
        ? null
        : Math.max(0, ...open.map((s) => Math.floor(Number(s.departure.available_pax ?? 0))), 0);
      const capacities = open
        .map((s) => Math.floor(Number(s.departure.capacity ?? 0)))
        .filter((c) => c > 0);

      const status: OctoAvailabilityStatus = (() => {
        if (open.length === 0) return "CLOSED";
        if (freesale) return "FREESALE";
        if (vacancies === 0) return "SOLD_OUT";
        return open.some((s) => s.status === "AVAILABLE") ? "AVAILABLE" : "LIMITED";
      })();

      const hours = open
        .map((s) => localDateTime(s.departure.departure_at as string, timeZone).slice(11, 16))
        .sort();

      return {
        localDate: day,
        available: status === "AVAILABLE" || status === "LIMITED" || status === "FREESALE",
        status,
        vacancies,
        capacity: capacities.length > 0 ? Math.max(...capacities) : null,
        openingHours: hours.length > 0 ? [{ from: hours[0], to: hours[hours.length - 1] }] : [],
        ...(withPricing && extras?.unitPrices
          ? {
              unitPricingFrom: extras.unitPrices.map((p) => ({ unitId: p.unitId, ...pricing(p.amount, extras.currency || "usd") })),
              pricingFrom: pricing(extras.unitPrices.find((p) => p.unitId === "adult")?.amount ?? 0, extras.currency || "usd"),
            }
          : {}),
      };
    });
}

/* ═══════════════════════════════════════════════════════════ la reserva ══ */

export interface OctoUnitItemInput {
  uuid?: string;
  unitId: string;
  resellerReference?: string;
  contact?: OctoContactInput;
}

export interface OctoContactInput {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  emailAddress?: string | null;
  phoneNumber?: string | null;
  locales?: string[];
  postalCode?: string | null;
  country?: string | null;
  notes?: string | null;
}

export interface ReservationInput {
  uuid: string;
  productId: string;
  optionId: string;
  availabilityId: string | null;
  expirationMinutes: number;
  notes: string | null;
  unitItems: { uuid: string; unitId: string; resellerReference: string | null; contact: OctoContactInput | null }[];
  resellerReference: string | null;
  contact: OctoContactInput | null;
}

export type ReservationProblem =
  | { code: OctoErrorCode; message: string; pointer?: Record<string, string> };

/** Los minutos de retención por defecto y el techo que no se cruza. */
export const DEFAULT_HOLD_MINUTES = 30;
export const MAX_HOLD_MINUTES = 1440;

/** Tope de viajeros por reserva: el mismo que el motor público. */
export const MAX_UNIT_ITEMS = 40;

/**
 * Un uuid v4 sintético a partir de bytes aleatorios.
 *
 * Existe porque el revendedor PUEDE no mandar uuid, y el estándar dice que
 * entonces lo pone el proveedor. Se usa `crypto.randomUUID` cuando está —lo
 * está en Node 18+ y en el navegador— y hay respaldo para no romper en un
 * entorno viejo.
 */
export function newUuid(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === "function") return g.crypto.randomUUID();
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
    else if (i === 14) out += "4";
    else out += hex[Math.floor(Math.random() * 16)];
  }
  return out;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

const text = (v: unknown, max = 500): string | null => {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed.slice(0, max);
};

function readContact(raw: unknown): OctoContactInput | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const contact: OctoContactInput = {
    fullName: text(c.fullName, 200),
    firstName: text(c.firstName, 100),
    lastName: text(c.lastName, 100),
    emailAddress: text(c.emailAddress, 200),
    phoneNumber: text(c.phoneNumber, 50),
    postalCode: text(c.postalCode, 20),
    country: text(c.country, 60),
    notes: text(c.notes, 1000),
    locales: Array.isArray(c.locales)
      ? c.locales.filter((l): l is string => typeof l === "string").slice(0, 5)
      : undefined,
  };
  return contact;
}

/**
 * Lee y valida el cuerpo de un `reserve`.
 *
 * Todo lo que tiene valor económico —precio, moneda, empresa, cupo— se ignora
 * aunque venga: una llave de API es una contraseña que vende en nombre de la
 * operadora, y si además dejara poner el precio sería una contraseña que regala
 * su margen. Lo mismo que hace el motor público, por la misma razón.
 */
export function readReservation(raw: unknown, now: Date = new Date()): { ok: true; input: ReservationInput } | { ok: false; problem: ReservationProblem } {
  void now;
  if (!raw || typeof raw !== "object") {
    return { ok: false, problem: { code: "BAD_REQUEST", message: "El cuerpo de la petición no es un objeto JSON." } };
  }
  const body = raw as Record<string, unknown>;

  const productId = text(body.productId, 100);
  if (!productId) {
    return { ok: false, problem: { code: "INVALID_PRODUCT_ID", message: "Falta productId." } };
  }

  const optionId = text(body.optionId, 100);
  if (!optionId) {
    return { ok: false, problem: { code: "INVALID_OPTION_ID", message: "Falta optionId.", pointer: { productId } } };
  }

  const uuid = body.uuid == null ? newUuid() : text(body.uuid, 60);
  if (!uuid || !isUuid(uuid)) {
    return { ok: false, problem: { code: "INVALID_BOOKING_UUID", message: "El uuid tiene que ser un UUID válido." } };
  }

  const rawItems = Array.isArray(body.unitItems) ? body.unitItems : [];
  if (rawItems.length === 0) {
    return { ok: false, problem: { code: "BAD_REQUEST", message: "Manda al menos un unitItem: sin viajeros no hay reserva.", pointer: { productId, optionId } } };
  }
  if (rawItems.length > MAX_UNIT_ITEMS) {
    return {
      ok: false,
      problem: {
        code: "UNPROCESSABLE_ENTITY",
        message: `Una reserva admite hasta ${MAX_UNIT_ITEMS} viajeros; para un grupo mayor hay que hablar con la operadora.`,
        pointer: { productId, optionId },
      },
    };
  }

  const unitItems: ReservationInput["unitItems"] = [];
  for (const item of rawItems) {
    if (!item || typeof item !== "object") {
      return { ok: false, problem: { code: "BAD_REQUEST", message: "Cada unitItem tiene que ser un objeto." } };
    }
    const one = item as Record<string, unknown>;
    const unitId = text(one.unitId, 50)?.toLowerCase() ?? null;
    if (!unitId || !UNIT_IDS.has(unitId)) {
      return {
        ok: false,
        problem: {
          code: "INVALID_UNIT_ID",
          message: `unitId desconocido: usa ${[...UNIT_IDS].join(", ")}.`,
          pointer: { productId, optionId, unitId: String(one.unitId ?? "") },
        },
      };
    }
    const itemUuid = one.uuid == null ? newUuid() : text(one.uuid, 60);
    if (!itemUuid || !isUuid(itemUuid)) {
      return { ok: false, problem: { code: "INVALID_BOOKING_UUID", message: "El uuid de un unitItem no es un UUID válido." } };
    }
    unitItems.push({
      uuid: itemUuid,
      unitId,
      resellerReference: text(one.resellerReference, 100),
      contact: readContact(one.contact),
    });
  }

  const askedMinutes = Number(body.expirationMinutes ?? NaN);
  const expirationMinutes = Number.isFinite(askedMinutes) && askedMinutes > 0
    ? Math.min(MAX_HOLD_MINUTES, Math.floor(askedMinutes))
    : DEFAULT_HOLD_MINUTES;

  return {
    ok: true,
    input: {
      uuid,
      productId,
      optionId,
      availabilityId: text(body.availabilityId, 100),
      expirationMinutes,
      notes: text(body.notes, 1000),
      unitItems,
      resellerReference: text(body.resellerReference, 100),
      contact: readContact(body.contact),
    },
  };
}

/** Cuántos viajeros de cada tramo trae la reserva. */
export function paxOf(unitItems: { unitId: string }[]): { adults: number; children: number; infants: number } {
  let adults = 0, children = 0, infants = 0;
  for (const item of unitItems) {
    if (item.unitId === "adult") adults++;
    else if (item.unitId === "child") children++;
    else if (item.unitId === "infant") infants++;
  }
  return { adults, children, infants };
}

/** Las plazas que ocupa: el infante va en brazos y no cuenta contra el cupo. */
export function seatsOf(unitItems: { unitId: string }[]): number {
  const pax = paxOf(unitItems);
  return pax.adults + pax.children;
}

/** El nombre del titular, que es lo que la ficha de cliente necesita. */
export function holderName(contact: OctoContactInput | null, unitItems: ReservationInput["unitItems"]): string {
  const pick = (c: OctoContactInput | null | undefined): string | null => {
    if (!c) return null;
    if (c.fullName) return c.fullName;
    const joined = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
    return joined === "" ? null : joined;
  };
  return pick(contact) ?? pick(unitItems.find((i) => i.contact)?.contact) ?? "Cliente OTA";
}

/* ══════════════════════════════════════════════════ estado de la reserva ══ */

export interface BookingStateInput {
  /** El estado OCTO que se guardó al contestarle al revendedor. */
  stored: string | null | undefined;
  /** Nuestro estado interno de la reserva. */
  internal: string | null | undefined;
  /** Hasta cuándo se retiene la plaza (de la venta). */
  holdUntil: string | null | undefined;
  now?: Date;
}

/** Nuestros estados que significan «esto ya se consumió». */
const REDEEMED_INTERNAL = new Set(["checked_in", "completed"]);
/** Nuestros estados terminales por cancelación. */
const CANCELLED_INTERNAL = new Set(["cancelled", "refunded", "partially_refunded"]);
/** Nuestros estados que significan «esto está en pie y pagado o comprometido». */
const CONFIRMED_INTERNAL = new Set(["confirmed", "partially_paid", "paid"]);

/**
 * El estado que se le contesta al revendedor, reconciliado con la realidad.
 *
 * La columna guarda lo que se le dijo; esta función dice lo que ES. Los tres
 * casos que importan:
 *
 *  · Guardado ON_HOLD y la retención ya venció → EXPIRED. Aunque el barrido
 *    todavía no haya pasado: el revendedor tiene que poder volver a vender esa
 *    plaza sin esperar a nuestro cron.
 *  · Nuestra reserva está cancelada → CANCELLED, pase lo que pase en la
 *    columna. Una cancelación de mostrador tiene que llegarle al revendedor.
 *  · Nuestra reserva está embarcada → REDEEMED. Es la señal de que el ticket se
 *    usó, y es la que cierra la liquidación con la OTA.
 */
export function octoStatusOf(input: BookingStateInput): OctoBookingStatus {
  const now = input.now ?? new Date();
  const internal = (input.internal ?? "").toLowerCase();

  if (REDEEMED_INTERNAL.has(internal)) return "REDEEMED";
  if (CANCELLED_INTERNAL.has(internal)) {
    // Una reserva que se canceló sola por vencimiento de la retención no es una
    // cancelación: es una expiración, y para la OTA no es lo mismo.
    return input.stored === "EXPIRED" ? "EXPIRED" : "CANCELLED";
  }

  const stored = (input.stored ?? "") as OctoBookingStatus;
  if (stored === "ON_HOLD") {
    const deadline = input.holdUntil ? new Date(input.holdUntil) : null;
    if (deadline && !Number.isNaN(deadline.getTime()) && deadline.getTime() <= now.getTime()) return "EXPIRED";
    return "ON_HOLD";
  }
  if (stored === "CONFIRMED" || CONFIRMED_INTERNAL.has(internal)) return "CONFIRMED";
  if (stored) return stored;
  return "ON_HOLD";
}

export type OctoTransition = "confirm" | "cancel" | "extend" | "update";

export interface TransitionVerdict {
  ok: boolean;
  code?: OctoErrorCode;
  message?: string;
}

/**
 * ¿Se puede hacer esta transición?
 *
 * El estándar es explícito en que confirmar una reserva vencida NO vale: la
 * plaza ya volvió a la venta y puede haberla comprado otro. Devolver «sí» y
 * luego no tener asiento es peor que negarse ahora.
 */
export function canTransition(status: OctoBookingStatus, to: OctoTransition): TransitionVerdict {
  switch (to) {
    case "confirm":
      if (status === "CONFIRMED") return { ok: true };
      if (status === "ON_HOLD") return { ok: true };
      return {
        ok: false,
        code: "UNPROCESSABLE_ENTITY",
        message: status === "EXPIRED"
          ? "La retención venció y la plaza volvió a la venta: hay que reservar de nuevo."
          : `No se puede confirmar una reserva en estado ${status}.`,
      };
    case "cancel":
      if (status === "CANCELLED") return { ok: true };
      if (status === "ON_HOLD" || status === "CONFIRMED") return { ok: true };
      return {
        ok: false,
        code: "UNPROCESSABLE_ENTITY",
        message: status === "REDEEMED"
          ? "El ticket ya se usó: una reserva embarcada no se cancela, se reclama."
          : `No se puede cancelar una reserva en estado ${status}.`,
      };
    case "extend":
    case "update":
      if (status === "ON_HOLD") return { ok: true };
      return {
        ok: false,
        code: "UNPROCESSABLE_ENTITY",
        message: `Solo se puede modificar una reserva retenida; esta está en ${status}.`,
      };
  }
}

/**
 * ¿Sigue siendo cancelable sin penalización?
 *
 * Es lo que OCTO llama `cancellable`, y el revendedor lo usa para decidir si
 * enseña el botón de cancelar. Se mide contra el corte de la política, que es
 * el mismo número que se publicó en la opción.
 */
export function cancellable(
  status: OctoBookingStatus,
  travelDate: string | null | undefined,
  cutoffHours: number,
  now: Date = new Date()
): boolean {
  if (status !== "ON_HOLD" && status !== "CONFIRMED") return false;
  if (!travelDate) return true;
  const at = new Date(travelDate);
  if (Number.isNaN(at.getTime())) return true;
  return at.getTime() - now.getTime() >= cutoffHours * 3_600_000;
}

export type RefundKind = "FULL" | "PARTIAL" | "NONE";

/** Cómo describe el estándar el reembolso de una cancelación. */
export function refundKind(refunded: number, paid: number): RefundKind {
  if (refunded <= 0.009) return "NONE";
  if (refunded >= paid - 0.009) return "FULL";
  return "PARTIAL";
}

export interface OctoBooking {
  id: string;
  uuid: string;
  testMode: boolean;
  resellerReference: string | null;
  supplierReference: string | null;
  status: OctoBookingStatus;
  utcCreatedAt: string;
  utcUpdatedAt: string;
  utcExpiresAt: string | null;
  utcRedeemedAt: string | null;
  utcConfirmedAt: string | null;
  productId: string;
  optionId: string;
  cancellable: boolean;
  cancellation: { refund: RefundKind; reason: string | null; utcCancelledAt: string } | null;
  freesale: boolean;
  availabilityId: string | null;
  availability: OctoAvailability | null;
  contact: Required<OctoContactInput>;
  notes: string | null;
  deliveryMethods: OctoDeliveryMethod[];
  voucher: { redemptionMethod: OctoRedemptionMethod; utcRedeemedAt: string | null; deliveryOptions: { deliveryFormat: OctoDeliveryFormat; deliveryValue: string }[] } | null;
  unitItems: {
    uuid: string;
    resellerReference: string | null;
    supplierReference: string | null;
    unitId: string;
    status: OctoBookingStatus;
    utcRedeemedAt: string | null;
    contact: Required<OctoContactInput>;
    ticket: null;
    pricing?: OctoPricing;
  }[];
  pricing?: OctoPricing;
  product?: OctoProduct;
}

export function fullContact(contact: OctoContactInput | null | undefined): Required<OctoContactInput> {
  const c = contact ?? {};
  const first = c.firstName ?? null;
  const last = c.lastName ?? null;
  const joined = [first, last].filter(Boolean).join(" ").trim();
  return {
    fullName: c.fullName ?? (joined === "" ? null : joined),
    firstName: first,
    lastName: last,
    emailAddress: c.emailAddress ?? null,
    phoneNumber: c.phoneNumber ?? null,
    locales: c.locales ?? [],
    postalCode: c.postalCode ?? null,
    country: c.country ?? null,
    notes: c.notes ?? null,
  };
}

export interface BookingViewInput {
  bookingId: string;
  uuid: string;
  testMode: boolean;
  resellerReference: string | null;
  supplierReference: string | null;
  status: OctoBookingStatus;
  createdAt: string;
  updatedAt: string;
  holdUntil: string | null;
  redeemedAt: string | null;
  confirmedAt: string | null;
  productId: string;
  optionId: string;
  availabilityId: string | null;
  availability: OctoAvailability | null;
  contact: OctoContactInput | null;
  notes: string | null;
  unitItems: { uuid: string; unitId: string; resellerReference: string | null; contact: OctoContactInput | null }[];
  travelDate: string | null;
  cutoffHours: number;
  cancelledAt: string | null;
  cancelReason: string | null;
  refundAmount: number;
  paidAmount: number;
  totalAmount: number;
  currency: string;
  voucherUrl: string | null;
  capabilities: OctoCapability[];
  now?: Date;
}

/** La reserva tal como la ve el revendedor. */
export function toOctoBooking(input: BookingViewInput): OctoBooking {
  const now = input.now ?? new Date();
  const status = input.status;
  const contact = fullContact(input.contact);
  const isCancelled = status === "CANCELLED";
  const units = input.unitItems;
  const perUnit = units.length > 0 ? input.totalAmount / units.length : 0;

  return {
    id: input.bookingId,
    uuid: input.uuid,
    testMode: input.testMode,
    resellerReference: input.resellerReference,
    supplierReference: input.supplierReference,
    status,
    utcCreatedAt: utc(input.createdAt) ?? new Date(0).toISOString(),
    utcUpdatedAt: utc(input.updatedAt) ?? utc(input.createdAt) ?? new Date(0).toISOString(),
    utcExpiresAt: status === "ON_HOLD" ? utc(input.holdUntil) : null,
    utcRedeemedAt: utc(input.redeemedAt),
    utcConfirmedAt: utc(input.confirmedAt),
    productId: input.productId,
    optionId: input.optionId,
    cancellable: cancellable(status, input.travelDate, input.cutoffHours, now),
    cancellation: isCancelled
      ? {
          refund: refundKind(input.refundAmount, input.paidAmount),
          reason: input.cancelReason,
          utcCancelledAt: utc(input.cancelledAt) ?? now.toISOString(),
        }
      : null,
    freesale: input.availabilityId == null,
    availabilityId: input.availabilityId,
    availability: input.availability,
    contact,
    notes: input.notes,
    deliveryMethods: ["VOUCHER"],
    voucher:
      status === "CONFIRMED" || status === "REDEEMED"
        ? {
            redemptionMethod: "DIGITAL",
            utcRedeemedAt: utc(input.redeemedAt),
            deliveryOptions: input.voucherUrl
              ? [{ deliveryFormat: "PDF_URL" as OctoDeliveryFormat, deliveryValue: input.voucherUrl }]
              : [],
          }
        : null,
    unitItems: units.map((item) => ({
      uuid: item.uuid,
      resellerReference: item.resellerReference,
      supplierReference: input.supplierReference,
      unitId: item.unitId,
      status,
      utcRedeemedAt: utc(input.redeemedAt),
      contact: fullContact(item.contact),
      ticket: null,
      ...(hasCapability(input.capabilities, "octo/pricing")
        ? { pricing: pricing(item.unitId === "infant" ? 0 : perUnit, input.currency) }
        : {}),
    })),
    ...(hasCapability(input.capabilities, "octo/pricing")
      ? { pricing: pricing(input.totalAmount, input.currency) }
      : {}),
  };
}

/* ═════════════════════════════════════════════════════════════ proveedor ══ */

export interface OctoSupplier {
  id: string;
  name: string;
  endpoint: string;
  contact: { website: string | null; email: string | null; telephone: string | null; address: string | null };
  shortDescription?: string | null;
}

export function toOctoSupplier(
  company: { _id?: string; id?: string; name?: string; email?: string | null; phone?: string | null; address?: string | null; city?: string | null; short_description?: string | null } | null,
  endpoint: string,
  website: string | null
): OctoSupplier {
  return {
    id: String(company?._id ?? company?.id ?? ""),
    name: company?.name || "Operadora",
    endpoint,
    contact: {
      website,
      email: company?.email ?? null,
      telephone: company?.phone ?? null,
      address: [company?.address, company?.city].filter(Boolean).join(", ") || null,
    },
    shortDescription: company?.short_description ?? null,
  };
}

/**
 * El techo de retención que la operadora acepta.
 *
 * Un revendedor puede pedir 10 080 minutos (una semana) porque el estándar se
 * lo permite. Dejarlo sería regalar el inventario: siete días con plazas
 * bloqueadas sin cobro y sin nadie mirándolo.
 */
export function holdMinutesFor(asked: number, companyMax: number | null | undefined): number {
  const max = Number(companyMax ?? 0) > 0 ? Math.floor(Number(companyMax)) : MAX_HOLD_MINUTES;
  const wanted = Number(asked) > 0 ? Math.floor(Number(asked)) : DEFAULT_HOLD_MINUTES;
  return Math.max(1, Math.min(wanted, max));
}
