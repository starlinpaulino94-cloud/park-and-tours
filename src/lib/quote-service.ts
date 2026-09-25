import "server-only";
import { tenantQuery, tenantFindOne, tenantUpdate } from "@/lib/tenant";
import { assertSellerOwnsRow } from "@/lib/seller-scope";
import type { AppRole } from "@/lib/auth";
import {
  headerTotals, optionBreakdown, lineTotal, depositDue,
  type QuoteOptionInput, type QuoteLineInput,
} from "@/lib/quotes";

/**
 * El único sitio que escribe el dinero de una cotización.
 *
 * Los totales de la cabecera son una proyección de las líneas: en cuanto se
 * pueden teclear por separado, el documento que ve el cliente deja de cuadrar
 * con su propio desglose. Antes la pantalla los recalculaba y los mandaba por el
 * CRUD genérico, así que bastaba una petición a mano —o una pestaña que se
 * quedó con líneas viejas— para prometer un precio que las líneas no sostienen.
 *
 * Toda acción que toque una línea o una opción termina llamando aquí.
 */

export interface QuoteRow {
  _id: string;
  code?: string;
  status?: string;
  currency?: string;
  tax?: number | null;
  tax_percent?: number | null;
  version?: number | null;
  deposit_type?: string | null;
  deposit_percent?: number | null;
  deposit_amount?: number | null;
  selected_option?: unknown;
  [key: string]: unknown;
}

export interface QuoteLineRow extends QuoteLineInput {
  _id: string;
  quote?: unknown;
  option?: unknown;
  supplier?: unknown;
  description?: string;
  notes?: string;
  line_type?: string | null;
  line_total?: number | null;
  service_date?: string | null;
  product?: unknown;
  departure?: unknown;
  product_modality?: unknown;
  adults?: number | null;
  children?: number | null;
  infants?: number | null;
  sort_order?: number | null;
}

export interface QuoteOptionRow extends QuoteOptionInput {
  _id: string;
  name?: string;
  description?: string | null;
  total?: number | null;
}

export interface QuoteBundle {
  quote: QuoteRow;
  options: QuoteOptionRow[];
  lines: QuoteLineRow[];
}

/**
 * Carga la cotización con todo lo que hace falta para decidir sobre ella.
 *
 * `ctx` NO es opcional, y esa es la decisión: todas las rutas de
 * `/api/quotes/:id/*` pasan por aquí —enviar, revisar, decidir, convertir,
 * editar líneas y alternativas— y ninguna de ellas miraba de quién era la
 * cotización, solo el rango. Con el parámetro opcional, la siguiente ruta que
 * se escribiera se olvidaría de pasarlo y no lo notaría nadie; obligatorio, el
 * compilador obliga a decidir. `null` significa «uso interno, sin persona
 * detrás» y solo lo usa el recálculo, que corre DESPUÉS de una escritura ya
 * autorizada.
 */
/**
 * Los topes de lectura, con nombre porque hay que poder compararse con ellos.
 *
 * Un documento de veinte alternativas o doscientas líneas no existe; lo que sí
 * puede existir es un error que las genere, y entonces importa MUCHÍSIMO que
 * nadie escriba un total calculado sobre un trozo.
 */
const TOPE_DE_OPCIONES = 20;
const TOPE_DE_LINEAS = 200;

export async function loadQuoteBundle(
  companyId: string,
  quoteId: string,
  ctx: { role: AppRole; userId?: string | null; sellerId?: string | null } | null
): Promise<QuoteBundle> {
  const quote = await tenantFindOne<QuoteRow>(companyId, "quote", quoteId);
  if (ctx) assertSellerOwnsRow("quote", ctx, quote as unknown as Record<string, unknown>, "Esta cotización");
  const [options, lines] = await Promise.all([
    tenantQuery<QuoteOptionRow>(companyId, "quote_option", {
      _filter: { quote: quoteId }, _limit: TOPE_DE_OPCIONES, _sort: { sort_order: "asc" },
    }),
    tenantQuery<QuoteLineRow>(companyId, "quote_line", {
      _filter: { quote: quoteId }, _limit: TOPE_DE_LINEAS, _sort: { sort_order: "asc" },
    }),
  ]);
  return { quote, options, lines };
}

