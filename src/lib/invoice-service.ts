import "server-only";
import { tenantCreate, tenantQuery, tenantUpdate, tenantFindOne, type TenantContext } from "@/lib/tenant";
import { supabaseServer } from "@/lib/supabase/server";
import { newDocumentNumber } from "@/lib/codes";
import { uniqueCode } from "@/lib/unique";
import { writeAudit } from "@/lib/audit";
import { notify } from "@/lib/notify-service";
import { refId } from "@/lib/types";
import {
  formatNcf, ncfTypeFor, normalizeTaxId, creditNoteTypeFor, invoiceTotals, lineAmounts,
  voidBlocker, VOID_BLOCK_MESSAGE, type NcfType, type InvoiceLineInput,
} from "@/lib/invoicing";

/**
 * La emisión de un comprobante fiscal.
 *
 * Es el único sitio que consume un NCF, y lo hace a través de `public.next_ncf`,
 * que lo entrega de forma atómica. Todo lo demás —el desglose, el impuesto, el
 * total— se calcula desde la venta en vez de teclearse, porque un comprobante
 * cuyos números no cuadran con la orden que lo origina es un problema de
 * declaración, no de pantalla.
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface TaxProfileRow {
  _id: string;
  tax_rate?: number | null;
  included_in_price?: unknown;
  efac_enabled?: unknown;
  tax_name?: string | null;
}

export interface IssueInvoiceInput {
  orderId: string;
  /** Fuerza el tipo de comprobante; si no, se deduce del cliente. */
  ncfType?: NcfType | null;
  taxProfileId?: string | null;
  customerName?: string | null;
  customerTaxId?: string | null;
  customerAddress?: string | null;
  dueDate?: string | null;
  notes?: string | null;
}

/** Un valor que puede venir como booleano real o como "yes"/"no" heredado. */
const truthy = (v: unknown): boolean => v === true || v === "yes" || v === "true";

/**
 * Emite la factura de una orden.
 *
 * Las líneas salen de las reservas de la orden, no de un formulario: el cliente
 * tiene que poder leer en la factura lo mismo que compró, y cualquier diferencia
 * entre las dos es la que aparece en una inspección.
 */
