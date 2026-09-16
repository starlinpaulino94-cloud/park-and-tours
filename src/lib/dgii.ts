/**
 * LOS FORMATOS 606 Y 607 DE LA DGII.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ SON Y POR QUÉ NO SON OPCIONALES
 *
 * Toda empresa dominicana envía cada mes dos archivos de texto:
 *
 *  · 607 — SUS VENTAS: cada comprobante fiscal que emitió, con el RNC de quien
 *    compró, el ITBIS facturado y cómo se cobró.
 *  · 606 — SUS COMPRAS Y GASTOS: cada comprobante que le dieron, con el RNC del
 *    proveedor y el ITBIS que pagó.
 *
 * No enviarlos tiene multa, y enviarlos mal tiene revisión. Un ERP que factura
 * con NCF y no genera estos archivos deja el trabajo a medias: el contador
 * vuelve a teclear las mismas facturas en un Excel, y desde ahí la cifra del
 * sistema y la declarada empiezan a separarse.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CÓMO ESTÁ ESCRITO ESTO, Y POR QUÉ ASÍ
 *
 * El orden de las columnas de cada formato está en UNA constante documentada
 * campo por campo. La DGII ajusta el formato de vez en cuando —añade una
 * columna, cambia un tipo de comprobante—, y cuando eso pase el cambio es en
 * esa lista y en ningún otro sitio.
 *
 * Y el archivo se genera aquí, en puro, sin base de datos: así se prueba con
 * casos concretos y se puede comparar con un archivo real antes de enviar nada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ADVERTENCIA HONESTA
 *
 * Este generador reproduce el formato de envío tal como está documentado y
 * probado aquí, pero LA PRIMERA DECLARACIÓN DE CADA EMPRESA DEBE VALIDARSE en
 * la herramienta de la DGII antes de enviarla. La pantalla lo dice también. Un
 * archivo que el sistema da por bueno y la DGII rechaza cuesta una tarde; uno
 * que acepta con datos mal puestos cuesta una revisión.
 */

/* ------------------------------------------------------- identificaciones */

export type IdKind = "1" | "2" | "3";

/**
 * Qué clase de identificación es: RNC (9), cédula (11) o «otro».
 *
 * Se mira SOLO la longitud de los dígitos porque es lo único que distingue de
 * verdad a las dos en este país. Un pasaporte no tiene forma fija, así que todo
 * lo demás cae en «otro», que es lo que la DGII espera para un extranjero.
 */
export function idKind(raw: string | null | undefined): IdKind {
  const digits = onlyDigits(raw);
  if (digits.length === 9) return "1";
  if (digits.length === 11) return "2";
  return "3";
}

export function onlyDigits(raw: string | null | undefined): string {
  return (raw || "").replace(/\D/g, "");
}

/**
 * El identificador, limpio.
 *
 * Los RNC se escriben de cinco maneras —con guiones, con espacios, con
 * puntos— y la DGII solo acepta dígitos. Limpiarlo aquí evita el rechazo más
 * común de todos, que además llega días después y sin decir qué línea.
 */
export function cleanTaxId(raw: string | null | undefined): string {
  return onlyDigits(raw).slice(0, 11);
}

/* ------------------------------------------------------------- formatos */

/** El período que encabeza el archivo: AAAAMM. */
export function periodOf(month: string): string {
  // Entra "2026-09" (lo que da un <input type="month">) y sale "202609".
  return month.replace("-", "").slice(0, 6);
}

/** Una fecha como la escribe la DGII: AAAAMMDD, o vacío si no hay. */
export function dgiiDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * Un importe como lo espera el archivo: punto decimal, dos decimales, sin
 * separador de miles y sin signo de moneda. Cero se escribe vacío en las
 * columnas que la DGII quiere en blanco cuando no aplican.
 */
export function amount(value: number | null | undefined, blankWhenZero = false): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return blankWhenZero ? "" : "0.00";
  if (blankWhenZero && Math.abs(n) < 0.005) return "";
  return n.toFixed(2);
}

/** El NCF, en mayúsculas y sin espacios: es como se compara y como se declara. */
export function cleanNcf(raw: string | null | undefined): string {
  return (raw || "").toUpperCase().replace(/\s+/g, "");
}

