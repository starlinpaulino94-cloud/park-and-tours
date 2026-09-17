/**
 * LA MARCA DE LA EMPRESA EN SUS DOCUMENTOS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DE QUÉ VA ESTO
 *
 * Un voucher, una cotización y una factura son lo único que el cliente se lleva
 * a casa. Hasta ahora los tres salían con el mismo verde del código, sin logo y
 * sin una línea legal: el papel que el cliente enseña en la puerta no decía de
 * quién era más allá del nombre en texto.
 *
 * Aquí viven las tres decisiones que tienen enjundia:
 *
 *  · **El color se valida ANTES de usarse.** Un `#gggggg` o un `rojo` escritos
 *    en un formulario acaban en una conversión a RGB que devuelve NaN, y un PDF
 *    con un color NaN no se abre. Se valida una vez, aquí, y todo lo demás
 *    recibe algo que seguro se puede pintar.
 *
 *  · **El contraste no es opcional.** Una empresa con un logo amarillo pone su
 *    amarillo de marca, y el texto blanco encima deja de leerse. Se calcula la
 *    luminancia y se elige el color de texto que se lee, en vez de confiar en
 *    que el color elegido sea oscuro.
 *
 *  · **Solo PNG y JPEG valen para el PDF.** El formato no sabe incrustar SVG ni
 *    WebP. Decírselo a quien sube el logo es mejor que generarle un documento
 *    sin logo y que se entere por el cliente.
 */

/** El color con el que salen los documentos si la empresa no eligió uno. */
export const DEFAULT_BRAND_COLOR = "#0d6b6b";

/** Los formatos de imagen que un PDF puede incrustar. */
export const PDF_IMAGE_TYPES = new Set(["image/png", "image/jpeg"]);
/** Y sus extensiones, para cuando lo único que hay es la URL. */
const PDF_IMAGE_EXT = /\.(png|jpe?g)(\?.*)?$/i;

/**
 * Normaliza un color a `#rrggbb` en minúsculas, o `null` si no lo es.
 *
 * Acepta la forma corta (`#abc`) porque es la que la gente copia de una guía de
 * marca, y la acepta sin almohadilla porque es como sale de la mitad de los
 * selectores de color.
 */
export function normalizeColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().toLowerCase().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/.test(raw)) {
    return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`;
  }
  if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}`;
  return null;
}

/** El color de marca utilizable: el de la empresa si vale, y si no el de casa. */
export function brandColor(value: unknown): string {
  return normalizeColor(value) ?? DEFAULT_BRAND_COLOR;
}

/** Componentes 0..1, que es como los quiere el generador de PDF. */
export function toRgb(color: string): { r: number; g: number; b: number } {
  const hex = normalizeColor(color) ?? DEFAULT_BRAND_COLOR;
  return {
    r: parseInt(hex.slice(1, 3), 16) / 255,
    g: parseInt(hex.slice(3, 5), 16) / 255,
    b: parseInt(hex.slice(5, 7), 16) / 255,
  };
}

/**
 * Luminancia relativa (WCAG).
 *
 * Es la fórmula del estándar y no el promedio de los tres canales: el ojo ve el
 * verde mucho más claro que el azul, y un promedio simple da por oscuro un
 * verde lima sobre el que el blanco no se lee.
 */
