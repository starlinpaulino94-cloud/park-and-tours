import "server-only";
import { tenantQuery, type TenantContext } from "@/lib/tenant";
import { companyTimeZone, zonedParts, zoneOffsetMs } from "@/lib/time";
import {
  line606, line607, line608, buildFile, fileName,
  purchaseProblems, saleProblems, voidProblems, totalsOf,
  DEFAULT_VOID_REASON,
  type PurchaseRow, type SaleRow, type RowProblem, type FileTotals,
} from "@/lib/dgii";

/**
 * Los datos de las declaraciones 606 y 607 contra la base.
 *
 * Las decisiones de FORMATO están en `dgii.ts`, que es puro y se prueba entero.
 * Aquí solo se reúne lo que hay que declarar, y se hacen las tres traducciones
 * que el modelo del sistema necesita para hablar el idioma de la DGII.
 */

export type DgiiKind = "606" | "607" | "608";

export interface DgiiRow {
  /** Lo que se enseña en pantalla para reconocer la fila. */
  label: string;
  reference: string;
  date: string | null;
  amountTotal: number;
  itbis: number;
  problems: RowProblem[];
  /** La fila ya formateada, o null cuando no se puede declarar. */
  columns: string[] | null;
}

export interface DgiiReport {
  kind: DgiiKind;
  month: string;
  rows: DgiiRow[];
  totals: FileTotals;
  /** Cuántas quedan fuera del archivo por tener problemas. */
  excluded: number;
}

/**
 * ────────────────────────────────────────────────────────────────────────────
 * EL MES SE CUENTA EN LA ZONA DE LA EMPRESA, NO EN UTC
 *
 * Esto se calculaba con `${month}-01T00:00:00.000Z`, y con una operadora en
 * Santo Domingo —UTC−4— eso desplaza el mes cuatro horas. Una excursión vendida
 * a las 21:00 del 30 de septiembre en el mostrador de un hotel ocurre, en UTC,
 * el 1 de octubre: se declaraba en octubre. Y no es un caso de fin de mes, es la
 * misma cuenta que escribía la fecha del día SIGUIENTE en toda venta posterior
 * a las 20:00 — que es cuando más se vende.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y EL RANGO ES SEMIABIERTO
 *
 * Terminaba en el primer instante del mes siguiente y comparaba con `lte`, así
 * que ese instante caía en los dos meses. La DGII cruza sus totales: una venta
 * declarada dos veces es una diferencia que hay que explicar. `from` incluido,
 * `to` excluido, como cualquier rango de calendario.
 */
const monthRange = (month: string, tz: string) => {
  const [year, mon] = month.split("-").map(Number);
  const instante = (y: number, m: number) => {
    // La medianoche local del día 1, resuelta a instante UTC. Se refina una vez
    // porque el desfase puede cambiar entre la referencia y la medianoche —un
    // cambio de horario de verano— y aquí un error de una hora cambia el mes.
    const pared = Date.UTC(y, m - 1, 1, 0, 0, 0);
    const primera = new Date(pared - zoneOffsetMs(new Date(pared), tz));
    return new Date(pared - zoneOffsetMs(primera, tz));
  };
  const from = instante(year, mon);
  const to = mon === 12 ? instante(year + 1, 1) : instante(year, mon + 1);
  return { from: from.toISOString(), to: to.toISOString() };
};

/**
 * El día LOCAL de un instante, que es el que va en la declaración.
 *
 * `dgiiDate` formatea en UTC, así que hay que darle ya la fecha de calendario
 * de la empresa. Con el instante crudo, una venta de las 21:00 se escribe con
 * la fecha del día siguiente.
 */
const localDay = (value: unknown, tz: string): string | null => {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  const p = zonedParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
};

/** El primer día del mes siguiente, para acotar una columna de tipo fecha. */
const nextMonthDay = (month: string): string => {
  const [year, mon] = month.split("-").map(Number);
  return mon === 12 ? `${year + 1}-01-01` : `${year}-${String(mon + 1).padStart(2, "0")}-01`;
};

const refId = (value: unknown): string | null =>
  typeof value === "string" ? value : (value as { _id?: string })?._id ?? null;

/* ---------------------------------------------------------------- 607 */

/**
 * Cómo se cobró cada factura.
 *
 * El 607 pide el desglose por forma de pago, y el sistema lo guarda en la tabla
 * de pagos, no en la factura. Se agrupan los cobros de la venta a la que
 * pertenece la factura.
 *
 * Una factura sin cobros registrados se declara como VENTA A CRÉDITO, que es
 * exactamente lo que es: se emitió y todavía no se cobró. Repartirla en
 * efectivo «porque suele ser así» sería inventar un dato en una declaración.
 */