/* --------------------------------------------------------------- el 607 */

export interface SaleRow {
  ncf?: string | null;
  ncfModified?: string | null;
  customerTaxId?: string | null;
  /** Tipo de ingreso (01 a 06). Por defecto 01: ingresos por operaciones. */
  incomeType?: string | null;
  issuedAt?: string | null;
  /** Servicios y bienes: una operadora vende servicios casi siempre. */
  services?: number | null;
  goods?: number | null;
  itbis?: number | null;
  itbisWithheld?: number | null;
  isrWithheld?: number | null;
  selectiveTax?: number | null;
  otherTaxes?: number | null;
  legalTip?: number | null;
  /** Cómo se cobró, ya sumado por forma de pago. */
  cash?: number | null;
  transfer?: number | null;
  card?: number | null;
  credit?: number | null;
  voucher?: number | null;
  other?: number | null;
}

/**
 * Las columnas del 607, en orden y con su nombre.
 *
 * Está aquí, y no repartido por el código, porque es lo ÚNICO que hay que
 * tocar cuando la DGII cambie el formato.
 */
export const COLUMNS_607 = [
  "RNC/Cédula", "Tipo identificación", "NCF", "NCF modificado", "Tipo ingreso",
  "Fecha comprobante", "Fecha retención", "Monto facturado servicios",
  "Monto facturado bienes", "Total monto facturado", "ITBIS facturado",
  "ITBIS retenido por terceros", "ITBIS percibido", "Retención renta por terceros",
  "ISR percibido", "Impuesto selectivo al consumo", "Otros impuestos/tasas",
  "Monto propina legal", "Efectivo", "Cheque/transferencia/depósito",
  "Tarjeta débito/crédito", "Venta a crédito", "Bonos o certificados de regalo",
  "Permuta", "Otras formas de venta",
] as const;

export function line607(sale: SaleRow): string[] {
  const services = Number(sale.services ?? 0);
  const goods = Number(sale.goods ?? 0);
  return [
    cleanTaxId(sale.customerTaxId),
    idKind(sale.customerTaxId),
    cleanNcf(sale.ncf),
    cleanNcf(sale.ncfModified),
    // 01 = ingresos por operaciones (el caso de una operadora turística).
    (sale.incomeType || "01").padStart(2, "0"),
    dgiiDate(sale.issuedAt),
    "", // fecha de retención: solo cuando un tercero retiene
    amount(services),
    amount(goods),
    amount(services + goods),
    amount(sale.itbis),
    amount(sale.itbisWithheld, true),
    amount(0, true),
    amount(sale.isrWithheld, true),
    amount(0, true),
    amount(sale.selectiveTax, true),
    amount(sale.otherTaxes, true),
    amount(sale.legalTip, true),
    amount(sale.cash, true),
    amount(sale.transfer, true),
    amount(sale.card, true),
    amount(sale.credit, true),
    amount(sale.voucher, true),
    amount(0, true), // permuta
    amount(sale.other, true),
  ];
}

/* --------------------------------------------------------------- el 606 */

export interface PurchaseRow {
  supplierTaxId?: string | null;
  /** Tipo de bienes y servicios comprados (01 a 11). */
  goodsServiceType?: string | null;
  ncf?: string | null;
  ncfModified?: string | null;
  date?: string | null;
  paidDate?: string | null;
  services?: number | null;
  goods?: number | null;
  itbis?: number | null;
  itbisWithheld?: number | null;
  isrWithheld?: number | null;
  selectiveTax?: number | null;
  otherTaxes?: number | null;
  legalTip?: number | null;
  paymentMethod?: string | null;
}

export const COLUMNS_606 = [
  "RNC/Cédula", "Tipo identificación", "Tipo bienes y servicios comprados", "NCF",
  "NCF modificado", "Fecha comprobante", "Fecha pago", "Monto facturado servicios",
  "Monto facturado bienes", "Total monto facturado", "ITBIS facturado",
  "ITBIS retenido", "ITBIS sujeto a proporcionalidad", "ITBIS llevado al costo",
  "ITBIS por adelantar", "ITBIS percibido en compras", "Tipo retención en ISR",
  "Monto retención renta", "ISR percibido en compras", "Impuesto selectivo al consumo",
  "Otros impuestos/tasas", "Monto propina legal", "Forma de pago",
] as const;

