/**
 * EL CATÁLOGO DE REPORTES.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ UN REGISTRO Y NO UNA PANTALLA POR REPORTE
 *
 * Casi todo reporte de este sistema es la misma forma: un listado de algo,
 * acotado a un período, con unos totales al pie. Escribir cada uno a mano
 * garantiza que a los seis meses el selector de fechas funcione distinto en
 * cada sitio, que uno imprima el encabezado y otro no, y que los totales de dos
 * reportes sumen con criterios distintos.
 *
 * Aquí cada reporte es un DATO: qué tabla, por qué fecha se acota, qué columnas
 * se enseñan y cuáles se suman. Una sola pantalla los pinta todos, así que la
 * impresión, el período y el CSV se comportan igual en los veinte.
 *
 * Lo que NO entra aquí son los reportes con lógica propia —el 606/607, la
 * antigüedad de saldos, la rentabilidad—: ésos calculan, no listan, y tienen su
 * servicio. El registro es para lo que de verdad es un listado con período.
 */

import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { labelOf } from "@/lib/labels";

export type TipoColumna = "texto" | "etiqueta" | "numero" | "dinero" | "fecha" | "fechaHora";

export interface ColumnaReporte {
  clave: string;
  titulo: string;
  tipo?: TipoColumna;
  /** Si la columna es una relación expandida, de dónde sacar el texto. */
  desde?: string;
}

export interface DefinicionReporte {
  slug: string;
  titulo: string;
  descripcion: string;
  grupo: string;
  /** Recurso de `/api/erp/:recurso` y `/api/export/:recurso`. */
  recurso: string;
  /** Campo por el que se acota el período. */
  campoFecha: string;
  columnas: ColumnaReporte[];
  /** Columnas numéricas que se suman al pie. */
  totales?: string[];
}

