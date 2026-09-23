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

export type BadgeKey = "tasks" | "approvals" | "incidents" | "notifications";

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
        title: "Vista general",
        items: [
          { id: "panel", href: "/dashboard", label: "Panel", icon: "LayoutDashboard", primary: true,
            description: "Ventas, ocupación, caja y alertas del día en tiempo real.",
            keywords: ["dashboard", "resumen", "inicio", "kpi"] },
          { id: "mi-dia", href: "/dashboard/inicio/mi-dia", label: "Mi día", icon: "Sun",
            description: "Tareas, aprobaciones y avisos que te toca resolver hoy.",
            keywords: ["hoy", "pendientes", "agenda"] },
          /**
           * El apartado de quien vende.
           *
           * Sin `minRole`: lo ve todo el personal interno, porque en una
           * operadora pequeña el gerente y el dueño TAMBIÉN venden. Lo que
           * decide si tiene algo dentro no es el rol sino la ficha vinculada
           * (`ctx.sellerId`), y quien no la tenga entra a una pantalla que se
           * lo explica en vez de a una vacía.
           */
          { id: "mi-espacio", href: "/dashboard/mi-espacio", label: "Mi espacio", icon: "UserRound",
            description: "Tus ventas, tu comisión y tu meta del mes.",
            keywords: ["vendedor", "mis ventas", "comision", "mi meta"] },
          { id: "mis-ventas", href: "/dashboard/mi-espacio/ventas", label: "Mis ventas", icon: "Receipt",
            description: "Todo lo que has vendido, con su estado de cobro.",
            keywords: ["vendedor", "ventas", "ordenes"] },
          { id: "mis-comisiones", href: "/dashboard/mi-espacio/comisiones", label: "Mis comisiones", icon: "BadgeDollarSign",
            description: "Devengada, pendiente y pagada, por fecha del servicio.",
            keywords: ["comision", "cobro", "liquidacion", "mi dinero"] },
          { id: "mi-enlace", href: "/dashboard/mi-espacio/enlace", label: "Mi enlace y mi QR", icon: "QrCode",
            description: "Tu enlace de venta, tu código QR y tu embudo.",
            keywords: ["qr", "enlace", "link", "atribucion", "embudo"] },
        ],
      },
      {
        id: "inicio-pendientes",
        title: "Pendientes",
        items: [
          { id: "tareas", href: "/dashboard/inicio/tareas", label: "Tareas", icon: "SquareCheck", badgeKey: "tasks",
            description: "Seguimientos manuales y tareas generadas por el sistema.",
            keywords: ["to do", "seguimiento"] },
          { id: "notificaciones", href: "/dashboard/inicio/notificaciones", label: "Notificaciones", icon: "Bell", badgeKey: "notifications",
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
            description: "Cupos por salida, ocupación, lista de espera y cierre de ventas.",
            keywords: ["cupos", "departures", "disponibilidad", "aforo de salida",
              "lista de espera", "waitlist", "cola", "salida llena"] },
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
          { id: "atribucion", href: "/dashboard/vendedores/atribucion", label: "Quién trajo al cliente", icon: "QrCode", minRole: "manager",
            description: "Enlaces y QR por vendedor, embudo de captación y política de atribución.",
            keywords: ["qr", "enlace", "embudo", "conserje", "taxista", "captación", "atribución"] },
          { id: "metas", href: "/dashboard/vendedores/metas", label: "Metas y premios", icon: "Target", minRole: "manager",
            description: "Lo que se pide, lo que se lleva y cuánto falta, medido de las reservas y del embudo.",
            keywords: ["objetivos", "cuotas", "progreso", "premios", "incentivos"] },
          { id: "bonos", href: "/dashboard/vendedores/bonos", label: "Bonos y premios", icon: "Gift", minRole: "manager",
            description: "Lo que se da por haber llegado, separando lo que se transfiere de lo que ya se entregó.",
            keywords: ["bonificación", "incentivo", "especie", "regalo"] },
          { id: "tipos-vendedor", href: "/dashboard/vendedores/tipos", label: "Tipos de vendedor", icon: "Tags", minRole: "manager",
            description: "Hotel, taxi, agencia… los grupos sobre los que se fijan comisiones y metas.",
            keywords: ["catálogo", "hotel", "taxi", "agencia", "clasificación"] },
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
          { id: "paquetes", href: "/dashboard/catalogo/paquetes", label: "Paquetes", icon: "Package", minRole: "manager",
            description: "Varias actividades vendidas como una, cada una con su salida y su cupo.",
            keywords: ["combo", "combos", "paquete", "multi-día", "itinerario"] },
          { id: "modalidades", href: "/dashboard/catalogo/modalidades", label: "Modalidades", icon: "Layers", minRole: "manager",
            description: "Variantes por horario, transporte o nivel de servicio.",
            keywords: ["variantes", "opciones", "adulto niño"] },
          { id: "extras", href: "/dashboard/catalogo/extras", label: "Extras", icon: "Gift", minRole: "manager",
            description: "Almuerzos, fotos y transfers que se venden con el tour.",
            keywords: ["complementos", "add-ons", "upsell", "almuerzo", "seguro"] },
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
          { id: "matriz-cupo", href: "/dashboard/distribucion/matriz", label: "Matriz de cupo", icon: "Grid3x3", minRole: "manager",
            description: "Qué le queda a cada socio, día a día.",
            keywords: ["cupo", "matriz", "disponibilidad", "socio", "agencia", "liberado"] },
          { id: "canales-ota", href: "/dashboard/distribucion/canales", label: "Canales externos", icon: "Share2", minRole: "manager",
            description: "Lo que traen las OTA conectadas por el estándar OCTO.",
            keywords: ["ota", "octo", "getyourguide", "viator", "klook", "revendedor", "conector", "canal"] },
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
            description: "Tablero del día: salidas, pax, vehículos, guías, choques de recursos y armado de rutas.",
            keywords: ["dispatch", "hoy", "operación diaria", "manifiestos", "armar rutas", "conflictos", "choques"] },
          { id: "checkin", href: "/dashboard/checkin", label: "Check-in", icon: "ScanLine", module: "bookings", minRole: "cashier",
            description: "Escanea vouchers, valida waivers y confirma asistencia.",
            keywords: ["escanear", "qr", "boarding", "abordaje", "acceso"] },
          { id: "pickups", href: "/dashboard/pickups", label: "Recogidas", icon: "MapPin", module: "pickups",
            roles: ["superadmin", "owner", "admin", "manager", "operations"],
            description: "Recogidas por hotel con su hora calculada, pax y confirmación.",
            keywords: ["recogidas", "pickups", "hoteles", "zonas", "meeting point", "margen de recogida"] },
          { id: "rutas", href: "/dashboard/operaciones/rutas", label: "Rutas", icon: "Route", module: "pickups",
            roles: ["superadmin", "owner", "admin", "manager", "operations"],
            description: "Secuencia de paradas, tiempos y capacidad por ruta.",
            keywords: ["hoja de ruta", "conductor", "paradas", "recorrido"] },
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
          { id: "recepcion", href: "/dashboard/comercio/recepcion", label: "Recibir mercancía", icon: "PackageCheck", minRole: "manager",
            description: "Lo que llega del proveedor entra al almacén, línea por línea.",
            keywords: ["recepcion", "recibir", "entrada", "mercancia", "camion"] },
          { id: "proveedores", href: "/dashboard/proveedores", label: "Proveedores", icon: "Truck", minRole: "manager",
            description: "Suplidores con términos, moneda y desempeño." },
          { id: "liquidaciones-proveedor", href: "/dashboard/proveedores/liquidaciones",
            label: "Liquidar proveedores", icon: "FileSpreadsheet", minRole: "manager",
            description: "Lo que se le debe a quien operó el servicio, conciliado con su factura.",
            keywords: ["liquidacion", "proveedor", "retencion", "isr", "itbis", "estado de cuenta", "pagar"] },
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
          { id: "opiniones", href: "/dashboard/clientes/opiniones", label: "Opiniones", icon: "MessageSquare",
            description: "Qué dice quien ya viajó: NPS por guía y por excursión, y a quién hay que llamar hoy.",
            keywords: ["nps", "encuesta", "satisfacción", "reseñas", "reputación", "valoraciones", "feedback"] },
          { id: "casos", href: "/dashboard/clientes/casos", label: "Casos", icon: "Headset",
            description: "Quejas, objetos perdidos y compensaciones con SLA.",
            keywords: ["reclamos", "quejas", "lost and found", "guest relations"] },
          { id: "comunicaciones", href: "/dashboard/clientes/comunicaciones", label: "Comunicaciones", icon: "Mail",
            description: "Todo lo que se le ha escrito al cliente, con su estado de entrega.",
            keywords: ["correos", "mensajes", "whatsapp", "avisos", "recordatorios", "bandeja de salida"] },
          { id: "plantillas-mensajes", href: "/dashboard/clientes/comunicaciones/plantillas", label: "Plantillas", icon: "FileText",
            minRole: "manager",
            description: "El texto de cada aviso, con la voz de la empresa y por idioma.",
            keywords: ["plantillas", "textos", "mensajes", "templates"] },
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
          { id: "vencimientos", href: "/dashboard/finanzas/vencimientos", label: "Vencimientos", icon: "CalendarClock", minRole: "seller",
            description: "Anticipos y saldos que vencen, con lo que ya venció primero.",
            keywords: ["anticipo", "saldo", "cuotas", "vencimiento", "cobrar", "deposito"] },
          { id: "cobros", href: "/dashboard/cobros", label: "Por cobrar", icon: "ArrowDownToLine", module: "accounting", minRole: "manager",
            description: "Antigüedad de saldos por cliente y socio.",
            keywords: ["cxc", "cuentas por cobrar", "crédito"] },
          { id: "deudas", href: "/dashboard/deudas", label: "Por pagar", icon: "ArrowUpFromLine", module: "accounting", minRole: "manager",
            description: "Obligaciones con proveedores y vencimientos.",
            keywords: ["cxp", "cuentas por pagar"] },
          { id: "gastos", href: "/dashboard/gastos", label: "Gastos", icon: "ReceiptText", module: "accounting", minRole: "manager",
            description: "Gastos por categoría, centro de costo y método." },
          { id: "categorias-gasto", href: "/dashboard/gastos/categorias", label: "Categorías de gasto", icon: "FolderTree", module: "accounting", minRole: "manager",
            description: "Clasificación de los gastos operativos.",
            keywords: ["categoria", "gasto", "clasificacion"] },
        ],
      },
      {
        id: "fin-facturacion",
        title: "Comprobantes",
        items: [
          { id: "facturas", href: "/dashboard/finanzas/facturas", label: "Facturación", icon: "Receipt", minRole: "manager",
            description: "Comprobantes fiscales, NCF/e-CF y notas de crédito.",
            keywords: ["ncf", "e-cf", "notas de crédito", "comprobantes"] },
          { id: "fiscal", href: "/dashboard/finanzas/fiscal", label: "Fiscal", icon: "Landmark", minRole: "admin",
            description: "Impuestos por país, tasas y comprobante electrónico.",
            keywords: ["impuestos", "itbis", "dgii"] },
          // Lo que el contador necesita cada mes. Con `module: accounting`
          // porque es la profundidad fiscal del plan, y con rango de gerencia:
          // son los números fiscales de la empresa.
          { id: "declaraciones", href: "/dashboard/finanzas/declaraciones", label: "Declaraciones DGII",
            icon: "Landmark", module: "accounting", minRole: "manager",
            description: "Compras, ventas y anulaciones del mes en el formato de la DGII.",
            keywords: ["606", "607", "608", "dgii", "itbis", "impuestos", "declaración", "fiscal", "anulaciones"] },
          { id: "secuencias", href: "/dashboard/finanzas/secuencias", label: "Secuencias NCF", icon: "ListChecks", minRole: "admin",
            description: "Rangos autorizados por la DGII y lo que queda de cada uno.",
            keywords: ["ncf", "e-cf", "numeración", "dgii", "comprobantes"] },
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
          { id: "estados", href: "/dashboard/finanzas/estados", label: "Estados financieros",
            icon: "ChartColumn", module: "accounting", minRole: "manager",
            description: "Resultados, balance general y cierre de periodo.",
            keywords: ["estado de resultados", "balance general", "cierre", "periodo", "ejercicio", "contador"] },
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
            keywords: ["marcaje", "horas", "fichar", "reloj"] },
          { id: "nomina", href: "/dashboard/equipo/nomina", label: "Nómina", icon: "Receipt", minRole: "admin",
            description: "De las horas aprobadas al neto, con TSS e ISR.",
            keywords: ["nómina", "payroll", "sueldos", "tss", "afp", "isr", "quincena"] },
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
        title: "Resultados",
        items: [
          { id: "rentabilidad", href: "/dashboard/rentabilidad", label: "Rentabilidad", icon: "TrendingUp", module: "reports", primary: true,
            description: "Margen por producto, canal y socio con costos reales.",
            keywords: ["margen", "utilidad", "profit"] },
        ],
      },
      {
        id: "ana-clientes",
        title: "Clientes y demanda",
        items: [
          { id: "cohortes", href: "/dashboard/analitica/cohortes", label: "Cohortes", icon: "Repeat", minRole: "manager",
            description: "Si el cliente que vino en enero volvió en marzo.",
            keywords: ["retención", "recompra", "fidelidad", "cohorte", "ltv"] },
          { id: "ocupacion", href: "/dashboard/analitica/ocupacion", label: "Previsión de ocupación", icon: "TrendingUp", minRole: "manager",
            description: "Qué salidas van camino de vacía o de llenarse, con tiempo para decidir.",
            keywords: ["previsión", "forecast", "ocupación", "pickup", "anticipación", "alertas"] },
        ],
      },
      {
        id: "ana-reportes",
        title: "Informes",
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
          // Sin `module`: la pantalla que explica el plan no puede depender del
          // plan. Cuando un límite bloquea una venta, esto es donde se entiende
          // por qué —y esconderlo justo entonces sería el peor momento posible.
          // Sin `module` y con rango bajo: importar es lo PRIMERO que hace una
          // empresa nueva, y esconderlo detrás de un plan o de un rol alto
          // convierte la migración de sus datos en un trámite con el dueño.
          { id: "importar", href: "/dashboard/administracion/importar", label: "Importar datos", icon: "Upload", minRole: "seller",
            description: "Trae clientes, productos y proveedores desde una hoja de cálculo.",
            keywords: ["importar", "csv", "excel", "migrar", "cargar", "subir datos"] },
          // Sin `module` y sin depender de la suscripción: llevarse los datos
          // propios es lo único que NUNCA se condiciona al plan. Va junto a
          // Importar porque son la entrada y la salida de la misma puerta.
          { id: "exportar", href: "/dashboard/administracion/exportar", label: "Llévate tus datos", icon: "Download", minRole: "admin",
            description: "Descarga toda la empresa: un CSV por tabla, en un solo archivo.",
            keywords: ["exportar", "descargar", "respaldo", "backup", "portabilidad", "csv", "zip", "mis datos"] },
          { id: "plan", href: "/dashboard/administracion/plan", label: "Tu plan y uso", icon: "Gauge", minRole: "admin",
            description: "Estado de la suscripción, límites consumidos y módulos incluidos.",
            keywords: ["plan", "suscripción", "límites", "uso", "facturación", "prueba"] },
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
  { id: "p-reservar", href: "/portal/reservar", label: "Reservar", icon: "CalendarPlus", description: "Vender con tu neto y tu crédito." },
  { id: "p-reservar", href: "/portal/reservar", label: "Reservar", icon: "CalendarPlus", description: "Vender con tu neto y tu crédito." },
  { id: "p-reservas", href: "/portal/reservas", label: "Mis reservas", icon: "CalendarCheck", description: "Reservas creadas por tu equipo." },
  { id: "p-liquidaciones", href: "/portal/liquidaciones", label: "Liquidaciones", icon: "FileSpreadsheet", description: "Cortes y pagos." },
  { id: "p-vendedores", href: "/portal/vendedores", label: "Mi equipo de ventas", icon: "BadgeDollarSign", description: "Quién vendió qué, y cuánto lleva generado." },
  { id: "p-equipo", href: "/portal/equipo", label: "Accesos", icon: "Users", description: "Quién de tu empresa tiene acceso." },
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

/** Ruta heredada → slug del workspace que la absorbió. */
export const LEGACY_HUB_REDIRECTS: Record<string, string> = {
  "/dashboard/ventas": "comercial",
  "/dashboard/catalogo": "comercial",
  "/dashboard/distribucion": "comercial",
  "/dashboard/mantenimiento": "operaciones",
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

/**
 * Módulo al que se entra al pulsar un workspace.
 *
 * Un workspace no es una pantalla: es un contenedor. Al elegirlo se abre
 * directamente su módulo principal y el nivel 2 pasa a mostrar el resto del
 * árbol, en vez de intercalar una página de tarjetas que obliga a un clic más
 * para llegar al trabajo real.
 *
 * Se respeta la visibilidad del usuario: si el módulo destacado no le
 * corresponde, entra al primero que sí puede ver.
 */
export function workspaceLanding(workspace: Workspace, ctx: NavContext): string {
  const items = visibleGroups(workspace, ctx)
    .flatMap((g) => g.items)
    .filter((i) => !i.external);
  return items.find((i) => i.primary)?.href || items[0]?.href || workspace.href;
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
