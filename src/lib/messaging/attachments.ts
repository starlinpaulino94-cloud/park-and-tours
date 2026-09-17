import "server-only";
import { supabaseService } from "@/lib/supabase/service";
import { buildVoucherPdf, buildQuotePdf } from "@/lib/pdf/documents";
import { personName } from "@/lib/manifest";
import { optionBreakdown } from "@/lib/quotes";

/**
 * El documento que viaja con un aviso.
 *
 * Se compone EN EL MOMENTO DE ENTREGAR, no al encolar: entre que se encola la
 * confirmación y sale el correo puede haberse cobrado el saldo o cambiado la
 * hora de recogida, y un voucher con datos viejos es peor que ninguno — el
 * cliente se presenta a la hora que dice el papel.
 *
 * Lee con el cliente de servicio y el filtro de organización puesto a mano, por
 * la misma razón que el despachador: la entrega ocurre tanto desde una petición
 * con sesión como desde el cron, que no la tiene. Una sola implementación evita
 * que las dos rutas manden documentos distintos.
 */

export interface MessageAttachment {
  filename: string;
  /** Contenido en base64, que es como lo quieren las API de correo. */
  content: string;
}

const base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

interface CompanyInfo {
  name?: string | null; email?: string | null; phone?: string | null;
  whatsapp?: string | null; address?: string | null;
}

async function voucherFor(companyId: string, bookingId: string, company: CompanyInfo | null): Promise<MessageAttachment | null> {
  const { data: booking, error } = await supabaseService()
    .from("booking")
    .select(
      "id, booking_number, voucher_code, status, travel_date, adults, children, infants, pax_total, " +
      "pickup_time, pickup_location, room_number, total_amount, paid_amount, balance_amount, currency, notes, " +
      "customer:customer_id (first_name, last_name, language), " +
      "product:product_id (name, meeting_point, terms, inclusions, exclusions, recommendations, restrictions, instructions), " +
      "modality:modality_id (name), " +
      "hotel:hotel_id (name)"
    )
    .eq("organization_id", companyId)
    .eq("id", bookingId)
    .maybeSingle();

  if (error || !booking) {
    console.error(`[mensajería] no se pudo componer el voucher de ${bookingId}:`, error?.message);
    return null;
  }

  const row = booking as unknown as Record<string, any>;
  // El código vivo manda sobre la copia que se escribió al vender: si el
  // voucher se reemitió, es ese el que el escáner reconoce.
  const { data: voucher } = await supabaseService()
    .from("voucher")
    .select("code")
    .eq("organization_id", companyId)
    .eq("booking_id", bookingId)
    .eq("status", "valid")
    .limit(1)
    .maybeSingle();

  const { data: extras } = await supabaseService()
    .from("booking_extra")
    .select("name, quantity, total_amount")
    .eq("organization_id", companyId)
    .eq("booking_id", bookingId)
    .limit(30);

  const bytes = await buildVoucherPdf(company, {
    booking_number: row.booking_number,
    voucher_code: voucher?.code || row.voucher_code,
    status: row.status,
    customer_name: personName(row.customer),
    // El voucher adjunto sale en el mismo idioma que el correo que lo lleva.
    language: (row.customer as { language?: string } | null)?.language ?? null,
    product_name: row.product?.name ?? null,
    modality_name: row.modality?.name ?? null,
    travel_date: row.travel_date,
    adults: row.adults, children: row.children, infants: row.infants, pax_total: row.pax_total,
    pickup_hotel: row.hotel?.name ?? null,
    pickup_time: row.pickup_time,
    pickup_location: row.pickup_location,
    room_number: row.room_number,
    meeting_point: row.product?.meeting_point ?? null,
    total_amount: row.total_amount,
    paid_amount: row.paid_amount,
    balance_amount: row.balance_amount,
    currency: row.currency,
    inclusions: row.product?.inclusions ?? null,
    exclusions: row.product?.exclusions ?? null,
    recommendations: row.product?.recommendations ?? null,
    restrictions: row.product?.restrictions ?? null,
    instructions: row.product?.instructions ?? null,
    conditions: row.product?.terms ?? null,
    notes: row.notes,
    extras: (extras ?? []).map((e) => ({
      description: (e.name as string) || "Extra",
      quantity: Number(e.quantity) || 0,
      amount: Number(e.total_amount) || 0,
    })),
  });

  return { filename: `voucher-${row.booking_number || bookingId}.pdf`, content: base64(bytes) };
}