export const REPORTES: DefinicionReporte[] = [
  // ── Comercial ─────────────────────────────────────────────────────────────
  {
    slug: "ventas", titulo: "Ventas del período", grupo: "Comercial",
    descripcion: "Cada orden con su cliente, canal, estado y lo cobrado.",
    recurso: "order", campoFecha: "order_date",
    columnas: [
      { clave: "order_date", titulo: "Fecha", tipo: "fecha" },
      { clave: "order_number", titulo: "Orden" },
      { clave: "customer", titulo: "Cliente", desde: "name" },
      { clave: "channel", titulo: "Canal", tipo: "etiqueta" },
      { clave: "status", titulo: "Estado", tipo: "etiqueta" },
      { clave: "total", titulo: "Total", tipo: "dinero" },
      { clave: "paid_total", titulo: "Cobrado", tipo: "dinero" },
      { clave: "balance", titulo: "Saldo", tipo: "dinero" },
    ],
    totales: ["total", "paid_total", "balance"],
  },
  {
    slug: "reservas", titulo: "Reservas del período", grupo: "Comercial",
    descripcion: "Reservas tomadas, con pasajeros, importe y estado.",
    recurso: "booking", campoFecha: "booking_date",
    columnas: [
      { clave: "booking_date", titulo: "Tomada", tipo: "fecha" },
      { clave: "booking_number", titulo: "Reserva" },
      { clave: "travel_date", titulo: "Viaja", tipo: "fecha" },
      { clave: "product", titulo: "Excursión", desde: "name" },
      { clave: "pax_total", titulo: "Pax", tipo: "numero" },
      { clave: "status", titulo: "Estado", tipo: "etiqueta" },
      { clave: "total_amount", titulo: "Total", tipo: "dinero" },
      { clave: "paid_amount", titulo: "Cobrado", tipo: "dinero" },
    ],
    totales: ["pax_total", "total_amount", "paid_amount"],
  },
  {
    slug: "cotizaciones", titulo: "Cotizaciones", grupo: "Comercial",
    descripcion: "Lo cotizado en el período y en qué quedó.",
    recurso: "quote", campoFecha: "issued_at",
    columnas: [
      { clave: "issued_at", titulo: "Fecha", tipo: "fecha" },
      { clave: "code", titulo: "Código" },
      { clave: "quote_type", titulo: "Tipo", tipo: "etiqueta" },
      { clave: "pax", titulo: "Pax", tipo: "numero" },
      { clave: "status", titulo: "Estado", tipo: "etiqueta" },
      { clave: "total", titulo: "Total", tipo: "dinero" },
    ],
    totales: ["pax", "total"],
  },
  {
    slug: "clientes-nuevos", titulo: "Clientes nuevos", grupo: "Comercial",
    descripcion: "Quién se dio de alta en el período y por qué canal llegó.",
    recurso: "customer", campoFecha: "created_at",
    columnas: [
      { clave: "created_at", titulo: "Alta", tipo: "fecha" },
      { clave: "first_name", titulo: "Nombre" },
      { clave: "last_name", titulo: "Apellido" },
      { clave: "country", titulo: "País" },
      { clave: "source", titulo: "Origen", tipo: "etiqueta" },
      { clave: "status", titulo: "Estado", tipo: "etiqueta" },
    ],
  },
  {
    slug: "leads", titulo: "Prospectos", grupo: "Comercial",
    descripcion: "Prospectos entrados en el período y su etapa.",
    recurso: "lead", campoFecha: "created_at",
    columnas: [
      { clave: "created_at", titulo: "Fecha", tipo: "fecha" },
      { clave: "name", titulo: "Prospecto" },
      { clave: "source", titulo: "Origen", tipo: "etiqueta" },
      { clave: "status", titulo: "Etapa", tipo: "etiqueta" },
      { clave: "pax", titulo: "Pax", tipo: "numero" },
      { clave: "estimated_value", titulo: "Valor estimado", tipo: "dinero" },
    ],
    totales: ["estimated_value"],
  },

  // ── Dinero ────────────────────────────────────────────────────────────────
  {
    slug: "cobros", titulo: "Cobros recibidos", grupo: "Dinero",
    descripcion: "Todo lo que entró, con su método y referencia.",
    recurso: "payment", campoFecha: "paid_at",
    columnas: [
      { clave: "paid_at", titulo: "Fecha", tipo: "fechaHora" },
      { clave: "reference", titulo: "Referencia" },
      { clave: "method", titulo: "Método", tipo: "etiqueta" },
      { clave: "payment_type", titulo: "Tipo", tipo: "etiqueta" },
      { clave: "status", titulo: "Estado", tipo: "etiqueta" },
      { clave: "amount", titulo: "Importe", tipo: "dinero" },
    ],
    totales: ["amount"],
  },
  {
    slug: "facturacion", titulo: "Facturación emitida", grupo: "Dinero",
    descripcion: "Facturas del período con su NCF, ITBIS y estado.",
    recurso: "invoice", campoFecha: "issued_at",
    columnas: [
      { clave: "issued_at", titulo: "Emitida", tipo: "fecha" },
      { clave: "number", titulo: "Número" },
      { clave: "ncf", titulo: "NCF" },
      { clave: "customer_name", titulo: "Cliente" },
      { clave: "status", titulo: "Estado", tipo: "etiqueta" },
      { clave: "subtotal", titulo: "Subtotal", tipo: "dinero" },
      { clave: "tax", titulo: "ITBIS", tipo: "dinero" },
      { clave: "total", titulo: "Total", tipo: "dinero" },
    ],
    totales: ["subtotal", "tax", "total"],
  },
  {
    slug: "cuentas-por-cobrar", titulo: "Cuentas por cobrar", grupo: "Dinero",
    descripcion: "Lo que quedó pendiente, con su vencimiento.",
    recurso: "receivable", campoFecha: "issue_date",
    columnas: [
      { clave: "issue_date", titulo: "Emitida", tipo: "fecha" },
      { clave: "document_number", titulo: "Documento" },
      { clave: "due_date", titulo: "Vence", tipo: "fecha" },
      { clave: "status", titulo: "Estado", tipo: "etiqueta" },
      { clave: "amount", titulo: "Importe", tipo: "dinero" },
      { clave: "paid_amount", titulo: "Cobrado", tipo: "dinero" },
      { clave: "balance", titulo: "Saldo", tipo: "dinero" },
    ],
    totales: ["amount", "paid_amount", "balance"],
  },
  {
    slug: "gastos", titulo: "Gastos", grupo: "Dinero",
    descripcion: "Gastos del período con su NCF y su ITBIS, listos para el 606.",
    recurso: "expense", campoFecha: "expense_date",
    columnas: [
      { clave: "expense_date", titulo: "Fecha", tipo: "fecha" },
      { clave: "concept", titulo: "Concepto" },
      { clave: "ncf", titulo: "NCF" },
      { clave: "payment_method", titulo: "Método", tipo: "etiqueta" },
      { clave: "status", titulo: "Estado", tipo: "etiqueta" },
      { clave: "itbis_amount", titulo: "ITBIS", tipo: "dinero" },
      { clave: "amount", titulo: "Importe", tipo: "dinero" },
    ],
    totales: ["itbis_amount", "amount"],
  },
  {
    slug: "comisiones", titulo: "Comisiones devengadas", grupo: "Dinero",
    descripcion: "Comisión por beneficiario, con su base y su estado de pago.",
    recurso: "commission", campoFecha: "created_at",
    columnas: [
      { clave: "created_at", titulo: "Fecha", tipo: "fecha" },
      { clave: "beneficiary_name", titulo: "Beneficiario" },
      { clave: "beneficiary_type", titulo: "Tipo", tipo: "etiqueta" },
      { clave: "base_amount", titulo: "Base", tipo: "dinero" },
      { clave: "percentage", titulo: "%", tipo: "numero" },
      { clave: "status", titulo: "Estado", tipo: "etiqueta" },
      { clave: "amount", titulo: "Comisión", tipo: "dinero" },
    ],
    totales: ["base_amount", "amount"],
  },
  {
    slug: "liquidaciones", titulo: "Liquidaciones", grupo: "Dinero",
    descripcion: "Cortes a proveedores y vendedores, con lo pagado y lo pendiente.",
    recurso: "settlement", campoFecha: "created_at",
    columnas: [
      { clave: "created_at", titulo: "Fecha", tipo: "fecha" },
      { clave: "code", titulo: "Código" },
      { clave: "beneficiary_name", titulo: "Beneficiario" },
      { clave: "status", titulo: "Estado", tipo: "etiqueta" },
      { clave: "commission_total", titulo: "Comisión", tipo: "dinero" },
      { clave: "paid_total", titulo: "Pagado", tipo: "dinero" },
      { clave: "pending_total", titulo: "Pendiente", tipo: "dinero" },
    ],
    totales: ["commission_total", "paid_total", "pending_total"],
  },
  {
    slug: "caja", titulo: "Movimientos de caja", grupo: "Dinero",
    descripcion: "Cada entrada y salida de caja, con su concepto.",
    recurso: "cash_movement", campoFecha: "movement_at",
    columnas: [
      { clave: "movement_at", titulo: "Fecha", tipo: "fechaHora" },
      { clave: "movement_type", titulo: "Tipo", tipo: "etiqueta" },
      { clave: "concept", titulo: "Concepto" },
      { clave: "reference", titulo: "Referencia" },
      { clave: "amount", titulo: "Importe", tipo: "dinero" },
    ],
    totales: ["amount"],
  },
  {
    slug: "costos-proveedor", titulo: "Costos de proveedor", grupo: "Dinero",
    descripcion: "Lo que cada reserva le debe a un proveedor y si ya se liquidó.",
    recurso: "booking_cost", campoFecha: "created_at",
    columnas: [
      { clave: "created_at", titulo: "Fecha", tipo: "fecha" },
      { clave: "concept", titulo: "Concepto" },
      { clave: "cost_type", titulo: "Tipo", tipo: "etiqueta" },
      { clave: "status", titulo: "Estado", tipo: "etiqueta" },
      { clave: "amount", titulo: "Importe", tipo: "dinero" },
    ],
    totales: ["amount"],
  },

  // ── Operación ─────────────────────────────────────────────────────────────
  {
    slug: "salidas", titulo: "Salidas operadas", grupo: "Operación",
    descripcion: "Salidas del período con cupo, vendido y estado.",
    recurso: "departure", campoFecha: "departure_at",
    columnas: [
      { clave: "departure_at", titulo: "Salida", tipo: "fechaHora" },
      { clave: "product", titulo: "Excursión", desde: "name" },
      { clave: "capacity", titulo: "Cupo", tipo: "numero" },
      { clave: "booked_pax", titulo: "Vendido", tipo: "numero" },
      { clave: "actual_pax", titulo: "Operado", tipo: "numero" },
      { clave: "no_show_pax", titulo: "No-show", tipo: "numero" },
      { clave: "status", titulo: "Estado", tipo: "etiqueta" },
    ],
    totales: ["capacity", "booked_pax", "actual_pax", "no_show_pax"],
  },
  {
    slug: "tickets", titulo: "Tickets de acceso", grupo: "Operación",
    descripcion: "Pases emitidos, su vigencia y si se usaron.",
    recurso: "access_ticket", campoFecha: "issued_at",
    columnas: [
      { clave: "issued_at", titulo: "Emitido", tipo: "fecha" },
      { clave: "code", titulo: "Código" },
      { clave: "ticket_type", titulo: "Tipo", tipo: "etiqueta" },
      { clave: "holder_name", titulo: "Titular" },
      { clave: "status", titulo: "Estado", tipo: "etiqueta" },
      { clave: "price", titulo: "Precio", tipo: "dinero" },
    ],
    totales: ["price"],
  },
  {
    slug: "incidencias", titulo: "Incidencias", grupo: "Operación",
    descripcion: "Lo que pasó y cómo se cerró. Para la póliza y para la mejora.",
    recurso: "incident", campoFecha: "occurred_at",
    columnas: [
      { clave: "occurred_at", titulo: "Ocurrió", tipo: "fechaHora" },
      { clave: "code", titulo: "Código" },
      { clave: "incident_type", titulo: "Tipo", tipo: "etiqueta" },
      { clave: "severity", titulo: "Gravedad", tipo: "etiqueta" },
      { clave: "title", titulo: "Asunto" },
      { clave: "status", titulo: "Estado", tipo: "etiqueta" },
    ],
  },
  {
    slug: "ordenes-trabajo", titulo: "Órdenes de trabajo", grupo: "Operación",
    descripcion: "Mantenimiento hecho y pendiente, con su costo.",
    recurso: "work_order", campoFecha: "opened_at",
    columnas: [
      { clave: "opened_at", titulo: "Abierta", tipo: "fecha" },
      { clave: "code", titulo: "Código" },
      { clave: "title", titulo: "Trabajo" },
      { clave: "order_type", titulo: "Tipo", tipo: "etiqueta" },
      { clave: "priority", titulo: "Prioridad", tipo: "etiqueta" },
      { clave: "status", titulo: "Estado", tipo: "etiqueta" },
      { clave: "total_cost", titulo: "Costo", tipo: "dinero" },
    ],
    totales: ["total_cost"],
  },

  // ── Almacén ───────────────────────────────────────────────────────────────
  {
    slug: "kardex", titulo: "Kardex de movimientos", grupo: "Almacén",
    descripcion: "Cada entrada y salida de inventario del período.",
    recurso: "stock_movement", campoFecha: "moved_at",
    columnas: [
      { clave: "moved_at", titulo: "Fecha", tipo: "fechaHora" },
      { clave: "movement_type", titulo: "Tipo", tipo: "etiqueta" },
      { clave: "reference", titulo: "Referencia" },
      { clave: "quantity", titulo: "Cantidad", tipo: "numero" },
      { clave: "total_cost", titulo: "Costo", tipo: "dinero" },
    ],
    totales: ["quantity", "total_cost"],
  },
  {
    slug: "compras", titulo: "Órdenes de compra", grupo: "Almacén",
    descripcion: "Lo comprado en el período y en qué estado está.",
    recurso: "purchase_order", campoFecha: "ordered_at",
    columnas: [
      { clave: "ordered_at", titulo: "Fecha", tipo: "fecha" },
      { clave: "code", titulo: "Orden" },
      { clave: "status", titulo: "Estado", tipo: "etiqueta" },
      { clave: "subtotal", titulo: "Subtotal", tipo: "dinero" },
      { clave: "tax", titulo: "Impuesto", tipo: "dinero" },
      { clave: "total", titulo: "Total", tipo: "dinero" },
    ],
    totales: ["subtotal", "tax", "total"],
  },

  // ── Equipo ────────────────────────────────────────────────────────────────
  {
    slug: "asistencia", titulo: "Asistencia del personal", grupo: "Equipo",
    descripcion: "Quién trabajó, cuántas horas y con qué estado.",
    recurso: "attendance", campoFecha: "attendance_date",
    columnas: [
      { clave: "attendance_date", titulo: "Día", tipo: "fecha" },
      { clave: "staff", titulo: "Persona", desde: "full_name" },
      { clave: "status", titulo: "Estado", tipo: "etiqueta" },
      { clave: "hours_worked", titulo: "Horas", tipo: "numero" },
      { clave: "overtime_hours", titulo: "Extras", tipo: "numero" },
    ],
    totales: ["hours_worked", "overtime_hours"],
  },
  {
    slug: "nomina", titulo: "Nómina", grupo: "Equipo",
    descripcion: "Lo devengado, lo deducido y lo pagado por persona.",
    recurso: "payroll_line", campoFecha: "created_at",
    columnas: [
      { clave: "created_at", titulo: "Fecha", tipo: "fecha" },
      { clave: "staff_name", titulo: "Persona" },
      { clave: "gross_amount", titulo: "Devengado", tipo: "dinero" },
      { clave: "deductions_amount", titulo: "Deducciones", tipo: "dinero" },
      { clave: "net_amount", titulo: "Neto", tipo: "dinero" },
    ],
    totales: ["gross_amount", "deductions_amount", "net_amount"],
  },

  // ── Huésped ───────────────────────────────────────────────────────────────
  {
    slug: "encuestas", titulo: "Encuestas respondidas", grupo: "Huésped",
    descripcion: "La nota que dejó cada huésped, con sus valoraciones.",
    recurso: "guest_survey", campoFecha: "answered_at",
    columnas: [
      { clave: "answered_at", titulo: "Respondida", tipo: "fecha" },
      { clave: "nps", titulo: "NPS", tipo: "numero" },
      { clave: "rating_guide", titulo: "Guía", tipo: "numero" },
      { clave: "rating_transport", titulo: "Transporte", tipo: "numero" },
      { clave: "rating_value", titulo: "Precio", tipo: "numero" },
      { clave: "comment", titulo: "Comentario" },
    ],
  },
];

