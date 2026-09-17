/**
 * «LLÉVATE TUS DATOS»: la empresa completa, en un solo archivo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO EXISTE
 *
 * Tres razones, y ninguna es técnica:
 *
 *  1. ES LO QUE DESTRABA LA VENTA. La objeción que frena a una operadora no es
 *     el precio: es «y si mañana me quiero ir, ¿mis datos se quedan aquí?».
 *     Un botón que devuelve TODO, sin pedir permiso a nadie, la contesta.
 *  2. ES LA PROMESA DEL BLOQUEO POR PLAN. Desde 0042 una empresa con la
 *     suscripción vencida conserva «consultar y exportar». Si al dejar de pagar
 *     no se pudiera sacar lo propio, eso sería un rehén, no un plan.
 *  3. ES LA OBLIGACIÓN LEGAL QUE YA VIENE. El derecho de portabilidad (RGPD y
 *     las leyes locales que lo copian) pide exactamente esto: los datos del
 *     titular, en un formato de uso común y lectura mecánica.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS EXPORTACIONES DISTINTAS, A PROPÓSITO
 *
 * La de cada listado (`/api/export/:resource`) es PARA LEER: expande las
 * relaciones, así que el archivo dice «Hotel Bávaro» donde la base guarda un
 * identificador. Esta es PARA MUDARSE: sale sin expandir, con los
 * identificadores tal cual. No es un descuido —es lo correcto—, porque están
 * TODAS las tablas en el mismo archivo y los identificadores se cruzan entre
 * ellas; expandir aquí haría el volcado más bonito y menos fiel, y multiplicaría
 * por tres el tiempo de una operación que ya recorre ochenta y ocho tablas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTE ARCHIVO DECIDE (y por eso es puro y se prueba)
 *
 * Qué tablas entran, en qué carpeta y con qué nombre; qué archivos se escriben
 * cuando una tabla está vacía; y el texto del LEEME y del inventario. La
 * consulta y el ZIP viven en otro sitio.
 */

import { RESOURCES } from "@/lib/resources";
import { toCsv } from "@/lib/export";

/* -------------------------------------------------------- el mapa de áreas */

export interface CompanyExportArea {
  /** Carpeta dentro del ZIP. Es el nombre del espacio de trabajo del menú. */
  label: string;
  /**
   * Recurso → nombre del archivo, en español y sin acentos.
   *
   * El nombre técnico de la tabla no se pierde: va en el inventario, que es
   * donde lo busca quien va a volver a cargar estos datos en otro sistema.
   */
  files: Record<string, string>;
}

/**
 * Las ocho carpetas, con el vocabulario que el usuario ya conoce del menú.
 *
 * Unas pocas tablas sirven a dos espacios de trabajo (las zonas son del parque y
 * también del pickup); van donde MÁS se usan. Hay una guarda que exige que todo
 * recurso de `RESOURCES` esté aquí exactamente una vez: cuando se añada una
 * tabla nueva y nadie se acuerde de este archivo, la prueba lo dirá, y así el
 * volcado no puede quedarse incompleto en silencio.
 */