export interface RecalculatedQuote {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  cost_total: number;
  margin_amount: number;
  margin_percent: number | null;
  deposit: number;
  balance: number;
  options: ReturnType<typeof optionBreakdown>;
}

/**
 * Recalcula la cotización entera desde sus líneas y la guarda.
 *
 * Cada alternativa guarda su propio total —el cliente compara precios cerrados,
 * no sumas que la pantalla hace al vuelo— y la cabecera toma el de la escogida.
 */
export async function recalculateQuote(companyId: string, quoteId: string): Promise<RecalculatedQuote> {
  const { quote, options, lines } = await loadQuoteBundle(companyId, quoteId, null);

  /**
   * UN TOTAL NO SE ESCRIBE SOBRE UN DESGLOSE RECORTADO.
   *
   * `loadQuoteBundle` lee con tope, y esta función **guarda** lo que suma. Con
   * el desglose recortado por el tope, la cabecera se quedaba con la suma de
   * las primeras doscientas líneas —escrita, no calculada al vuelo— y la
   * propuesta salía en PDF con un precio que su propio desglose contradice, con
   * cara de buena. Y de ahí sale la orden al convertir.
   *
   * Es justo lo que este módulo existe para impedir: su cabecera dice que los
   * totales son una proyección de las líneas. Una proyección de la mitad de las
   * líneas no es un total; es un número.
   *
   * Se lanza en vez de guardar. Quien lo vea tiene un documento roto y hay que
   * mirarlo, no redondearlo.
   */
  if (lines.length >= TOPE_DE_LINEAS || options.length >= TOPE_DE_OPCIONES) {
    throw Object.assign(
      new Error(
        `La cotización ${quote.code || quoteId} tiene más desglose del que se puede sumar de una vez ` +
        `(${lines.length} líneas, ${options.length} alternativas). No se guarda un total calculado a medias: ` +
        "divídela antes de seguir."
      ),
      { status: 409 }
    );
  }

  const taxPercent = quote.tax_percent;

  const breakdown = optionBreakdown(options, lines, taxPercent);
  for (const opt of breakdown) {
    await tenantUpdate(companyId, "quote_option", opt.option_id, {
      subtotal: opt.subtotal, discount: opt.discount, tax: opt.tax,
      total: opt.total, cost_total: opt.cost_total, margin_amount: opt.margin_amount,
    });
  }

  const header = headerTotals(options, lines, taxPercent, quote.tax);
  const { deposit, balance } = depositDue(quote, header.total);

  // `margin_percent` es numeric(6,3): una propuesta cuyo coste multiplica al
  // precio (un error de dedo en el coste del proveedor) da un porcentaje de
  // cuatro cifras y el UPDATE entero reventaría, dejando la cotización sin
  // recalcular. Se acota al rango que la columna admite; el importe del margen,
  // que es el dato real, va sin tocar.
  const storedMarginPct = header.margin_percent === null
    ? null
    : Math.max(Math.min(header.margin_percent, 999.999), -999.999);

  await tenantUpdate(companyId, "quote", quoteId, {
    subtotal: header.subtotal,
    discount: header.discount,
    tax: header.tax,
    total: header.total,
    cost_total: header.cost_total,
    margin_amount: header.margin_amount,
    margin_percent: storedMarginPct,
  });

  return {
    subtotal: header.subtotal, discount: header.discount, tax: header.tax,
    total: header.total, cost_total: header.cost_total,
    margin_amount: header.margin_amount, margin_percent: header.margin_percent,
    deposit, balance, options: breakdown,
  };
}

/** Importe final de una línea tal y como se guarda. */
export const persistedLineTotal = (line: QuoteLineInput): number => lineTotal(line);

/**
 * Siguiente posición en el orden del documento.
 *
 * El orden es el del papel que lee el cliente, no el de creación: por eso se
 * guarda y no se deduce de la fecha.
 */
export function nextSortOrder(lines: { sort_order?: number | null; option_id?: string | null }[], optionId: string | null): number {
  const scope = lines.filter((l) => (l.option_id || null) === optionId);
  return scope.reduce((max, l) => Math.max(max, Number(l.sort_order) || 0), 0) + 10;
}