export function reportePorSlug(slug: string): DefinicionReporte | null {
  return REPORTES.find((r) => r.slug === slug) ?? null;
}

/** Los grupos, en el orden en que aparecen en el registro. */
export function gruposDeReportes(): { grupo: string; reportes: DefinicionReporte[] }[] {
  const mapa = new Map<string, DefinicionReporte[]>();
  for (const r of REPORTES) {
    if (!mapa.has(r.grupo)) mapa.set(r.grupo, []);
    mapa.get(r.grupo)!.push(r);
  }
  return [...mapa.entries()].map(([grupo, reportes]) => ({ grupo, reportes }));
}

/**
 * El valor de una celda, ya crudo (sin formatear).
 *
 * Las relaciones vienen expandidas como objeto; con `desde` se dice de qué
 * campo sacar el texto. Sin esto, la columna «Cliente» imprimiría
 * `[object Object]`, que es el defecto clásico de un listado genérico.
 */
export function valorCrudo(fila: Record<string, unknown>, col: ColumnaReporte): unknown {
  const v = fila[col.clave];
  if (col.desde && v && typeof v === "object") {
    return (v as Record<string, unknown>)[col.desde] ?? null;
  }
  return v;
}

/**
 * El texto de una celda, ya listo para pantalla Y para papel.
 *
 * Vive aquí, junto al registro, y no en la pantalla, por un motivo concreto:
 * una columna de estado que llegue sin traducir imprime `partially_paid` en el
 * documento. Una hoja que hay que traducir mentalmente no es un reporte, y el
 * error no se nota hasta que ya está impresa y firmada.
 *
 * `labelOf` con un diccionario vacío cae a los estados genéricos y, si tampoco
 * los conoce, humaniza la clave: peor es imprimir el identificador crudo.
 */
