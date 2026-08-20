/**
 * Arquitectura de navegación — configuración declarativa única.
 *
 *   PLATAFORMA → WORKSPACE → GRUPO → MÓDULO → TAREA
 *
 * Nivel 1: 10 workspaces. Nunca crece: si hiciera falta un undécimo, primero se
 * revisa qué debe fusionarse. Nivel 2: al entrar a un workspace su árbol de
 * grupos reemplaza por completo al anterior — no hay acordeones simultáneos.
 *
 * Toda la visibilidad (rol, capacidad del plan, tipo de empresa) se decide aquí.
 * Los componentes no llevan `if (company.type === …)`: leen esta configuración.
 *
 * Las rutas de los módulos NO cambiaron con el refactor. Un módulo puede vivir
 * en un workspace cuyo slug no coincide con su URL (p. ej. `/dashboard/pos`
 * pertenece a Comercial); `workspaceOf()` resuelve la pertenencia por
 * coincidencia de prefijo más largo, así los deep links históricos siguen vivos.
 *
 * Documentación y matriz de migración: project-docs/navigation-architecture.md
 * Client-safe: sin imports de servidor.
 */

export type BadgeKey = "tasks" | "approvals" | "incidents";

export interface NavItem {
  /** Identificador estable (favoritos, recientes, telemetría). */
  id: string;
  /** Ruta absoluta. Es también la clave canónica del módulo. */
  href: string;
  /** Nombre corto: una o dos palabras. El detalle vive en `description`. */
  label: string;
  icon: string;
  /** Una línea; se muestra en el hub del workspace y en el buscador. */
  description: string;
  /** Rol mínimo por ranking. */
  minRole?: string;
  /** Lista explícita de roles, cuando el ranking no alcanza a distinguirlos. */
  roles?: string[];
  /** Capacidad del plan (`modules_enabled`). */
  module?: string;
  /** Tipos de empresa que lo necesitan. Vacío = todos. */
  companyTypes?: string[];
  /** Contador accionable en el sidebar. */
  badgeKey?: BadgeKey;
  /** Etiqueta corta junto al nombre (p. ej. POS). */
  tag?: string;
  /** Destacado en el hub como entrada principal del workspace. */
  primary?: boolean;
  /** Abre fuera del panel interno. */
  external?: boolean;
  /** Sinónimos para el buscador ⌘K. */
  keywords?: string[];
}

export interface NavGroup {
  id: string;
  title: string;
  items: NavItem[];
}

export interface Workspace {
  id: string;
  /** Segmento de URL del hub. `inicio` mapea a `/dashboard`. */
  slug: string;
  label: string;
  /** Etiqueta corta para el riel. */
  short: string;
  icon: string;
  tagline: string;
  href: string;
  order: number;
  /** Ancla el workspace al pie del riel (Administración). */
  footer?: boolean;
  minRole?: string;
  roles?: string[];
  companyTypes?: string[];
  groups: NavGroup[];
}

/** Contexto con el que se filtra toda la navegación. */
export interface NavContext {
  role?: string;
  modules?: string[] | null;
  companyType?: string;
}

const PARK_TYPES = ["park", "mixed_operator"];

/* -------------------------------------------------------------------------- */
/* Nivel 1 + nivel 2                                                          */
/* -------------------------------------------------------------------------- */