/**
 * Cómo se pagó, en el código de la DGII.
 *
 * Lo que el sistema guarda son sus propias formas de pago; aquí se traducen. Lo
 * que no encaja va a «otras» (07) en vez de quedarse vacío: una columna vacía
 * rechaza la línea entera.
 */
export const PAYMENT_CODES: Record<string, string> = {
  cash: "01",
  check: "02",
  transfer: "03",
  bank: "03",
  wire: "03",
  card: "04",
  credit_card: "04",
  debit_card: "04",
  credit: "05",
  link: "03",
  voucher: "06",
  gift_card: "06",
};

export function paymentCode(method: string | null | undefined): string {
  return PAYMENT_CODES[String(method || "").toLowerCase()] || "07";
}

export function line606(purchase: PurchaseRow): string[] {
  const services = Number(purchase.services ?? 0);
  const goods = Number(purchase.goods ?? 0);
  return [
    cleanTaxId(purchase.supplierTaxId),
    idKind(purchase.supplierTaxId),
    // 09 = gastos de personal … 11 = otras deducciones. Sin esto la DGII no
    // acepta la línea, así que se cae a «otros» antes que dejarla vacía.
    (purchase.goodsServiceType || "09").padStart(2, "0"),
    cleanNcf(purchase.ncf),
    cleanNcf(purchase.ncfModified),
    dgiiDate(purchase.date),
    dgiiDate(purchase.paidDate),
    amount(services),
    amount(goods),
    amount(services + goods),
    amount(purchase.itbis),
    amount(purchase.itbisWithheld, true),
    amount(0, true),
    amount(0, true),
    amount(purchase.itbis, true),
    amount(0, true),
    "", // tipo de retención en ISR
    amount(purchase.isrWithheld, true),
    amount(0, true),
    amount(purchase.selectiveTax, true),
    amount(purchase.otherTaxes, true),
    amount(purchase.legalTip, true),
    paymentCode(purchase.paymentMethod),
  ];
}

/* ------------------------------------------------------------ el archivo */

/* ═══════════════════════════════════════════════ 608 — las anulaciones */

/**
 * Los comprobantes ANULADOS del mes.
 *
 * El 608 es el tercero de la terna y el que más se olvida: la DGII cruza los
 * NCF emitidos con los anulados, y un comprobante que se anuló sin declararlo
 * sigue contando como venta. El sistema ya anula facturas —emite su nota de
 * crédito y todo—, y hasta aquí esa anulación no salía en ninguna declaración.
 */
export const COLUMNS_608 = [
  "NCF", "Fecha comprobante", "Tipo de anulación",
] as const;

/**
 * Los motivos que admite el formato.
 *
 * No es una lista decorativa: la DGII rechaza cualquier código fuera de ella, y
 * el motivo correcto importa —«corrección de la información» y «devolución de
 * productos» se revisan distinto—.
 */
export const VOID_REASONS: Record<string, string> = {
  "01": "Deterioro de factura preimpresa",
  "02": "Errores de impresión (factura preimpresa)",
  "03": "Impresión defectuosa",
  "04": "Duplicidad de factura",
  "05": "Corrección de la información",
  "06": "Cambio de productos",
  "07": "Devolución de productos",
  "08": "Omisión de productos",
  "09": "Errores en secuencia de NCF",
};

/** El código por defecto cuando se anula desde el sistema. */
export const DEFAULT_VOID_REASON = "05";

export interface VoidedRow {
  ncf?: string | null;
  issuedAt?: string | null;
  reasonCode?: string | null;
}

export function line608(voided: VoidedRow): string[] {
  const code = String(voided.reasonCode || DEFAULT_VOID_REASON).padStart(2, "0");
  return [
    cleanNcf(voided.ncf),
    dgiiDate(voided.issuedAt),
    // Un código que el formato no admite tumba el archivo entero, así que lo
    // que no esté en la lista cae en «corrección de la información», que es lo
    // que de verdad ocurre cuando se anula desde el sistema.
    VOID_REASONS[code] ? code : DEFAULT_VOID_REASON,
  ];
}