export const COMPANY_EXPORT_AREAS: CompanyExportArea[] = [
  {
    label: "Comercial",
    files: {
      order: "pedidos",
      booking: "reservas",
      booking_extra: "reservas-extras",
      participant: "participantes",
      quote: "cotizaciones",
      quote_line: "cotizaciones-lineas",
      quote_option: "cotizaciones-opciones",
      lead: "oportunidades",
      crm_activity: "actividades-de-crm",
      product: "productos",
      product_category: "categorias-de-producto",
      product_modality: "modalidades",
      product_extra: "extras",
      product_cost: "costos-de-producto",
      price_rule: "reglas-de-precio",
      promotion: "promociones",
      cancellation_policy: "politicas-de-cancelacion",
      partner: "partners",
      seller: "vendedores",
      seller_type: "tipos-de-vendedor",
      seller_link: "enlaces-de-vendedor",
      // El embudo se lleva entero: es la prueba de quién trajo a cada cliente,
      // y sin él las comisiones del histórico no se pueden defender.
      seller_attribution: "atribuciones",
      allotment: "allotments",
      commission_rule: "reglas-de-comision",
      commission: "comisiones",
      settlement: "liquidaciones-de-partner",
    },
  },
  {
    label: "Operaciones",
    files: {
      departure: "salidas",
      departure_resource: "recursos-de-salida",
      pickup: "pickups",
      pickup_route: "rutas-de-pickup",
      zone: "zonas",
      vehicle: "vehiculos",
      asset: "activos",
      work_order: "ordenes-de-trabajo",
      maintenance_plan: "planes-de-mantenimiento",
    },
  },
  {
    label: "Parque",
    files: {
      attraction: "atracciones",
      attraction_log: "bitacora-de-atracciones",
      access_ticket: "tickets-de-acceso",
      waiver: "waivers",
      waiver_template: "waivers-plantillas",
      incident: "incidentes",
      incident_action: "acciones-de-incidente",
      inspection: "inspecciones",
      inspection_template: "checklists-de-inspeccion",
    },
  },
  {
    label: "Comercio",
    files: {
      warehouse: "almacenes",
      inventory_item: "articulos",
      stock_level: "existencias",
      stock_movement: "movimientos-de-inventario",
      purchase_order: "compras",
      purchase_order_line: "compras-lineas",
      supplier: "proveedores",
      booking_cost: "costos-por-reserva",
    },
  },
  {
    label: "Clientes",
    files: {
      customer: "clientes",
      voucher: "vouchers",
      membership_plan: "planes-de-membresia",
      membership: "membresias",
      gift_card: "gift-cards",
      gift_card_movement: "gift-cards-movimientos",
      guest_case: "casos-de-huesped",
      message: "mensajes",
      message_template: "plantillas-de-mensaje",
    },
  },
  {
    label: "Finanzas",
    files: {
      cash_register: "cajas",
      cash_session: "sesiones-de-caja",
      cash_count: "arqueos",
      cash_movement: "movimientos-de-caja",
      payment: "pagos",
      payment_schedule: "plan-de-pagos",
      receivable: "cobros",
      payable: "deudas",
      expense: "gastos",
      expense_category: "categorias-de-gasto",
      currency_rate: "tasas-de-cambio",
      invoice: "facturas",
      invoice_line: "facturas-lineas",
      ncf_sequence: "secuencias-ncf",
      tax_profile: "perfiles-fiscales",
      ledger_account: "cuentas-contables",
      ledger_entry: "asientos-contables",
      accounting_period: "periodos-contables",
    },
  },
  {
    label: "Equipo",
    files: {
      staff: "personal",
      shift: "turnos",
      attendance: "asistencia",
      certification: "certificaciones",
      payroll_run: "nomina-corridas",
      payroll_line: "nomina-lineas",
      document: "documentos",
      document_ack: "acuses-de-documento",
    },
  },
  {
    label: "Administracion",
    files: {
      branch: "sucursales",
      hotel: "hoteles",
      task: "tareas",
      approval_request: "aprobaciones",
      notification: "notificaciones",
      integration: "integraciones",
      audit_log: "bitacora-de-auditoria",
    },
  },
];

/* ------------------------------------------------------------ el inventario */

export interface CompanyExportTarget {
  resource: string;
  table: string;
  area: string;
  /** Ruta dentro del ZIP, carpeta incluida. */
  path: string;
}

/** Todas las tablas que entran, en el orden en que se escriben. */
export function companyExportPlan(): CompanyExportTarget[] {
  const plan: CompanyExportTarget[] = [];
  for (const area of COMPANY_EXPORT_AREAS) {
    for (const [resource, name] of Object.entries(area.files)) {
      const def = RESOURCES[resource];
      if (!def) continue;
      plan.push({ resource, table: def.table, area: area.label, path: `${area.label}/${name}.csv` });
    }
  }
  return plan;
}

export interface CompanyExportRow {
  target: CompanyExportTarget;
  rows: number;
  /** Qué pasó con esta tabla, cuando no fue «se exportó completa». */
  note: string;
}

/**
 * El inventario del archivo.
 *
 * Aparecen TODAS las tablas, incluidas las que no tenían ni una fila. Es
 * deliberado: quien recibe el volcado necesita poder distinguir «esta empresa no
 * usaba facturación» de «la exportación se dejó la facturación». Sin el
 * inventario, las dos cosas se ven igual —un archivo que no está—, y la segunda
 * es un fallo grave que nadie detectaría.
 */