async function quoteFor(companyId: string, quoteId: string, company: CompanyInfo | null): Promise<MessageAttachment | null> {
  const { data: quote, error } = await supabaseService()
    .from("quote")
    .select("*, customer:customer_id (first_name, last_name), seller:seller_id (first_name, last_name)")
    .eq("organization_id", companyId)
    .eq("id", quoteId)
    .maybeSingle();

  if (error || !quote) {
    console.error(`[mensajería] no se pudo componer la cotización ${quoteId}:`, error?.message);
    return null;
  }
  const row = quote as unknown as Record<string, any>;

  const [{ data: lines }, { data: options }] = await Promise.all([
    supabaseService().from("quote_line").select("*").eq("organization_id", companyId).eq("quote_id", quoteId)
      .order("sort_order", { ascending: true }).limit(200),
    supabaseService().from("quote_option").select("*").eq("organization_id", companyId).eq("quote_id", quoteId)
      .order("sort_order", { ascending: true }).limit(20),
  ]);

  const mappedOptions = (options ?? []).map((o) => ({ ...o, _id: o.id as string }));
  const mappedLines = (lines ?? []).map((l) => ({
    description: l.description, quantity: l.quantity, unit_price: l.unit_price,
    discount_percent: l.discount_percent, line_total: l.line_total,
    is_optional: l.is_optional, option_id: l.option_id, service_date: l.service_date,
  }));

  // El total del papel se recalcula desde las líneas, no se copia de la
  // cabecera: es el número que el cliente va a leer y tiene que cuadrar.
  const header = mappedOptions.length > 0
    ? optionBreakdown(mappedOptions, mappedLines, row.tax_percent).find((o) => o.is_selected)
      ?? optionBreakdown(mappedOptions, mappedLines, row.tax_percent).find((o) => o.is_recommended)
      ?? optionBreakdown(mappedOptions, mappedLines, row.tax_percent)[0]
    : null;

  const bytes = await buildQuotePdf(
    company,
    {
      ...row,
      subtotal: header?.subtotal ?? row.subtotal,
      discount: header?.discount ?? row.discount,
      tax: header?.tax ?? row.tax,
      total: header?.total ?? row.total,
      customer_name: personName(row.customer),
      seller_name: personName(row.seller),
    },
    mappedLines,
    mappedOptions
  );

  return { filename: `cotizacion-${row.code || quoteId}.pdf`, content: base64(bytes) };
}

export interface AttachmentRequest {
  kind?: string | null;
  bookingId?: string | null;
  quoteId?: string | null;
}

/**
 * Compone el adjunto que pide un mensaje, o null si no pide ninguno.
 *
 * Un fallo aquí NO impide la entrega: el aviso con la hora de recogida sigue
 * sirviendo aunque el PDF no se haya podido generar, y perderlo entero por eso
 * sería cambiar un problema pequeño por uno grande.
 */
export async function resolveAttachment(
  companyId: string,
  company: CompanyInfo | null,
  request: AttachmentRequest
): Promise<MessageAttachment | null> {
  try {
    if (request.kind === "voucher" && request.bookingId) {
      return await voucherFor(companyId, request.bookingId, company);
    }
    if (request.kind === "quote" && request.quoteId) {
      return await quoteFor(companyId, request.quoteId, company);
    }
  } catch (err) {
    console.error("[mensajería] el adjunto no se pudo componer:", err);
  }
  return null;
}