/** Lo que impide declarar una anulación. */
export function voidProblems(voided: VoidedRow): RowProblem[] {
  const out: RowProblem[] = [];
  if (!cleanNcf(voided.ncf)) out.push("sin_ncf");
  if (!dgiiDate(voided.issuedAt)) out.push("sin_fecha");
  return out;
}

/** Los tres formatos de la terna mensual. */
export type DgiiKind = "606" | "607" | "608";

/**
 * El archivo entero: cabecera y una línea por comprobante, separadas por `|`.
 *
 * La cabecera lleva el RNC de quien declara, el período y CUÁNTAS líneas van.
 * Ese conteo es lo primero que valida la DGII: si no cuadra, rechaza el archivo
 * completo sin mirar el contenido.
 */
export function buildFile(kind: DgiiKind, rnc: string, month: string, rows: string[][]): string {
  const header = [kind, cleanTaxId(rnc), periodOf(month), String(rows.length)].join("|");
  return [header, ...rows.map((row) => row.join("|"))].join("\r\n") + "\r\n";
}

/** Nombre del archivo, como lo espera quien lo sube: DGII_606_RNC_AAAAMM.TXT */
export function fileName(kind: DgiiKind, rnc: string, month: string): string {
  return `DGII_${kind}_${cleanTaxId(rnc)}_${periodOf(month)}.TXT`;
}

/* --------------------------------------------------------- lo que falla */

export type RowProblem = "sin_ncf" | "sin_rnc" | "rnc_invalido" | "sin_fecha" | "sin_tipo";

export const ROW_PROBLEM_MESSAGE: Record<RowProblem, string> = {
  sin_ncf: "Sin NCF: no se puede declarar.",
  sin_rnc: "Sin RNC del tercero: la DGII rechaza la línea.",
  rnc_invalido: "El RNC no tiene 9 u 11 dígitos.",
  sin_fecha: "Sin fecha de comprobante.",
  sin_tipo: "Sin tipo de bienes o servicios.",
};

/**
 * Qué le impide a esta compra entrar en el 606.
 *
 * Se revisa ANTES de generar el archivo y se enseña en pantalla, fila por fila.
 * La alternativa —generar el archivo igual y que la DGII lo rechace— convierte
 * un problema de cinco minutos en una tarde: el rechazo llega después, sin
 * decir qué línea, y hay que revisar el mes entero a mano.
 */
export function purchaseProblems(purchase: PurchaseRow): RowProblem[] {
  const problems: RowProblem[] = [];
  if (!cleanNcf(purchase.ncf)) problems.push("sin_ncf");
  const digits = onlyDigits(purchase.supplierTaxId);
  if (!digits) problems.push("sin_rnc");
  else if (digits.length !== 9 && digits.length !== 11) problems.push("rnc_invalido");
  if (!dgiiDate(purchase.date)) problems.push("sin_fecha");
  if (!purchase.goodsServiceType) problems.push("sin_tipo");
  return problems;
}

/** Y lo mismo para una venta: sin NCF no hay 607, y sin RNC tampoco. */
export function saleProblems(sale: SaleRow): RowProblem[] {
  const problems: RowProblem[] = [];
  if (!cleanNcf(sale.ncf)) problems.push("sin_ncf");
  const digits = onlyDigits(sale.customerTaxId);
  // Una venta a consumidor final (B02) no lleva RNC y es correcta así; la falta
  // solo se señala cuando el comprobante es de los que lo exigen.
  if (digits && digits.length !== 9 && digits.length !== 11) problems.push("rnc_invalido");
  if (!dgiiDate(sale.issuedAt)) problems.push("sin_fecha");
  return problems;
}

/** Los totales que el contador cuadra contra su balance antes de enviar. */
export interface FileTotals {
  rows: number;
  invoiced: number;
  itbis: number;
}

export function totalsOf(rows: { services?: number | null; goods?: number | null; itbis?: number | null }[]): FileTotals {
  return rows.reduce<FileTotals>(
    (acc, row) => ({
      rows: acc.rows + 1,
      invoiced: acc.invoiced + Number(row.services ?? 0) + Number(row.goods ?? 0),
      itbis: acc.itbis + Number(row.itbis ?? 0),
    }),
    { rows: 0, invoiced: 0, itbis: 0 }
  );
}