export function inventoryCsv(rows: CompanyExportRow[]): string {
  return toCsv(
    ["Carpeta", "Archivo", "Tabla", "Registros", "Nota"],
    rows.map((r) => [
      r.target.area,
      r.rows > 0 ? r.target.path : "",
      r.target.table,
      String(r.rows),
      r.note || (r.rows > 0 ? "" : "sin registros"),
    ])
  );
}

/** Los archivos vacíos no se escriben: quedan declarados en el inventario. */
export function filesToWrite(rows: CompanyExportRow[]): CompanyExportRow[] {
  return rows.filter((r) => r.rows > 0);
}

/* ------------------------------------------------------------------ LEEME */

export interface ReadmeInput {
  company: string;
  at: Date;
  rows: CompanyExportRow[];
  /** Tope de filas por tabla que aplicó esta exportación. */
  rowLimit: number;
}

/**
 * El LEEME que acompaña al volcado.
 *
 * Lo lee alguien que abrió el ZIP meses después, o el técnico del sistema al que
 * se está mudando la operadora. Dice tres cosas que no se deducen de los CSV:
 * qué formato tienen los datos, por qué las referencias son identificadores, y
 * si algo quedó recortado.
 */
export function readmeText(input: ReadmeInput): string {
  const { company, at, rows, rowLimit } = input;
  const conDatos = filesToWrite(rows);
  const total = rows.reduce((sum, r) => sum + r.rows, 0);
  const recortadas = rows.filter((r) => r.note.includes("recort"));
  const omitidas = rows.filter((r) => r.note.includes("permiso"));

  const lineas = [
    `DATOS DE ${company.toUpperCase()}`,
    `Exportado el ${at.toLocaleDateString("es-DO")} a las ${at.toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" })}`,
    "",
    `Contiene ${conDatos.length} archivo(s) con ${total} registro(s) en total,`,
    `repartidos en ${COMPANY_EXPORT_AREAS.length} carpetas. El inventario completo`,
    "—incluidas las tablas que no tenian registros— esta en _inventario.csv.",
    "",
    "FORMATO",
    "",
    "  · Un archivo CSV por tabla, separado por comas y codificado en UTF-8 con",
    "    marca de orden (BOM), que es lo que Excel necesita para los acentos.",
    "  · Fechas en DD/MM/AAAA. Numeros con punto decimal y sin separador de miles.",
    "  · Listas separadas por punto y coma dentro de la misma celda.",
    "  · La columna «Id interno» es el identificador unico de cada registro,",
    "    y es a lo que apuntan las demas tablas.",
    "",
    "REFERENCIAS ENTRE TABLAS",
    "",
    "  Las columnas que apuntan a otra tabla llevan el identificador, no el",
    "  nombre. Por ejemplo, en reservas.csv la columna «Customer» contiene el Id",
    "  interno de una fila de Clientes/clientes.csv. Estan todas las tablas en",
    "  este mismo archivo, asi que cualquier referencia se puede resolver.",
    "",
    "  Si lo que se busca es un archivo LEGIBLE de una sola lista —con los",
    "  nombres ya resueltos— se exporta desde su propia pantalla en el sistema,",
    "  con el boton Exportar. Ese formato tambien se puede volver a importar.",
  ];

  if (recortadas.length > 0) {
    lineas.push(
      "",
      "TABLAS RECORTADAS",
      "",
      `  Esta exportacion trae como maximo ${rowLimit} registros por tabla. Las`,
      "  siguientes tienen mas, y salieron incompletas: traen los primeros",
      "  registros segun el orden con el que su pantalla los lista. Para",
      "  llevarselas enteras, se exportan por rango de fechas desde su pantalla:",
      "",
      ...recortadas.map((r) => `  · ${r.target.path}`)
    );
  }

  if (omitidas.length > 0) {
    lineas.push(
      "",
      "TABLAS NO INCLUIDAS",
      "",
      "  Tu rol no alcanza para leer estas tablas, asi que no se exportaron. Un",
      "  usuario con rol de propietario las obtiene completas:",
      "",
      ...omitidas.map((r) => `  · ${r.target.table}`)
    );
  }

  return lineas.join("\r\n") + "\r\n";
}

/* ------------------------------------------------- el nombre del archivo */

/** Sin acentos, sin espacios y sin nada que moleste a un sistema de archivos. */
export function slug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "empresa";
}

export function companyExportFilename(company: string, at: Date = new Date()): string {
  return `${slug(company)}-datos-${at.toISOString().slice(0, 10)}.zip`;
}