async function paymentBreakdown(companyId: string, orderIds: string[]) {
  const byOrder = new Map<string, Record<string, number>>();
  if (orderIds.length === 0) return byOrder;

  const payments = await tenantQuery<{ order?: unknown; method?: string; amount?: number; payment_type?: string }>(
    companyId, "payment",
    { _filter: { order: { in: orderIds } }, _limit: 2000 }
  );

  for (const payment of payments) {
    const orderId = refId(payment.order);
    if (!orderId) continue;
    // Un reembolso no es una forma de cobro: restarlo o sumarlo aquí
    // descuadraría el total declarado contra la factura.
    if (payment.payment_type === "refund" || payment.payment_type === "credit_note") continue;
    const bucket = byOrder.get(orderId) ?? {};
    const method = String(payment.method || "other").toLowerCase();
    bucket[method] = (bucket[method] ?? 0) + Number(payment.amount ?? 0);
    byOrder.set(orderId, bucket);
  }
  return byOrder;
}

async function load607(ctx: TenantContext & { companyId: string }, month: string): Promise<DgiiRow[]> {
  const tz = companyTimeZone(ctx.company as { timezone?: string | null } | null);
  const { from, to } = monthRange(month, tz);
  const invoices = await tenantQuery<Record<string, unknown>>(ctx.companyId, "invoice", {
    _filter: {
      issued_at: { gte: from, lt: to },
      // Solo lo EMITIDO: un borrador no se declara, y una factura anulada se
      // declara por su nota de crédito, que es otra fila con su propio NCF.
      status: { nin: ["draft", "cancelled"] },
    },
    _limit: 3000,
    _sort: { issued_at: "asc" },
  });

  const orderIds = invoices.map((invoice) => refId(invoice.order)).filter((id): id is string => Boolean(id));
  const payments = await paymentBreakdown(ctx.companyId, orderIds);

  return invoices.map((invoice) => {
    const orderId = refId(invoice.order);
    const bucket = (orderId && payments.get(orderId)) || {};
    const subtotal = Number(invoice.subtotal ?? 0);
    const tax = Number(invoice.tax ?? 0);
    const total = Number(invoice.total ?? 0);
    const cobrado = Object.values(bucket).reduce((sum, value) => sum + value, 0);

    const sale: SaleRow = {
      ncf: invoice.ncf as string,
      ncfModified: (invoice.credit_note_of_ncf as string) || null,
      customerTaxId: invoice.customer_tax_id as string,
      // El día de calendario de la empresa, no el de UTC.
      issuedAt: localDay(invoice.issued_at, tz),
      // Una operadora vende servicios; los bienes se declararían aparte si
      // algún día se venden (una tienda de recuerdos, por ejemplo).
      services: subtotal,
      goods: 0,
      itbis: tax,
      cash: bucket.cash,
      transfer: (bucket.transfer ?? 0) + (bucket.bank ?? 0) + (bucket.wire ?? 0) + (bucket.link ?? 0) + (bucket.check ?? 0),
      card: (bucket.card ?? 0) + (bucket.credit_card ?? 0) + (bucket.debit_card ?? 0),
      // Lo que falta por cobrar es venta a crédito: es lo que de verdad es.
      credit: Math.max(0, total - cobrado),
      voucher: (bucket.voucher ?? 0) + (bucket.gift_card ?? 0),
      other: bucket.other,
    };

    const problems = saleProblems(sale);
    return {
      label: String(invoice.customer_name || "Consumidor final"),
      reference: String(invoice.ncf || invoice.number || ""),
      date: (invoice.issued_at as string) || null,
      amountTotal: subtotal,
      itbis: tax,
      problems,
      columns: problems.length === 0 ? line607(sale) : null,
    };
  });
}

/* ---------------------------------------------------------------- 606 */