export async function issueInvoice(
  ctx: TenantContext & { companyId: string },
  input: IssueInvoiceInput
): Promise<{ invoice: Record<string, unknown>; lines: number }> {
  const companyId = ctx.companyId;

  const order = await tenantFindOne<Record<string, unknown>>(companyId, "order", input.orderId, {
    customer: true, partner: true,
  });

  // Una orden ya facturada no se factura dos veces: serían dos comprobantes por
  // la misma venta, y el segundo hay que anularlo con nota de crédito.
  const existing = await tenantQuery<{ _id: string; ncf?: string }>(companyId, "invoice", {
    _filter: { order: input.orderId, invoice_type: "sale" }, _limit: 5,
  });
  const live = existing.find((i) => !(i as { voided_at?: string }).voided_at);
  if (live) {
    throw Object.assign(
      new Error(`Esta orden ya tiene la factura ${live.ncf || live._id}. Anúlala antes de emitir otra.`),
      { status: 409 }
    );
  }

  const profiles = await tenantQuery<TaxProfileRow>(companyId, "tax_profile", {
    _filter: input.taxProfileId ? { _id: input.taxProfileId } : { status: "active" },
    _limit: 1,
  });
  const profile = profiles[0] ?? null;
  const taxRate = Number(profile?.tax_rate) || 0;
  const electronic = truthy(profile?.efac_enabled);

  const customer = typeof order.customer === "object" && order.customer
    ? (order.customer as Record<string, unknown>) : null;
  const taxId = normalizeTaxId(input.customerTaxId ?? customer?.document_id);
  const ncfType = input.ncfType || ncfTypeFor({ tax_id: taxId }, electronic);

  // ---- las líneas, desde lo que se vendió -----------------------------------
  const bookings = await tenantQuery<Record<string, unknown>>(companyId, "booking", {
    _filter: { order: input.orderId }, _limit: 200, product: true,
  });
  const billable = bookings.filter(
    (b) => !["cancelled", "refunded", "draft"].includes(String(b.status || ""))
  );
  if (billable.length === 0) {
    throw Object.assign(new Error("La orden no tiene reservas facturables"), { status: 409 });
  }

  const draftLines = billable.map((b) => {
    const product = typeof b.product === "object" && b.product ? (b.product as Record<string, unknown>) : null;
    const gross = Number(b.gross_amount) || 0;
    const discount = Number(b.discount_amount) || 0;
    const taxAmount = Number(b.tax_amount) || 0;
    const net = round2(gross - discount);

    // La tasa se deriva de la PROPIA reserva, no del perfil fiscal. Son dos
    // números distintos en cuanto el perfil cambia de tasa —o cuando la reserva
    // se vendió exenta— y una factura cuyo total no coincide con la orden que la
    // origina es justo el problema que este módulo viene a cerrar.
    const rate = taxAmount > 0 && net > 0 ? round2((taxAmount / net) * 100) : 0;

    return {
      description: `${(product?.name as string) || "Servicio"} · ${b.booking_number || ""}`.trim(),
      quantity: 1,
      unit_price: gross,
      discount,
      tax_rate: rate,
      is_exempt: taxAmount <= 0,
      booking: b._id as string,
      product: refId(b.product as never),
    };
  });

  // Las líneas vienen de reservas, y `booking-service` SIEMPRE calcula el
  // impuesto sobre la base y lo suma: `taxIncluded` del perfil describe cómo se
  // muestran los precios de mostrador, no cómo se calculó esta venta. Aplicarlo
  // aquí extraería el impuesto de un importe que no lo lleva dentro y la factura
  // saldría por menos que la orden.
  const totals = invoiceTotals(draftLines as InvoiceLineInput[], false);

  // ---- el número ------------------------------------------------------------
  // Es lo último antes de escribir: un NCF consumido y no usado es un hueco en
  // la secuencia que hay que justificar ante la DGII.
  const sequence = await consumeNcf(companyId, ncfType);
  const ncf = formatNcf(ncfType, sequence.number);

  const invoice = await tenantCreate<Record<string, unknown>>(companyId, "invoice", {
    number: await uniqueCode(companyId, "invoice", "number", () => newDocumentNumber("FAC")),
    ncf,
    ncf_type: ncfType,
    ncf_expires_at: sequence.expiresAt,
    series: ncf.slice(0, 3),
    invoice_type: "sale",
    status: "issued",
    issued_at: new Date().toISOString(),
    due_date: input.dueDate || undefined,
    order: input.orderId,
    customer: refId(order.customer as never),
    partner: refId(order.partner as never),
    tax_profile: profile?._id,
    customer_name: input.customerName
      || [customer?.first_name, customer?.last_name].filter(Boolean).join(" ").trim()
      || (customer?.commercial_name as string) || "Consumidor final",
    customer_tax_id: taxId || undefined,
    customer_address: input.customerAddress || (customer?.address as string) || undefined,
    subtotal: totals.subtotal,
    discount: totals.discount,
    tax: totals.tax,
    tax_rate: taxRate,
    total: totals.total,
    paid_amount: Number(order.paid_total) || 0,
    balance: round2(totals.total - (Number(order.paid_total) || 0)),
    currency: order.currency || ctx.company?.base_currency || "usd",
    exchange_rate: Number(order.exchange_rate) || 1,
    efac_status: electronic ? "pending" : "not_applicable",
    notes: input.notes || undefined,
    issued_by: ctx.userId,
    user: ctx.userId,
  });

  for (const [index, line] of draftLines.entries()) {
    const amounts = lineAmounts(line as InvoiceLineInput, false);
    await tenantCreate(companyId, "invoice_line", {
      invoice: invoice._id,
      description: line.description,
      quantity: line.quantity,
      unit_price: line.unit_price,
      discount: line.discount,
      tax_rate: line.tax_rate,
      tax_amount: amounts.tax_amount,
      total: amounts.total,
      is_exempt: line.is_exempt,
      booking: line.booking,
      product: line.product,
      sort_order: index * 10,
    });
  }

  await writeAudit({
    companyId, userId: ctx.userId,
    action: "invoice_issued",
    entityType: "invoice", entityId: invoice._id as string,
    description: `Factura ${ncf} emitida por ${totals.total} ${String(order.currency || "").toUpperCase()} sobre la orden ${order.order_number}`,
    metadata: { ncf, ncf_type: ncfType, total: totals.total, lines: draftLines.length },
  });

  return { invoice, lines: draftLines.length };
}

/**
 * Consume el siguiente número de la secuencia.
 *
 * Pasa por la función de la base porque es el único sitio donde comprobar el
 * rango y reservar el número ocurre en la MISMA sentencia. Hacerlo desde la
 * aplicación —leer, decidir, escribir— deja la ventana por la que dos cajas
 * simultáneas se llevan el mismo NCF, y dos comprobantes con el mismo número
 * invalidan los dos.
 */
async function consumeNcf(companyId: string, ncfType: string): Promise<{ number: number; expiresAt: string | null }> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("next_ncf", { p_org: companyId, p_type: ncfType });
  if (error) {
    // El mensaje de la función explica el motivo (agotada, vencida, sin
    // configurar): se pasa tal cual porque "no se pudo facturar" delante de un
    // cliente no le sirve a nadie.
    throw Object.assign(new Error(error.message), { status: 409 });
  }
  const [sequence] = await tenantQuery<{ expires_at?: string }>(companyId, "ncf_sequence", {
    _filter: { ncf_type: ncfType }, _limit: 1,
  });
  return { number: Number(data), expiresAt: sequence?.expires_at ?? null };
}