export const WORKSPACES: Workspace[] = [
  {
    id: "inicio",
    slug: "inicio",
    label: "Inicio",
    short: "Inicio",
    icon: "LayoutDashboard",
    tagline: "El pulso del negocio y lo que te toca resolver hoy.",
    href: "/dashboard",
    order: 1,
    groups: [
      {
        id: "inicio-panel",
        title: "Panel",
        items: [
          { id: "panel", href: "/dashboard", label: "Panel", icon: "LayoutDashboard", primary: true,
            description: "Ventas, ocupación, caja y alertas del día en tiempo real.",
            keywords: ["dashboard", "resumen", "inicio", "kpi"] },
          { id: "mi-dia", href: "/dashboard/inicio/mi-dia", label: "Mi día", icon: "Sun",
            description: "Tareas, aprobaciones y avisos que te toca resolver hoy.",
            keywords: ["hoy", "pendientes", "agenda"] },
        ],
      },
      {
        id: "inicio-pendientes",
        title: "Pendientes",
        items: [
          { id: "tareas", href: "/dashboard/inicio/tareas", label: "Tareas", icon: "SquareCheck", badgeKey: "tasks",
            description: "Seguimientos manuales y tareas generadas por el sistema.",
            keywords: ["to do", "seguimiento"] },
          { id: "notificaciones", href: "/dashboard/inicio/notificaciones", label: "Notificaciones", icon: "Bell",
            description: "Avisos operativos, comerciales y financieros.",
            keywords: ["alertas", "avisos"] },
        ],
      },
    ],
  },

  {
    id: "comercial",
    slug: "comercial",
    label: "Comercial",
    short: "Comercial",
    icon: "ShoppingCart",
    tagline: "Todo lo que genera ingreso: vender, definir la oferta y distribuirla.",
    href: "/dashboard/comercial",
    order: 2,
    groups: [
      {
        id: "com-ventas",
        title: "Ventas",
        items: [
          { id: "pos", href: "/dashboard/pos", label: "POS", icon: "ShoppingCart", tag: "POS", primary: true,
            description: "Venta rápida con disponibilidad, precios y cobro en un paso.",
            keywords: ["punto de venta", "taquilla", "caja rápida", "mostrador"] },
          { id: "reservas", href: "/dashboard/reservas", label: "Reservas", icon: "CalendarCheck", module: "bookings",
            description: "Todas las reservas con su estado, pago y participantes.",
            keywords: ["booking", "reserva"] },
          { id: "salidas", href: "/dashboard/salidas", label: "Salidas", icon: "CalendarRange", module: "bookings",
            description: "Cupos por salida, ocupación y cierre de ventas.",
            keywords: ["cupos", "departures", "disponibilidad", "aforo de salida"] },
          { id: "tickets", href: "/dashboard/ventas/tickets", label: "Tickets", icon: "Ticket", minRole: "cashier",
            description: "Entradas, pulseras y pases emitidos con sus redenciones.",
            keywords: ["entradas", "pases", "pulseras"] },
          { id: "cotizaciones", href: "/dashboard/ventas/cotizaciones", label: "Cotizaciones", icon: "FileText",
            description: "Grupos, corporativos y eventos con margen calculado.",
            keywords: ["presupuesto", "quote", "grupos"] },
        ],
      },
      {
        id: "com-pipeline",
        title: "Pipeline",
        items: [
          { id: "crm", href: "/dashboard/crm", label: "CRM y leads", icon: "Sparkles", module: "crm",
            description: "Oportunidades, actividades y seguimiento de contactos.",
            keywords: ["leads", "oportunidades", "prospectos"] },
          { id: "vendedores", href: "/dashboard/vendedores", label: "Vendedores", icon: "UserRound", minRole: "manager",
            description: "Equipo comercial, metas, límites de descuento y desempeño.",
            keywords: ["comercial", "metas", "sellers"] },
          { id: "promociones", href: "/dashboard/promociones", label: "Promociones", icon: "BadgePercent", minRole: "manager",
            description: "Descuentos, paquetes y campañas con reglas de vigencia.",
            keywords: ["descuentos", "campañas", "ofertas"] },
        ],
      },
      {
        id: "com-catalogo",
        title: "Catálogo",
        items: [
          { id: "productos", href: "/dashboard/productos", label: "Productos", icon: "Ticket",
            description: "Catálogo completo con duración, aforo y requisitos.",
            keywords: ["excursiones", "actividades", "tours", "paquetes"] },
          { id: "modalidades", href: "/dashboard/catalogo/modalidades", label: "Modalidades", icon: "Layers", minRole: "manager",
            description: "Variantes por horario, transporte o nivel de servicio.",
            keywords: ["variantes", "opciones", "adulto niño"] },
          { id: "categorias", href: "/dashboard/catalogo/categorias", label: "Categorías", icon: "FolderTree", minRole: "manager",
            description: "Agrupación del catálogo para reportes y portal B2B." },
          { id: "precios", href: "/dashboard/catalogo/precios", label: "Precios", icon: "Tags", minRole: "manager",
            description: "Tarifas por canal, temporada, pax y antelación.",
            keywords: ["tarifas", "rates", "reglas de precio"] },
          { id: "costos", href: "/dashboard/catalogo/costos", label: "Costos", icon: "Calculator", minRole: "manager",
            description: "Costos fijos y variables que alimentan el margen real." },
          { id: "politicas", href: "/dashboard/catalogo/politicas", label: "Políticas", icon: "FileWarning", minRole: "manager",
            description: "Plazos y penalidades aplicadas en cada cancelación.",
            keywords: ["cancelación", "reembolso", "penalidad"] },
          { id: "planes-membresia", href: "/dashboard/catalogo/membresias", label: "Planes", icon: "IdCard", minRole: "manager",
            description: "Pases anuales y de temporada con beneficios y visitas.",
            keywords: ["membresías", "pases anuales", "season pass"] },
        ],
      },
      {
        id: "com-distribucion",
        title: "Distribución",
        items: [
          { id: "partners", href: "/dashboard/partners", label: "Tour centers", icon: "Handshake", minRole: "manager",
            description: "Socios comerciales, contratos, crédito y productos autorizados.",
            keywords: ["agencias", "partners", "socios", "revendedores", "otas"] },
          { id: "allotments", href: "/dashboard/distribucion/allotments", label: "Allotments", icon: "TableProperties", minRole: "manager",
            description: "Cupos garantizados, free sale y liberación automática.",
            keywords: ["cupos", "garantizado", "free sale"] },
          { id: "reglas-comision", href: "/dashboard/distribucion/reglas", label: "Reglas", icon: "Sliders", minRole: "admin",
            description: "Precedencia de comisión por socio, producto, canal y vigencia.",
            keywords: ["comisión", "reglas de comisión"] },
          { id: "comisiones", href: "/dashboard/comisiones", label: "Comisiones", icon: "Percent", module: "commissions", minRole: "manager",
            description: "Comisiones calculadas con su snapshot inmutable." },
          { id: "liquidaciones", href: "/dashboard/liquidaciones", label: "Liquidaciones", icon: "FileSpreadsheet", module: "settlements", minRole: "manager",
            description: "Cortes por periodo, aprobación y pago a la red.",
            keywords: ["settlements", "cortes", "estados de cuenta"] },
          { id: "portal-b2b", href: "/portal", label: "Portal B2B", icon: "ExternalLink", external: true,
            module: "b2b_portal", minRole: "manager",
            description: "La vista que ven tus socios para reservar y liquidar." },
        ],
      },
    ],
  },

  {
    id: "operaciones",
    slug: "operaciones",
    label: "Operaciones",
    short: "Oper.",
    icon: "Radar",
    tagline: "Ejecutar la experiencia del día y sostener los activos que la hacen posible.",
    href: "/dashboard/operaciones",
    order: 3,
    groups: [
      {
        id: "ope-dia",
        title: "Día de operación",
        items: [
          { id: "despacho", href: "/dashboard/operaciones/despacho", label: "Despacho", icon: "Radar", module: "operations",
            primary: true, roles: ["superadmin", "owner", "admin", "manager", "operations"],
            description: "Tablero del día: salidas, pax, vehículos, guías y bloqueos.",
            keywords: ["dispatch", "hoy", "operación diaria", "manifiestos"] },
          { id: "checkin", href: "/dashboard/checkin", label: "Check-in", icon: "ScanLine", module: "bookings", minRole: "cashier",
            description: "Escanea vouchers, valida waivers y confirma asistencia.",
            keywords: ["escanear", "qr", "boarding", "abordaje", "acceso"] },
          { id: "pickups", href: "/dashboard/pickups", label: "Pickups", icon: "MapPin", module: "pickups",
            roles: ["superadmin", "owner", "admin", "manager", "operations"],
            description: "Recogidas por hotel con hora, pax y confirmación.",
            keywords: ["recogidas", "hoteles", "meeting point"] },
          { id: "rutas", href: "/dashboard/operaciones/rutas", label: "Rutas", icon: "Route", module: "pickups",
            roles: ["superadmin", "owner", "admin", "manager", "operations"],
            description: "Secuencia de paradas, tiempos y capacidad por ruta." },
        ],
      },
      {
        id: "ope-recursos",
        title: "Recursos",
        items: [
          { id: "transporte", href: "/dashboard/transporte", label: "Transporte", icon: "Bus", module: "transport",
            roles: ["superadmin", "owner", "admin", "manager", "operations"],
            description: "Flota, capacidad, documentos y disponibilidad.",
            keywords: ["vehículos", "flota", "buses", "conductores"] },
          { id: "asignacion", href: "/dashboard/operaciones/recursos", label: "Asignación", icon: "Boxes",
            roles: ["superadmin", "owner", "admin", "manager", "operations"],
            description: "Vehículos y personal asignados a cada salida.",
            keywords: ["recursos", "guías", "equipos"] },
        ],
      },
      {
        id: "ope-mantenimiento",
        title: "Mantenimiento",
        items: [
          { id: "activos", href: "/dashboard/mantenimiento/activos", label: "Activos", icon: "Cog",
            roles: ["superadmin", "owner", "admin", "manager", "operations"],
            description: "Atracciones, vehículos y equipos con estado y medidores.",
            keywords: ["assets", "equipos", "maquinaria"] },
          { id: "fuera-servicio", href: "/dashboard/mantenimiento/fuera-de-servicio", label: "Fuera de servicio", icon: "OctagonX",
            roles: ["superadmin", "owner", "admin", "manager", "operations"],
            description: "Impacto en cupos y reservas afectadas por activo caído.",
            keywords: ["averías", "downtime", "caído"] },
          { id: "ordenes-trabajo", href: "/dashboard/mantenimiento/ordenes", label: "Órdenes", icon: "Wrench",
            roles: ["superadmin", "owner", "admin", "manager", "operations"],
            description: "Correctivo, preventivo y emergencias con costo y downtime.",
            keywords: ["work order", "reparaciones"] },
          { id: "preventivos", href: "/dashboard/mantenimiento/planes", label: "Preventivos", icon: "CalendarClock", minRole: "manager",
            description: "Disparadores por calendario, horómetro o kilometraje." },
          { id: "repuestos", href: "/dashboard/mantenimiento/repuestos", label: "Repuestos", icon: "Bolt",
            roles: ["superadmin", "owner", "admin", "manager", "operations"],
            description: "Piezas críticas, stock mínimo y consumo por orden." },
        ],
      },
    ],
  },

  {
    id: "parque",
    slug: "parque",
    label: "Parque",
    short: "Parque",
    icon: "FerrisWheel",
    tagline: "Atracciones, aforo, accesos y seguridad del visitante.",
    href: "/dashboard/parque",
    order: 4,
    companyTypes: PARK_TYPES,
    groups: [
      {
        id: "par-operacion",
        title: "Operación",
        items: [
          { id: "control", href: "/dashboard/parque/control", label: "Centro de control", icon: "MonitorDot", primary: true,
            roles: ["superadmin", "owner", "admin", "manager", "operations"],
            description: "Estado en vivo de atracciones, aforo por zona y alertas.",
            keywords: ["tiempo real", "live", "torre de control"] },
          { id: "atracciones", href: "/dashboard/parque/atracciones", label: "Atracciones", icon: "FerrisWheel",
            roles: ["superadmin", "owner", "admin", "manager", "operations"],
            description: "Fichas con capacidad por hora, restricciones y estado.",
            keywords: ["rides", "juegos", "instalaciones"] },
          { id: "zonas", href: "/dashboard/parque/zonas", label: "Zonas", icon: "Map",
            roles: ["superadmin", "owner", "admin", "manager", "operations"],
            description: "Aforo máximo, ocupación actual y control por pulsera.",
            keywords: ["aforo", "capacidad", "ocupación", "colas"] },
          { id: "accesos", href: "/dashboard/parque/accesos", label: "Accesos", icon: "Nfc", minRole: "cashier",
            description: "Pases emitidos, entradas restantes y redenciones.",
            keywords: ["pulseras", "wristband", "entradas"] },
          { id: "bitacora", href: "/dashboard/parque/bitacora", label: "Bitácora", icon: "ClipboardList",
            roles: ["superadmin", "owner", "admin", "manager", "operations"],
            description: "Historial inmutable de paradas, aforos y downtime." },
        ],
      },
      {
        id: "par-seguridad",
        title: "Seguridad",
        items: [
          { id: "incidentes", href: "/dashboard/parque/incidentes", label: "Incidentes", icon: "TriangleAlert", badgeKey: "incidents",
            roles: ["superadmin", "owner", "admin", "manager", "operations"],
            description: "Accidentes, cuasi-accidentes y su severidad.",
            keywords: ["accidentes", "primeros auxilios", "safety"] },
          { id: "acciones", href: "/dashboard/parque/acciones", label: "Acciones", icon: "ListChecks",
            roles: ["superadmin", "owner", "admin", "manager", "operations"],
            description: "CAPA con responsable, vencimiento y verificación.",
            keywords: ["correctivas", "capa"] },
          { id: "waivers", href: "/dashboard/parque/waivers", label: "Waivers", icon: "FileCheck", minRole: "cashier",
            description: "Exoneraciones con snapshot del texto aceptado.",
            keywords: ["exoneración", "descargo", "firma"] },
          { id: "waivers-plantillas", href: "/dashboard/parque/waivers-plantillas", label: "Plantillas", icon: "FileSignature", minRole: "manager",
            description: "Textos legales versionados por producto y jurisdicción." },
          { id: "inspecciones", href: "/dashboard/parque/inspecciones", label: "Inspecciones", icon: "SearchCheck",
            roles: ["superadmin", "owner", "admin", "manager", "operations"],
            description: "Pre-apertura y controles técnicos con resultado." },
          { id: "checklists", href: "/dashboard/parque/checklists", label: "Checklists", icon: "ClipboardCheck", minRole: "manager",
            description: "Plantillas de inspección y su criterio de bloqueo." },
        ],
      },
    ],
  },

  {
    id: "comercio",
    slug: "comercio",
    label: "Comercio",
    short: "Comercio",
    icon: "Store",
    tagline: "Tienda, alimentos y bebidas: inventario perpetuo y compras.",
    href: "/dashboard/comercio",
    order: 5,
    groups: [
      {
        id: "cmr-inventario",
        title: "Inventario",
        items: [
          { id: "articulos", href: "/dashboard/comercio/articulos", label: "Artículos", icon: "Boxes", primary: true,
            roles: ["superadmin", "owner", "admin", "manager", "operations"],
            description: "Alimentos, bebidas, retail y consumibles con costo.",
            keywords: ["retail", "tienda", "gift shop", "menú", "f&b"] },
          { id: "existencias", href: "/dashboard/comercio/existencias", label: "Existencias", icon: "Layers3",
            roles: ["superadmin", "owner", "admin", "manager", "operations"],
            description: "Saldo por almacén con punto de reorden y alertas.",
            keywords: ["stock", "inventario"] },
          { id: "movimientos", href: "/dashboard/comercio/movimientos", label: "Movimientos", icon: "ArrowRightLeft",
            roles: ["superadmin", "owner", "admin", "manager", "operations"],
            description: "Kardex inmutable de entradas, salidas y ajustes.",
            keywords: ["kardex", "transferencias", "mermas"] },
          { id: "almacenes", href: "/dashboard/comercio/almacenes", label: "Almacenes", icon: "Warehouse", minRole: "manager",
            description: "Cocina, bar, tienda, taller y almacenes en tránsito." },
        ],
      },
      {
        id: "cmr-compras",
        title: "Compras",
        items: [
          { id: "compras", href: "/dashboard/comercio/compras", label: "Órdenes de compra", icon: "FileInput", minRole: "manager",
            description: "Requisición, aprobación, recepción y cuenta por pagar.",
            keywords: ["purchase order", "recepción"] },
          { id: "proveedores", href: "/dashboard/proveedores", label: "Proveedores", icon: "Truck", minRole: "manager",
            description: "Suplidores con términos, moneda y desempeño." },
        ],
      },
    ],
  },

  {
    id: "clientes",
    slug: "clientes",
    label: "Clientes",
    short: "Clientes",
    icon: "Users",
    tagline: "Quién te visita, qué membresía tiene y cómo se resuelve su caso.",
    href: "/dashboard/clientes",
    order: 6,
    groups: [
      {
        id: "cli-base",
        title: "Base de clientes",
        items: [
          { id: "directorio", href: "/dashboard/clientes/directorio", label: "Directorio", icon: "Users", primary: true,
            description: "Ficha del cliente con historial, gasto y preferencias.",
            keywords: ["clientes", "visitantes", "contactos"] },
        ],
      },
      {
        id: "cli-fidelizacion",
        title: "Fidelización",
        items: [
          { id: "membresias", href: "/dashboard/clientes/membresias", label: "Membresías", icon: "ContactRound", minRole: "cashier",
            description: "Vigencia, visitas consumidas y renovaciones.",
            keywords: ["socios", "pases", "season pass"] },
          { id: "gift-cards", href: "/dashboard/clientes/gift-cards", label: "Gift cards", icon: "Gift", minRole: "cashier",
            description: "Saldo vigente, redenciones y pasivo por vencer.",
            keywords: ["tarjetas de regalo", "saldo"] },
          { id: "vouchers", href: "/dashboard/clientes/vouchers", label: "Vouchers", icon: "QrCode", minRole: "cashier",
            description: "Comprobantes emitidos y su estado de canje.",
            keywords: ["comprobantes", "qr"] },
        ],
      },
      {
        id: "cli-experiencia",
        title: "Experiencia",
        items: [
          { id: "casos", href: "/dashboard/clientes/casos", label: "Casos", icon: "Headset",
            description: "Quejas, objetos perdidos y compensaciones con SLA.",
            keywords: ["reclamos", "quejas", "lost and found", "guest relations", "nps"] },
        ],
      },
    ],
  },

  {
    id: "finanzas",
    slug: "finanzas",
    label: "Finanzas",
    short: "Finanzas",
    icon: "Wallet",
    tagline: "Cobrar, pagar, facturar y contabilizar sin salir del sistema.",
    href: "/dashboard/finanzas",
    order: 7,
    roles: ["superadmin", "owner", "admin", "manager", "cashier"],
    groups: [
      {
        id: "fin-caja",
        title: "Caja",
        items: [
          { id: "caja", href: "/dashboard/caja", label: "Caja y turnos", icon: "Wallet", module: "cash_pos", primary: true, minRole: "cashier",
            description: "Apertura, arqueo y cierre con diferencias justificadas.",
            keywords: ["arqueo", "cierre", "turno de caja"] },
          { id: "cajas", href: "/dashboard/finanzas/cajas", label: "Cajas", icon: "Calculator", minRole: "manager",
            description: "Puntos de cobro habilitados por sucursal.",
            keywords: ["terminales", "registradoras"] },
        ],
      },
      {
        id: "fin-tesoreria",
        title: "Tesorería",
        items: [
          { id: "pagos", href: "/dashboard/pagos", label: "Pagos", icon: "CreditCard", module: "payments", minRole: "cashier",
            description: "Cobros por método, conciliación y devoluciones.",
            keywords: ["reembolsos", "refunds", "conciliación", "bancos"] },
          { id: "divisas", href: "/dashboard/finanzas/divisas", label: "Divisas", icon: "ArrowLeftRight", minRole: "manager",
            description: "Tasas por fecha usadas en la conversión a moneda base.",
            keywords: ["tipo de cambio", "monedas"] },
        ],
      },
      {
        id: "fin-cuentas",
        title: "Cuentas",
        items: [
          { id: "cobros", href: "/dashboard/cobros", label: "Por cobrar", icon: "ArrowDownToLine", module: "accounting", minRole: "manager",
            description: "Antigüedad de saldos por cliente y socio.",
            keywords: ["cxc", "cuentas por cobrar", "crédito"] },
          { id: "deudas", href: "/dashboard/deudas", label: "Por pagar", icon: "ArrowUpFromLine", module: "accounting", minRole: "manager",
            description: "Obligaciones con proveedores y vencimientos.",
            keywords: ["cxp", "cuentas por pagar"] },
          { id: "gastos", href: "/dashboard/gastos", label: "Gastos", icon: "ReceiptText", module: "accounting", minRole: "manager",
            description: "Gastos por categoría, centro de costo y método." },
        ],
      },
      {
        id: "fin-facturacion",
        title: "Facturación",
        items: [
          { id: "facturas", href: "/dashboard/finanzas/facturas", label: "Facturación", icon: "Receipt", minRole: "manager",
            description: "Comprobantes fiscales, NCF/e-CF y notas de crédito.",
            keywords: ["ncf", "e-cf", "notas de crédito", "comprobantes"] },
          { id: "fiscal", href: "/dashboard/finanzas/fiscal", label: "Fiscal", icon: "Landmark", minRole: "admin",
            description: "Impuestos por país, secuencias NCF y e-CF.",
            keywords: ["impuestos", "itbis", "dgii"] },
        ],
      },
      {
        id: "fin-contabilidad",
        title: "Contabilidad",
        items: [
          { id: "plan-cuentas", href: "/dashboard/finanzas/cuentas", label: "Plan de cuentas", icon: "Network", minRole: "admin",
            description: "Catálogo contable con submayores por naturaleza." },
          { id: "diario", href: "/dashboard/finanzas/diario", label: "Libro diario", icon: "Scale", minRole: "admin",
            description: "Asientos de partida doble generados por cada operación.",
            keywords: ["ledger", "asientos", "partida doble"] },
        ],
      },
    ],
  },

  {
    id: "equipo",
    slug: "equipo",
    label: "Equipo",
    short: "Equipo",
    icon: "UsersRound",
    tagline: "Personas: ficha, turnos, certificaciones y procedimientos.",
    href: "/dashboard/equipo",
    order: 8,
    minRole: "operations",
    groups: [
      {
        id: "eqp-personal",
        title: "Personas",
        items: [
          { id: "personal", href: "/dashboard/personal", label: "Personal", icon: "IdCard", primary: true, minRole: "manager",
            description: "Guías, choferes, cajeros y staff con su ficha completa.",
            keywords: ["empleados", "staff", "guías", "conductores", "rrhh"] },
          { id: "certificaciones", href: "/dashboard/equipo/certificaciones", label: "Certificaciones", icon: "Award", minRole: "manager",
            description: "Licencias y vencimientos que bloquean asignaciones.",
            keywords: ["licencias", "capacitación", "vencimientos"] },
        ],
      },
      {
        id: "eqp-organizacion",
        title: "Organización",
        items: [
          { id: "turnos", href: "/dashboard/equipo/turnos", label: "Turnos", icon: "BriefcaseBusiness", minRole: "manager",
            description: "Cobertura por zona y salida con costo laboral.",
            keywords: ["horarios", "shifts", "planificación"] },
          { id: "asistencia", href: "/dashboard/equipo/asistencia", label: "Asistencia", icon: "UserRoundCheck",
            roles: ["superadmin", "owner", "admin", "manager", "operations"],
            description: "Marcajes, horas trabajadas y horas extra.",
            keywords: ["marcaje", "horas", "nómina"] },
        ],
      },
      {
        id: "eqp-conocimiento",
        title: "Conocimiento",
        items: [
          { id: "documentos", href: "/dashboard/equipo/documentos", label: "Documentos", icon: "FolderOpen", minRole: "manager",
            description: "Procedimientos, políticas y permisos versionados.",
            keywords: ["sop", "manuales", "políticas"] },
          { id: "acuses", href: "/dashboard/equipo/acuses", label: "Acuses", icon: "Signature", minRole: "manager",
            description: "Quién leyó y aceptó cada versión obligatoria." },
        ],
      },
    ],
  },

  {
    id: "analitica",
    slug: "analitica",
    label: "Analítica",
    short: "Analítica",
    icon: "TrendingUp",
    tagline: "Análisis consolidado y transversal de todo el negocio.",
    href: "/dashboard/analitica",
    order: 9,
    minRole: "manager",
    groups: [
      {
        id: "ana-rentabilidad",
        title: "Rentabilidad",
        items: [
          { id: "rentabilidad", href: "/dashboard/rentabilidad", label: "Rentabilidad", icon: "TrendingUp", module: "reports", primary: true,
            description: "Margen por producto, canal y socio con costos reales.",
            keywords: ["margen", "utilidad", "profit"] },
        ],
      },
      {
        id: "ana-reportes",
        title: "Reportes",
        items: [
          { id: "reportes", href: "/dashboard/analitica/reportes", label: "Reportes", icon: "BarChart3",
            description: "Los reportes indispensables del negocio, listos para exportar.",
            keywords: ["informes", "kpi", "exportar", "bi"] },
        ],
      },
    ],
  },

  {
    id: "administracion",
    slug: "administracion",
    label: "Administración",
    short: "Admin",
    icon: "Settings",
    tagline: "Gobierno global: organización, accesos, auditoría e integraciones.",
    href: "/dashboard/administracion",
    order: 10,
    footer: true,
    minRole: "manager",
    groups: [
      {
        id: "adm-organizacion",
        title: "Organización",
        items: [
          { id: "configuracion", href: "/dashboard/configuracion", label: "Configuración", icon: "Settings", primary: true, minRole: "admin",
            description: "Empresa, monedas, módulos y parámetros globales.",
            keywords: ["ajustes", "empresa", "moneda", "idioma", "preferencias"] },
          { id: "sucursales", href: "/dashboard/administracion/sucursales", label: "Sucursales", icon: "Building2", minRole: "manager",
            description: "Sedes, puntos de venta y su responsable.",
            keywords: ["sedes", "ubicaciones", "unidades"] },
          { id: "hoteles", href: "/dashboard/administracion/hoteles", label: "Hoteles", icon: "Hotel",
            roles: ["superadmin", "owner", "admin", "manager", "operations"],
            description: "Alojamientos, zonas y puntos de recogida." },
        ],
      },
      {
        id: "adm-gobierno",
        title: "Gobierno",
        items: [
          { id: "aprobaciones", href: "/dashboard/administracion/aprobaciones", label: "Aprobaciones", icon: "UserCheck", badgeKey: "approvals",
            minRole: "manager",
            description: "Descuentos, anulaciones y ajustes que exigen autorización.",
            keywords: ["autorizaciones", "doble firma", "workflow"] },
          { id: "auditoria", href: "/dashboard/auditoria", label: "Auditoría", icon: "ShieldCheck", module: "audit", minRole: "admin",
            description: "Quién hizo qué, cuándo y desde dónde.",
            keywords: ["logs", "trazas", "seguridad", "sesiones"] },
        ],
      },
      {
        id: "adm-plataforma",
        title: "Plataforma",
        items: [
          { id: "integraciones", href: "/dashboard/administracion/integraciones", label: "Integraciones", icon: "Plug", minRole: "admin",
            description: "OTAs, pagos, mensajería, contabilidad y fisco.",
            keywords: ["api", "webhooks", "conectores", "importar", "exportar"] },
        ],
      },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Acciones rápidas — no son módulos, no ocupan sitio en el sidebar            */
/* -------------------------------------------------------------------------- */

export const QUICK_ACTIONS: NavItem[] = [
  { id: "qa-pos", href: "/dashboard/pos", label: "Nueva venta", icon: "ShoppingCart",
    description: "Abrir el punto de venta" },
  { id: "qa-reserva", href: "/dashboard/reservas", label: "Nueva reserva", icon: "CalendarCheck",
    module: "bookings", description: "Registrar una reserva" },
  { id: "qa-checkin", href: "/dashboard/checkin", label: "Check-in / escanear", icon: "ScanLine",
    module: "bookings", minRole: "cashier", description: "Validar un voucher o una pulsera" },
  { id: "qa-caja", href: "/dashboard/caja", label: "Caja y arqueo", icon: "Wallet",
    module: "cash_pos", roles: ["superadmin", "owner", "admin", "manager", "cashier"],
    description: "Abrir, arquear o cerrar la caja" },
];

/* -------------------------------------------------------------------------- */
/* Navegaciones planas (portal B2B y panel de plataforma)                      */
/* -------------------------------------------------------------------------- */

export const PORTAL_NAV: NavItem[] = [
  { id: "p-resumen", href: "/portal", label: "Resumen", icon: "LayoutDashboard", description: "Tu actividad y saldo." },
  { id: "p-catalogo", href: "/portal/catalogo", label: "Catálogo", icon: "Ticket", description: "Qué puedes vender hoy." },
  { id: "p-reservas", href: "/portal/reservas", label: "Mis reservas", icon: "CalendarCheck", description: "Reservas creadas por tu equipo." },
  { id: "p-liquidaciones", href: "/portal/liquidaciones", label: "Liquidaciones", icon: "FileSpreadsheet", description: "Cortes y pagos." },
];

export const SUPERADMIN_NAV: NavItem[] = [
  { id: "s-metricas", href: "/superadmin", label: "Métricas globales", icon: "Globe2", description: "Salud de la plataforma." },
  { id: "s-empresas", href: "/superadmin/empresas", label: "Empresas", icon: "Building2", description: "Tenants y su plan." },
  { id: "s-planes", href: "/superadmin/planes", label: "Planes", icon: "Layers", description: "Precios y límites." },
  { id: "s-auditoria", href: "/superadmin/auditoria", label: "Auditoría global", icon: "ShieldCheck", description: "Trazas entre tenants." },
];

/* -------------------------------------------------------------------------- */
/* Rutas heredadas — los hubs fusionados conservan su URL vía redirect         */
/* -------------------------------------------------------------------------- */

export const LEGACY_HUB_REDIRECTS: Record<string, string> = {
  "/dashboard/ventas": "/dashboard/comercial",
  "/dashboard/catalogo": "/dashboard/comercial",
  "/dashboard/distribucion": "/dashboard/comercial",
  "/dashboard/mantenimiento": "/dashboard/operaciones",
};

/* -------------------------------------------------------------------------- */
/* Visibilidad                                                                */
/* -------------------------------------------------------------------------- */

const ROLE_RANK: Record<string, number> = {
  superadmin: 100, owner: 90, admin: 80, manager: 60,
  operations: 40, cashier: 40, seller: 20, partner: 10,
};

export function rankOf(role?: string): number {
  return ROLE_RANK[role || ""] ?? 0;
}

interface Gated {
  minRole?: string;
  roles?: string[];
  module?: string;
  companyTypes?: string[];
}

/**
 * Una sola regla para todo: rol (ranking o lista explícita), capacidad del plan
 * y tipo de empresa. Si algo no aplica, no se dibuja — nunca se muestra una
 * opción cuyo destino responda «no tienes permisos».
 */
function passes(gate: Gated, ctx: NavContext): boolean {
  if (gate.roles && ctx.role && !gate.roles.includes(ctx.role)) return false;
  if (gate.minRole && rankOf(ctx.role) < rankOf(gate.minRole)) return false;
  if (gate.module && ctx.modules && ctx.modules.length > 0 && !ctx.modules.includes(gate.module)) return false;
  if (gate.companyTypes && ctx.companyType && !gate.companyTypes.includes(ctx.companyType)) return false;
  return true;
}

export function canSeeItem(item: NavItem, ctx: NavContext): boolean {
  return passes(item, ctx);
}

/** Grupos del workspace con solo los módulos permitidos; los vacíos desaparecen. */
export function visibleGroups(workspace: Workspace, ctx: NavContext): NavGroup[] {
  return workspace.groups
    .map((g) => ({ ...g, items: g.items.filter((i) => canSeeItem(i, ctx)) }))
    .filter((g) => g.items.length > 0);
}

export function canSeeWorkspace(workspace: Workspace, ctx: NavContext): boolean {
  if (!passes(workspace, ctx)) return false;
  return visibleGroups(workspace, ctx).length > 0;
}

/** Nivel 1 ya filtrado y ordenado. */
export function visibleWorkspaces(ctx: NavContext): Workspace[] {
  return WORKSPACES.filter((w) => canSeeWorkspace(w, ctx)).sort((a, b) => a.order - b.order);
}

export function workspaceBySlug(slug: string): Workspace | undefined {
  return WORKSPACES.find((w) => w.slug === slug);
}

export function workspaceById(id: string): Workspace | undefined {
  return WORKSPACES.find((w) => w.id === id);
}

/** Todos los módulos aplanados con su workspace y grupo — usado por ⌘K. */
export function allNavItems(): { workspace: Workspace; group: NavGroup; item: NavItem }[] {
  return WORKSPACES.flatMap((workspace) =>
    workspace.groups.flatMap((group) => group.items.map((item) => ({ workspace, group, item })))
  );
}

export function navItemById(id: string): { workspace: Workspace; group: NavGroup; item: NavItem } | undefined {
  return allNavItems().find((entry) => entry.item.id === id);
}

/**
 * Resuelve el módulo activo por coincidencia de prefijo más largo, de modo que
 * las rutas históricas (`/dashboard/pos`) sigan cayendo en su workspace.
 */
function matchPath(pathname: string) {
  let best: { workspace: Workspace; group: NavGroup; item: NavItem } | null = null;
  for (const entry of allNavItems()) {
    if (entry.item.external) continue;
    if (pathname === entry.item.href || pathname.startsWith(`${entry.item.href}/`)) {
      if (!best || entry.item.href.length > best.item.href.length) best = entry;
    }
  }
  return best;
}

export function workspaceOf(pathname: string): Workspace {
  const match = matchPath(pathname);
  if (match) return match.workspace;
  const segment = pathname.replace(/^\/dashboard\/?/, "").split("/")[0];
  return workspaceBySlug(segment) || WORKSPACES[0];
}

export function itemOf(pathname: string): NavItem | undefined {
  return matchPath(pathname)?.item;
}

export function groupOf(pathname: string): NavGroup | undefined {
  return matchPath(pathname)?.group;
}

export interface Crumb { label: string; href?: string }

/** Workspace → Grupo → Módulo. El grupo no navega: solo da contexto. */
export function breadcrumbs(pathname: string): Crumb[] {
  const workspace = workspaceOf(pathname);
  const trail: Crumb[] = [{ label: workspace.label, href: workspace.href }];
  const match = matchPath(pathname);
  if (!match) return trail;
  if (match.item.href !== workspace.href) {
    trail.push({ label: match.group.title });
    trail.push({ label: match.item.label, href: match.item.href });
  }
  return trail;
}