async function load606(ctx: TenantContext & { companyId: string }, month: string): Promise<DgiiRow[]> {
  /**
   * `expense_date` es una FECHA, no un instante: no tiene zona horaria y no
   * hay que convertirla. Lo que sí hay que hacer es acotarla bien.
   *
   * Se comparaba con `lte` contra el primer día del mes SIGUIENTE, así que
   * todo gasto fechado el día 1 se declaraba dos veces: en su mes y en el
   * anterior. No era un borde improbable — era cada primero de mes.
   */
  const desde = `${month}-01`;
  const hasta = nextMonthDay(month);
  const expenses = await tenantQuery<Record<string, unknown>>(ctx.companyId, "expense", {
    _filter: {
      expense_date: { gte: desde, lt: hasta },
      // Un gasto rechazado no es un gasto: declararlo sería declarar algo que
      // la propia empresa decidió que no cuenta.
      status: { nin: ["rejected"] },
    },
    _limit: 3000,
    _sort: { expense_date: "asc" },
    supplier: true,
  });

  return expenses.map((expense) => {
    const supplier = expense.supplier as { name?: string; tax_id?: string } | null;
    const total = Number(expense.amount ?? 0);
    const itbis = Number(expense.itbis_amount ?? 0);
    // El importe guardado incluye el ITBIS; el formato los quiere separados.
    const base = Math.max(0, total - itbis);

    const purchase: PurchaseRow = {
      // El RNC copiado al registrar manda sobre el del maestro: lo declarado
      // tiene que ser lo que decía la factura, y el maestro puede haber
      // cambiado después.
      supplierTaxId: (expense.supplier_rnc as string) || supplier?.tax_id || null,
      goodsServiceType: expense.goods_service_type as string,
      ncf: expense.ncf as string,
      ncfModified: expense.ncf_modified as string,
      date: expense.expense_date as string,
      paidDate: (expense.paid_date as string) || (expense.expense_date as string),
      services: base,
      goods: 0,
      itbis,
      itbisWithheld: Number(expense.itbis_withheld ?? 0),
      isrWithheld: Number(expense.isr_withheld ?? 0),
      selectiveTax: Number(expense.selective_tax ?? 0),
      otherTaxes: Number(expense.other_taxes ?? 0),
      legalTip: Number(expense.legal_tip ?? 0),
      paymentMethod: expense.payment_method as string,
    };

    const problems = purchaseProblems(purchase);
    return {
      label: String(supplier?.name || expense.concept || "Gasto"),
      reference: String(expense.ncf || expense.concept || ""),
      date: (expense.expense_date as string) || null,
      amountTotal: base,
      itbis,
      problems,
      columns: problems.length === 0 ? line606(purchase) : null,
    };
  });
}

/* ------------------------------------------------------------- el informe */

/* ---------------------------------------------------------------- 608 */

/**
 * Los comprobantes ANULADOS del mes.
 *
 * El 608 es el tercero de la terna y el que más se olvida. La DGII cruza los
 * NCF emitidos con los anulados: un comprobante que se anuló y no se declaró
 * sigue contando como venta, y esa diferencia aparece meses después.
 *
 * Se declaran por la fecha en que se EMITIERON, no por la de anulación: el
 * formato pide la fecha del comprobante, y una factura de agosto anulada en
 * septiembre va en el 608 de agosto.
 */
async function load608(ctx: TenantContext & { companyId: string }, month: string): Promise<DgiiRow[]> {
  const tz = companyTimeZone(ctx.company as { timezone?: string | null } | null);
  const { from, to } = monthRange(month, tz);
  const invoices = await tenantQuery<Record<string, unknown>>(ctx.companyId, "invoice", {
    _filter: {
      issued_at: { gte: from, lt: to },
      status: "voided",
    },
    _sort: { issued_at: "asc" },
    _limit: 3000,
  });

  return invoices.map((inv) => {
    const voided = {
      ncf: (inv.ncf as string) || null,
      issuedAt: localDay(inv.issued_at, tz),
      reasonCode: (inv.void_reason_code as string) || DEFAULT_VOID_REASON,
    };
    const problems = voidProblems(voided);
    return {
      label: String(inv.invoice_number || inv.ncf || "Sin número"),
      reference: String(inv.ncf || ""),
      date: (inv.issued_at as string) || null,
      // Una anulación no declara importes: el formato solo pide NCF, fecha y
      // motivo. Enseñar el importe en pantalla ayuda a reconocerla; en el
      // archivo no va.
      amountTotal: Number(inv.total ?? 0),
      itbis: 0,
      problems,
      columns: problems.length === 0 ? line608(voided) : null,
    };
  });
}

export async function dgiiReport(
  ctx: TenantContext & { companyId: string },
  kind: DgiiKind,
  month: string
): Promise<DgiiReport> {
  const rows =
    kind === "607" ? await load607(ctx, month)
    : kind === "608" ? await load608(ctx, month)
    : await load606(ctx, month);
  const declarables = rows.filter((row) => row.columns);
  return {
    kind,
    month,
    rows,
    totals: totalsOf(declarables.map((row) => ({ services: row.amountTotal, itbis: row.itbis }))),
    excluded: rows.length - declarables.length,
  };
}

export interface DgiiFile {
  name: string;
  content: string;
}

/**
 * El archivo que se sube a la DGII.
 *
 * Solo entran las filas sin problemas: una línea incompleta hace que la DGII
 * rechace el archivo ENTERO, así que se declara lo que está bien y la pantalla
 * enseña lo que falta arreglar. La alternativa —incluirlo todo— cambia un aviso
 * en pantalla por un rechazo días después que no dice qué línea falló.
 */
export function dgiiFile(report: DgiiReport, rnc: string): DgiiFile {
  const rows = report.rows.map((row) => row.columns).filter((columns): columns is string[] => Boolean(columns));
  return {
    name: fileName(report.kind, rnc, report.month),
    content: buildFile(report.kind, rnc, report.month, rows),
  };
}