/**
 * Anula una factura emitiendo su nota de crédito.
 *
 * En República Dominicana un comprobante emitido NO se borra: el cliente ya lo
 * tiene y probablemente ya está en su declaración, y borrarlo deja un hueco en
 * la secuencia que hay que justificar. Se anula con una nota de crédito que lo
 * referencia, que es lo que la DGII espera ver en el 607.
 */
export async function voidInvoice(
  ctx: TenantContext & { companyId: string },
  invoiceId: string,
  reason: string
): Promise<{ creditNote: Record<string, unknown>; ncf: string }> {
  const companyId = ctx.companyId;
  const invoice = await tenantFindOne<Record<string, unknown>>(companyId, "invoice", invoiceId);

  const blocker = voidBlocker(invoice as never);
  if (blocker) throw Object.assign(new Error(VOID_BLOCK_MESSAGE[blocker]), { status: 409 });
  if (!reason?.trim()) {
    throw Object.assign(new Error("Anular un comprobante fiscal necesita un motivo"), { status: 400 });
  }

  const creditType = creditNoteTypeFor(String(invoice.ncf_type || "b02"));
  const sequence = await consumeNcf(companyId, creditType);
  const creditNcf = formatNcf(creditType, sequence.number);

  const lines = await tenantQuery<Record<string, unknown>>(companyId, "invoice_line", {
    _filter: { invoice: invoiceId }, _limit: 200, _sort: { sort_order: "asc" },
  });

  const creditNote = await tenantCreate<Record<string, unknown>>(companyId, "invoice", {
    number: await uniqueCode(companyId, "invoice", "number", () => newDocumentNumber("NC")),
    ncf: creditNcf,
    ncf_type: creditType,
    ncf_expires_at: sequence.expiresAt,
    series: creditNcf.slice(0, 3),
    invoice_type: "credit_note",
    status: "issued",
    issued_at: new Date().toISOString(),
    credit_note_of: invoiceId,
    order: refId(invoice.order as never),
    customer: refId(invoice.customer as never),
    partner: refId(invoice.partner as never),
    tax_profile: refId(invoice.tax_profile as never),
    customer_name: invoice.customer_name,
    customer_tax_id: invoice.customer_tax_id,
    customer_address: invoice.customer_address,
    subtotal: invoice.subtotal,
    discount: invoice.discount,
    tax: invoice.tax,
    tax_rate: invoice.tax_rate,
    total: invoice.total,
    balance: 0,
    currency: invoice.currency,
    exchange_rate: invoice.exchange_rate,
    efac_status: invoice.efac_status === "not_applicable" ? "not_applicable" : "pending",
    notes: `Anula la factura ${invoice.ncf}. Motivo: ${reason.trim()}`,
    issued_by: ctx.userId,
    user: ctx.userId,
  });

  // La nota de crédito copia el desglose: sin líneas no se puede declarar ni
  // demostrar QUÉ se anuló, que es lo que se pregunta en una inspección.
  for (const line of lines) {
    await tenantCreate(companyId, "invoice_line", {
      invoice: creditNote._id,
      description: line.description,
      quantity: line.quantity,
      unit_price: line.unit_price,
      discount: line.discount,
      tax_rate: line.tax_rate,
      tax_amount: line.tax_amount,
      total: line.total,
      is_exempt: line.is_exempt,
      booking: refId(line.booking as never),
      product: refId(line.product as never),
      sort_order: line.sort_order,
    });
  }

  await tenantUpdate(companyId, "invoice", invoiceId, {
    status: "voided",
    voided_at: new Date().toISOString(),
    void_reason: reason.trim(),
    balance: 0,
  });

  await writeAudit({
    companyId, userId: ctx.userId,
    action: "invoice_voided",
    entityType: "invoice", entityId: invoiceId,
    description: `Factura ${invoice.ncf} anulada con la nota de crédito ${creditNcf} — ${reason.trim()}`,
    severity: "warning",
    metadata: { credit_note: creditNote._id, credit_ncf: creditNcf, total: invoice.total },
  });

  // Anular un comprobante fiscal se justifica ante la DGII, así que no se hace
  // en silencio: la administración se entera el mismo día, no en la revisión.
  await notify({
    companyId,
    event: "invoice_voided",
    entityType: "invoice",
    entityId: invoiceId,
    vars: {
      referencia: String(invoice.ncf || invoice.number || ""),
      monto: Number(invoice.total || 0),
      moneda: String(invoice.currency || "usd"),
    },
  });

  return { creditNote, ncf: creditNcf };
}