export function textoCelda(
  fila: Record<string, unknown>,
  col: ColumnaReporte,
  moneda: string,
): string {
  const v = valorCrudo(fila, col);
  if (v === null || v === undefined || v === "") return "—";

  switch (col.tipo) {
    case "dinero":
      return formatMoney(typeof v === "number" ? v : Number(v), moneda);
    case "numero": {
      const n = typeof v === "number" ? v : Number(v);
      // Un decimal solo cuando de verdad lo tiene: "3" se lee mejor que "3.0",
      // y las horas trabajadas sí necesitan el medio.
      return Number.isFinite(n) ? formatNumber(n, Number.isInteger(n) ? 0 : 2) : String(v);
    }
    case "fecha":
      return formatDate(String(v));
    case "fechaHora":
      return formatDateTime(String(v));
    case "etiqueta":
      return labelOf({}, typeof v === "boolean" ? v : String(v)).label;
    default:
      return String(v);
  }
}

/** Las columnas numéricas se alinean a la derecha; el resto, a la izquierda. */
export function esNumerica(col: ColumnaReporte): boolean {
  return col.tipo === "numero" || col.tipo === "dinero";
}

/** Suma defensiva: lo que no es número no suma, pero tampoco rompe el total. */
export function sumaColumna(filas: Record<string, unknown>[], clave: string): number {
  let total = 0;
  for (const f of filas) {
    const v = f[clave];
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

/** Los totales del pie, solo de las columnas declaradas. */
export function totalesDe(
  filas: Record<string, unknown>[],
  def: DefinicionReporte,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const clave of def.totales ?? []) out[clave] = sumaColumna(filas, clave);
  return out;
}

/** La moneda del reporte: la de las filas si coinciden, y si no, la de la empresa. */
export function monedaDe(filas: Record<string, unknown>[], porDefecto = "usd"): string {
  const monedas = new Set(
    filas.map((f) => (typeof f.currency === "string" ? f.currency : null)).filter(Boolean) as string[],
  );
  return monedas.size === 1 ? [...monedas][0] : porDefecto;
}