export function luminance(color: string): number {
  const { r, g, b } = toRgb(color);
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Relación de contraste entre dos colores (1 a 21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/** Mínimo que el estándar pide para texto normal. */
export const MIN_CONTRAST = 4.5;

/**
 * El color de texto que se lee encima del de marca.
 *
 * Se elige el que MÁS contraste da, no el que «debería» según si el color es
 * claro u oscuro: en la frontera —un gris medio, un teal— la intuición falla y
 * la fórmula no.
 */
export function readableOn(background: string): "#ffffff" | "#111111" {
  return contrastRatio(background, "#ffffff") >= contrastRatio(background, "#111111")
    ? "#ffffff"
    : "#111111";
}

/** ¿El color elegido deja leer el texto que se le pone encima? */
export function hasReadableContrast(background: string): boolean {
  return contrastRatio(background, readableOn(background)) >= MIN_CONTRAST;
}

export type LogoProblem = "not_image" | "not_pdf_format" | "not_url";

export const LOGO_PROBLEM_MESSAGE: Record<LogoProblem, string> = {
  not_url: "La dirección del logo no es válida.",
  not_image: "El archivo no parece una imagen.",
  not_pdf_format: "Para que salga en los PDF el logo tiene que ser PNG o JPG. Un SVG o un WebP se verá en pantalla pero no en el documento.",
};

/**
 * Qué le pasa a este logo, o `null` si está bien.
 *
 * Devolver el problema en vez de un booleano es lo que permite decirle a quien
 * sube un SVG por qué su voucher va a salir sin logo, que es la pregunta que
 * haría al día siguiente.
 */
export function logoProblem(url: unknown, contentType?: string | null): LogoProblem | null {
  if (typeof url !== "string" || !url.trim()) return null;
  const value = url.trim();

  if (!/^https?:\/\//i.test(value) && !value.startsWith("/")) return "not_url";

  if (contentType) {
    if (!contentType.startsWith("image/")) return "not_image";
    return PDF_IMAGE_TYPES.has(contentType) ? null : "not_pdf_format";
  }
  // Sin tipo declarado solo queda la extensión. Una URL sin extensión
  // reconocible NO se rechaza: puede ser una ruta firmada perfectamente válida,
  // y bloquearla sería peor que intentarlo y fallar con elegancia.
  if (/\.(svg|webp|gif|avif)(\?.*)?$/i.test(value)) return "not_pdf_format";
  return null;
}

/** ¿Vale la pena intentar incrustar este logo en un PDF? */
export function embeddableLogo(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const value = url.trim();
  if (!value) return null;
  if (logoProblem(value)) return null;
  return value;
}

/** Y si la URL declara su formato, cuál es. */
export function imageKindOf(url: string, contentType?: string | null): "png" | "jpg" | null {
  if (contentType === "image/png") return "png";
  if (contentType === "image/jpeg") return "jpg";
  const match = PDF_IMAGE_EXT.exec(url);
  if (!match) return null;
  return match[1].toLowerCase() === "png" ? "png" : "jpg";
}

/* ═════════════════════════════════════════════ lo que lleva cada documento */

export interface CompanyBranding {
  name?: string | null;
  legal_name?: string | null;
  tax_id?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  logo_url?: string | null;
  brand_color?: string | null;
  document_footer?: string | null;
  voucher_terms?: string | null;
  invoice_terms?: string | null;
}

export type DocumentKind = "voucher" | "quote" | "manifest" | "invoice" | "statement" | "cash";

export interface DocumentBrand {
  /** El nombre que encabeza el documento. */
  name: string;
  /** La razón social, cuando difiere del comercial. */
  legalName: string | null;
  /** La línea de contacto de la cabecera. */
  contact: string;
  /** El identificador fiscal, ya etiquetado. */
  taxLine: string | null;
  color: string;
  onColor: string;
  logo: string | null;
  /** El pie legal común. */
  footer: string | null;
  /** Las condiciones propias de ESTE documento, si las hay. */
  terms: string | null;
}

/** Une los trozos de contacto que existan, sin dejar separadores huérfanos. */
function joinParts(parts: (string | null | undefined)[], sep: string): string {
  return parts.map((p) => (p ?? "").trim()).filter(Boolean).join(sep);
}

/**
 * La marca resuelta para un documento concreto.
 *
 * La cadena de respaldo importa: sin nombre comercial se usa la razón social
 * —un documento sin nombre de quien lo emite no sirve para nada— y sin ninguno
 * de los dos se deja vacío en vez de inventar un «Mi empresa» que acabaría
 * impreso en un voucher de verdad.
 *
 * Las condiciones dependen del documento: las del voucher no pintan nada en una
 * factura, y el texto legal fiscal no pinta nada en un manifiesto que solo ve
 * el guía.
 */
export function documentBrand(company: CompanyBranding | null, kind: DocumentKind): DocumentBrand {
  const c = company ?? {};
  const name = (c.name || c.legal_name || "").trim();
  const legalName = (c.legal_name || "").trim();
  const color = brandColor(c.brand_color);

  const terms =
    kind === "voucher" ? (c.voucher_terms || "").trim()
    : kind === "invoice" ? (c.invoice_terms || "").trim()
    : "";

  return {
    name,
    // Solo se enseña cuando aporta: repetir el mismo nombre dos veces en la
    // cabecera es ruido.
    legalName: legalName && legalName !== name ? legalName : null,
    contact: joinParts([c.phone || c.whatsapp, c.email, joinParts([c.address, c.city], ", ")], "  ·  "),
    taxLine: c.tax_id ? `RNC ${String(c.tax_id).trim()}` : null,
    color,
    onColor: readableOn(color),
    logo: embeddableLogo(c.logo_url),
    footer: (c.document_footer || "").trim() || null,
    terms: terms || null,
  };
}

/**
 * Lo que falta para que los documentos salgan completos.
 *
 * Es una lista de avisos, no de errores: una empresa puede emitir vouchers sin
 * logo perfectamente. Sirve para que la pantalla de configuración diga qué
 * queda, en vez de dejar al usuario descubrirlo imprimiendo.
 */
export function brandingGaps(company: CompanyBranding | null): string[] {
  const c = company ?? {};
  const gaps: string[] = [];
  if (!(c.name || c.legal_name)) gaps.push("Falta el nombre de la empresa: encabeza todos los documentos.");
  if (!c.logo_url) gaps.push("Sin logo, los documentos salen solo con el nombre en texto.");
  if (!c.tax_id) gaps.push("Sin RNC, las facturas no cumplen con lo que exige la DGII.");
  if (!(c.phone || c.whatsapp || c.email)) gaps.push("Sin teléfono ni correo, el cliente no sabe a quién llamar.");
  if (!c.address) gaps.push("Sin dirección, la factura queda incompleta.");
  if (!c.document_footer) gaps.push("No hay pie legal: es donde va el registro mercantil o la leyenda que te exijan.");
  const color = normalizeColor(c.brand_color);
  if (color && !hasReadableContrast(color)) {
    gaps.push("El color de marca deja el texto poco legible; los documentos usarán un texto oscuro encima.");
  }
  return gaps;
}
