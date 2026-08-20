/**
 * Navigation architecture: 13 domains, each one a self-contained subsystem.
 *
 * The sidebar never grows past the 13 domain entries. Entering a domain opens
 * its own module tree (sections + modules), so the experience is "a system
 * inside the system" rather than one endless flat list.
 *
 * Client-safe: no server imports.
 *
 *   /dashboard                     → executive panel (domain `inicio`)
 *   /dashboard/<domain>            → domain hub (module directory + live KPIs)
 *   /dashboard/<domain>/<module>   → module screen
 *
 * Some flagship modules kept their historical top-level route (`/dashboard/pos`,
 * `/dashboard/reservas`, …) because they are deep-linked from the landing page,
 * emails and printed vouchers. `domainOf()` resolves the owning domain by
 * longest-href match, so those routes still render inside their domain shell.
 */

export interface ModuleNode {
  /** Absolute route. */
  href: string;
  label: string;
  icon: string;
  /** One-line explanation shown on the domain hub card. */
  description: string;
  /** Restrict to these roles. */
  roles?: string[];
  /** Hidden when the tenant plan has this module disabled. */
  module?: string;
  badge?: string;
  /** Only shown for these company types (park / tour operator / tour center …). */
  companyTypes?: string[];
  /** Highlighted on the hub as the domain's primary entry point. */
  primary?: boolean;
}

export interface DomainSection {
  title: string;
  items: ModuleNode[];
}

export interface Domain {
  /** URL segment; `inicio` maps to `/dashboard`. */
  slug: string;
  label: string;
  /** Short label for the collapsed rail. */
  short: string;
  icon: string;
  tagline: string;
  href: string;
  roles?: string[];
  sections: DomainSection[];
}

export const DOMAINS: Domain[] = [
  {
    slug: "inicio",
    label: "Inicio",
    short: "Inicio",
    icon: "LayoutDashboard",
    tagline: "Tu día, tus pendientes y el pulso del negocio en una sola pantalla.",
    href: "/dashboard",
    sections: [
      {
        title: "Panel",
        items: [
          { href: "/dashboard", label: "Panel ejecutivo", icon: "LayoutDashboard", primary: true,
            description: "Ventas, ocupación, caja y alertas del día en tiempo real." },
          { href: "/dashboard/inicio/mi-dia", label: "Mi día", icon: "Sun",
            description: "Tareas, aprobaciones y avisos que te toca resolver hoy." },
        ],
      },
      {
        title: "Pendientes",
        items: [
          { href: "/dashboard/inicio/tareas", label: "Tareas", icon: "SquareCheck",
            description: "Seguimientos manuales y tareas generadas por el sistema." },
          { href: "/dashboard/inicio/notificaciones", label: "Notificaciones", icon: "Bell",
            description: "Avisos operativos, comerciales y financieros." },
        ],
      },
    ],
  },
  {
    slug: "ventas",
    label: "Ventas",
    short: "Ventas",
    icon: "ShoppingCart",
    tagline: "Del primer contacto al ticket emitido: mostrador, reservas y pipeline.",
    href: "/dashboard/ventas",
    sections: [
      {
        title: "Mostrador",
        items: [
          { href: "/dashboard/pos", label: "Punto de venta", icon: "ShoppingCart", badge: "POS", primary: true,
            description: "Venta rápida con disponibilidad, precios y cobro en un paso." },
          { href: "/dashboard/checkin", label: "Check-in", icon: "ScanLine", module: "bookings",
            description: "Escanea vouchers, valida waivers y confirma asistencia." },
          { href: "/dashboard/ventas/tickets", label: "Tickets de acceso", icon: "Ticket",
            description: "Entradas, pulseras y pases emitidos con sus redenciones." },
        ],
      },
      {
        title: "Reservas",
        items: [
          { href: "/dashboard/reservas", label: "Reservas", icon: "CalendarCheck", module: "bookings",
            description: "Todas las reservas con su estado, pago y participantes." },
          { href: "/dashboard/salidas", label: "Salidas y cupos", icon: "CalendarRange", module: "bookings",
            description: "Cupos por salida, ocupación y cierre de ventas." },
        ],
      },
      {
        title: "Pipeline comercial",
        items: [
          { href: "/dashboard/ventas/cotizaciones", label: "Cotizaciones", icon: "FileText",
            description: "Grupos, corporativos y eventos con margen calculado." },
          { href: "/dashboard/crm", label: "CRM y leads", icon: "Sparkles", module: "crm",
            description: "Oportunidades, actividades y seguimiento de contactos." },
          { href: "/dashboard/vendedores", label: "Vendedores", icon: "UserRound",
            description: "Equipo comercial, metas, límites de descuento y desempeño." },
        ],
      },
      {
        title: "Estímulo de demanda",
        items: [
          { href: "/dashboard/promociones", label: "Promociones", icon: "BadgePercent",
            description: "Descuentos, paquetes y campañas con reglas de vigencia." },
        ],
      },
    ],
  },
  {
    slug: "catalogo",
    label: "Catálogo",
    short: "Catálogo",
    icon: "Package",
    tagline: "Qué vendes, en qué modalidad, a qué precio y con qué costo.",
    href: "/dashboard/catalogo",
    sections: [
      {
        title: "Oferta",
        items: [
          { href: "/dashboard/productos", label: "Productos y excursiones", icon: "Ticket", primary: true,
            description: "Catálogo completo con duración, aforo y requisitos." },
          { href: "/dashboard/catalogo/modalidades", label: "Modalidades", icon: "Layers",
            description: "Variantes por horario, transporte o nivel de servicio." },
          { href: "/dashboard/catalogo/categorias", label: "Categorías", icon: "FolderTree",
            description: "Agrupación del catálogo para reportes y portal B2B." },
        ],
      },
      {
        title: "Precios y costos",
        items: [
          { href: "/dashboard/catalogo/precios", label: "Reglas de precio", icon: "Tags",
            description: "Tarifas por canal, temporada, pax y antelación." },
          { href: "/dashboard/catalogo/costos", label: "Costos por producto", icon: "Calculator",
            description: "Costos fijos y variables que alimentan el margen real." },
          { href: "/dashboard/catalogo/politicas", label: "Políticas de cancelación", icon: "FileWarning",
            description: "Plazos y penalidades aplicadas en cada cancelación." },
        ],
      },
      {
        title: "Membresías",
        items: [
          { href: "/dashboard/catalogo/membresias", label: "Planes de membresía", icon: "IdCard",
            description: "Pases anuales y de temporada con beneficios y visitas." },
        ],
      },
    ],
  },
  {
    slug: "distribucion",
    label: "Distribución",
    short: "Distrib.",
    icon: "Handshake",
    tagline: "Tour centers, agencias y OTAs: cupos, comisiones y liquidaciones.",
    href: "/dashboard/distribucion",
    sections: [
      {
        title: "Red de ventas",
        items: [
          { href: "/dashboard/partners", label: "Tour centers y agencias", icon: "Handshake", primary: true,
            description: "Socios comerciales, contratos, crédito y productos autorizados." },
          { href: "/portal", label: "Portal B2B", icon: "ExternalLink",
            description: "La vista que ven tus socios para reservar y liquidar." },
        ],
      },
      {
        title: "Cupos",
        items: [
          { href: "/dashboard/distribucion/allotments", label: "Allotments", icon: "TableProperties",
            description: "Cupos garantizados, free sale y liberación automática." },
        ],
      },
      {
        title: "Comisiones",
        items: [
          { href: "/dashboard/distribucion/reglas", label: "Reglas de comisión", icon: "Sliders",
            description: "Precedencia por socio, producto, canal y vigencia." },
          { href: "/dashboard/comisiones", label: "Comisiones devengadas", icon: "Percent", module: "commissions",
            description: "Comisiones calculadas con su snapshot inmutable." },
          { href: "/dashboard/liquidaciones", label: "Liquidaciones", icon: "FileSpreadsheet", module: "settlements",
            description: "Cortes por periodo, aprobación y pago a la red." },
        ],
      },
    ],
  },
  {
    slug: "operaciones",
    label: "Operaciones",
    short: "Oper.",
    icon: "Radar",
    tagline: "El día de operación: despacho, recogidas, transporte y recursos.",
    href: "/dashboard/operaciones",
    sections: [
      {
        title: "Día de operación",
        items: [
          { href: "/dashboard/operaciones/despacho", label: "Despacho diario", icon: "Radar", module: "operations", primary: true,
            description: "Tablero del día: salidas, pax, vehículos, guías y bloqueos." },
          { href: "/dashboard/pickups", label: "Pickups y hoteles", icon: "MapPin", module: "pickups",
            description: "Recogidas por hotel con hora, pax y confirmación." },
          { href: "/dashboard/operaciones/rutas", label: "Rutas de pickup", icon: "Route", module: "pickups",
            description: "Secuencia de paradas, tiempos y capacidad por ruta." },
        ],
      },
      {
        title: "Recursos",
        items: [
          { href: "/dashboard/transporte", label: "Transporte", icon: "Bus", module: "transport",
            description: "Flota, capacidad, documentos y disponibilidad." },
          { href: "/dashboard/operaciones/recursos", label: "Asignación de recursos", icon: "Boxes",
            description: "Vehículos y personal asignados a cada salida." },
        ],
      },
      {
        title: "Personal en campo",
        items: [
          { href: "/dashboard/personal", label: "Guías y personal", icon: "IdCard",
            description: "Guías, choferes y staff con idiomas y certificaciones." },
        ],
      },
    ],
  },
  {
    slug: "parque",
    label: "Parque",
    short: "Parque",
    icon: "FerrisWheel",
    tagline: "Atracciones, aforo, accesos y seguridad del visitante.",
    href: "/dashboard/parque",
    sections: [
      {
        title: "Centro de control",
        items: [
          { href: "/dashboard/parque/control", label: "Centro de control", icon: "MonitorDot", primary: true,
            description: "Estado en vivo de atracciones, aforo por zona y alertas." },
          { href: "/dashboard/parque/atracciones", label: "Atracciones", icon: "FerrisWheel",
            description: "Fichas con capacidad por hora, restricciones y estado." },
          { href: "/dashboard/parque/bitacora", label: "Bitácora", icon: "ClipboardList",
            description: "Historial inmutable de paradas, aforos y downtime." },
        ],
      },
      {
        title: "Aforo y accesos",
        items: [
          { href: "/dashboard/parque/zonas", label: "Zonas y aforo", icon: "Map",
            description: "Aforo máximo, ocupación actual y control por pulsera." },
          { href: "/dashboard/parque/accesos", label: "Accesos y pulseras", icon: "Nfc",
            description: "Pases emitidos, entradas restantes y redenciones." },
        ],
      },
      {
        title: "Seguridad",
        items: [
          { href: "/dashboard/parque/incidentes", label: "Incidentes", icon: "TriangleAlert",
            description: "Accidentes, cuasi-accidentes y su severidad." },
          { href: "/dashboard/parque/acciones", label: "Acciones correctivas", icon: "ListChecks",
            description: "CAPA con responsable, vencimiento y verificación." },
          { href: "/dashboard/parque/waivers", label: "Waivers firmados", icon: "FileCheck",
            description: "Exoneraciones con snapshot del texto aceptado." },
          { href: "/dashboard/parque/waivers-plantillas", label: "Plantillas de waiver", icon: "FileSignature",
            roles: ["owner", "admin", "manager", "superadmin"],
            description: "Textos legales versionados por producto y jurisdicción." },
          { href: "/dashboard/parque/inspecciones", label: "Inspecciones", icon: "SearchCheck",
            description: "Pre-apertura y controles técnicos con resultado." },
          { href: "/dashboard/parque/checklists", label: "Checklists", icon: "ClipboardCheck",
            roles: ["owner", "admin", "manager", "superadmin"],
            description: "Plantillas de inspección y su criterio de bloqueo." },
        ],
      },
    ],
  },
  {
    slug: "mantenimiento",
    label: "Mantenimiento",
    short: "Mant.",
    icon: "Wrench",
    tagline: "Activos, órdenes de trabajo y preventivos. Activo caído, cupo caído.",
    href: "/dashboard/mantenimiento",
    sections: [
      {
        title: "Activos",
        items: [
          { href: "/dashboard/mantenimiento/activos", label: "Activos", icon: "Cog", primary: true,
            description: "Atracciones, vehículos y equipos con estado y medidores." },
          { href: "/dashboard/mantenimiento/fuera-de-servicio", label: "Fuera de servicio", icon: "OctagonX",
            description: "Impacto en cupos y reservas afectadas por activo caído." },
        ],
      },
      {
        title: "Trabajo",
        items: [
          { href: "/dashboard/mantenimiento/ordenes", label: "Órdenes de trabajo", icon: "Wrench",
            description: "Correctivo, preventivo y emergencias con costo y downtime." },
          { href: "/dashboard/mantenimiento/planes", label: "Planes preventivos", icon: "CalendarClock",
            description: "Disparadores por calendario, horómetro o kilometraje." },
        ],
      },
      {
        title: "Repuestos",
        items: [
          { href: "/dashboard/mantenimiento/repuestos", label: "Repuestos", icon: "Bolt",
            description: "Piezas críticas, stock mínimo y consumo por orden." },
        ],
      },
    ],
  },
  {
    slug: "comercio",
    label: "Comercio",
    short: "Comercio",
    icon: "Store",
    tagline: "Tienda, alimentos y bebidas: inventario perpetuo y compras.",
    href: "/dashboard/comercio",
    sections: [
      {
        title: "Inventario",
        items: [
          { href: "/dashboard/comercio/articulos", label: "Artículos", icon: "Boxes", primary: true,
            description: "Alimentos, bebidas, retail y consumibles con costo." },
          { href: "/dashboard/comercio/existencias", label: "Existencias", icon: "Layers3",
            description: "Saldo por almacén con punto de reorden y alertas." },
          { href: "/dashboard/comercio/movimientos", label: "Movimientos", icon: "ArrowRightLeft",
            description: "Kardex inmutable de entradas, salidas y ajustes." },
          { href: "/dashboard/comercio/almacenes", label: "Almacenes", icon: "Warehouse",
            description: "Cocina, bar, tienda, taller y almacenes en tránsito." },
        ],
      },
      {
        title: "Compras",
        items: [
          { href: "/dashboard/comercio/compras", label: "Órdenes de compra", icon: "FileInput",
            description: "Requisición, aprobación, recepción y cuenta por pagar." },
          { href: "/dashboard/proveedores", label: "Proveedores", icon: "Truck",
            description: "Suplidores con términos, moneda y desempeño." },
        ],
      },
    ],
  },
  {
    slug: "clientes",
    label: "Clientes",
    short: "Clientes",
    icon: "Users",
    tagline: "Quién te visita, qué membresía tiene y cómo resolver su caso.",
    href: "/dashboard/clientes",
    sections: [
      {
        title: "Base de clientes",
        items: [
          { href: "/dashboard/clientes/directorio", label: "Directorio", icon: "Users", primary: true,
            description: "Ficha del cliente con historial, gasto y preferencias." },
          { href: "/dashboard/clientes/membresias", label: "Membresías activas", icon: "ContactRound",
            description: "Vigencia, visitas consumidas y renovaciones." },
        ],
      },
      {
        title: "Experiencia",
        items: [
          { href: "/dashboard/clientes/casos", label: "Casos y reclamos", icon: "Headset",
            description: "Quejas, objetos perdidos y compensaciones con SLA." },
        ],
      },
      {
        title: "Fidelización",
        items: [
          { href: "/dashboard/clientes/gift-cards", label: "Gift cards", icon: "Gift",
            description: "Saldo vigente, redenciones y pasivo por vencer." },
          { href: "/dashboard/clientes/vouchers", label: "Vouchers", icon: "QrCode",
            description: "Comprobantes emitidos y su estado de canje." },
        ],
      },
    ],
  },
  {
    slug: "equipo",
    label: "Equipo",
    short: "Equipo",
    icon: "UsersRound",
    tagline: "Personal, turnos, asistencia, certificaciones y procedimientos.",
    href: "/dashboard/equipo",
    sections: [
      {
        title: "Personal",
        items: [
          { href: "/dashboard/personal", label: "Personal", icon: "IdCard", primary: true,
            description: "Guías, choferes, cajeros y staff con su ficha completa." },
          { href: "/dashboard/equipo/certificaciones", label: "Certificaciones", icon: "Award",
            description: "Licencias y vencimientos que bloquean asignaciones." },
        ],
      },
      {
        title: "Planificación",
        items: [
          { href: "/dashboard/equipo/turnos", label: "Turnos", icon: "BriefcaseBusiness",
            description: "Cobertura por zona y salida con costo laboral." },
          { href: "/dashboard/equipo/asistencia", label: "Asistencia", icon: "UserRoundCheck",
            description: "Marcajes, horas trabajadas y horas extra." },
        ],
      },
      {
        title: "Conocimiento",
        items: [
          { href: "/dashboard/equipo/documentos", label: "Documentos y SOP", icon: "FolderOpen",
            description: "Procedimientos, políticas y permisos versionados." },
          { href: "/dashboard/equipo/acuses", label: "Acuses de lectura", icon: "Signature",
            description: "Quién leyó y aceptó cada versión obligatoria." },
        ],
      },
    ],
  },
  {
    slug: "finanzas",
    label: "Finanzas",
    short: "Finanzas",
    icon: "Wallet",
    tagline: "Caja, cobros, pagos, facturación fiscal y contabilidad.",
    href: "/dashboard/finanzas",
    roles: ["owner", "admin", "manager", "cashier", "superadmin"],
    sections: [
      {
        title: "Tesorería",
        items: [
          { href: "/dashboard/caja", label: "Caja y turnos", icon: "Wallet", module: "cash_pos", primary: true,
            description: "Apertura, arqueo y cierre con diferencias justificadas." },
          { href: "/dashboard/pagos", label: "Pagos y reembolsos", icon: "CreditCard", module: "payments",
            description: "Cobros por método, conciliación y devoluciones." },
          { href: "/dashboard/finanzas/cajas", label: "Cajas registradoras", icon: "Calculator",
            description: "Puntos de cobro habilitados por sucursal." },
        ],
      },
      {
        title: "Ciclo comercial",
        items: [
          { href: "/dashboard/cobros", label: "Cuentas por cobrar", icon: "ArrowDownToLine", module: "accounting",
            description: "Antigüedad de saldos por cliente y socio." },
          { href: "/dashboard/finanzas/facturas", label: "Facturación", icon: "Receipt",
            description: "Comprobantes fiscales, NCF/e-CF y notas de crédito." },
          { href: "/dashboard/deudas", label: "Cuentas por pagar", icon: "ArrowUpFromLine", module: "accounting",
            description: "Obligaciones con proveedores y vencimientos." },
          { href: "/dashboard/gastos", label: "Gastos", icon: "ReceiptText", module: "accounting",
            description: "Gastos por categoría, centro de costo y método." },
        ],
      },
      {
        title: "Contabilidad",
        items: [
          { href: "/dashboard/finanzas/cuentas", label: "Plan de cuentas", icon: "Network",
            roles: ["owner", "admin", "superadmin"],
            description: "Catálogo contable con submayores por naturaleza." },
          { href: "/dashboard/finanzas/diario", label: "Libro diario", icon: "Scale",
            roles: ["owner", "admin", "superadmin"],
            description: "Asientos de partida doble generados por cada operación." },
          { href: "/dashboard/finanzas/fiscal", label: "Perfiles fiscales", icon: "Landmark",
            roles: ["owner", "admin", "superadmin"],
            description: "Impuestos por país, secuencias NCF y e-CF." },
          { href: "/dashboard/finanzas/divisas", label: "Tipos de cambio", icon: "ArrowLeftRight",
            description: "Tasas por fecha usadas en la conversión a moneda base." },
        ],
      },
    ],
  },
  {
    slug: "analitica",
    label: "Analítica",
    short: "Analítica",
    icon: "TrendingUp",
    tagline: "Rentabilidad real por producto, canal y socio, con reportes listos.",
    href: "/dashboard/analitica",
    roles: ["owner", "admin", "manager", "superadmin"],
    sections: [
      {
        title: "Rentabilidad",
        items: [
          { href: "/dashboard/rentabilidad", label: "Rentabilidad", icon: "TrendingUp", module: "reports", primary: true,
            description: "Margen por producto, canal y socio con costos reales." },
        ],
      },
      {
        title: "Reportes",
        items: [
          { href: "/dashboard/analitica/reportes", label: "Reportes operativos", icon: "BarChart3",
            description: "Los reportes indispensables del negocio, listos para exportar." },
        ],
      },
    ],
  },
  {
    slug: "administracion",
    label: "Administración",
    short: "Admin",
    icon: "Settings",
    tagline: "Configuración, gobierno, aprobaciones e integraciones.",
    href: "/dashboard/administracion",
    roles: ["owner", "admin", "manager", "superadmin"],
    sections: [
      {
        title: "Configuración",
        items: [
          { href: "/dashboard/configuracion", label: "Configuración", icon: "Settings", primary: true,
            roles: ["owner", "admin", "superadmin"],
            description: "Empresa, monedas, módulos y parámetros operativos." },
          { href: "/dashboard/administracion/sucursales", label: "Sucursales", icon: "Building2",
            description: "Sedes, puntos de venta y su responsable." },
          { href: "/dashboard/administracion/hoteles", label: "Hoteles y puntos", icon: "Hotel",
            description: "Alojamientos, zonas y puntos de recogida." },
        ],
      },
      {
        title: "Gobierno",
        items: [
          { href: "/dashboard/administracion/aprobaciones", label: "Aprobaciones", icon: "UserCheck",
            description: "Descuentos, anulaciones y ajustes que exigen autorización." },
          { href: "/dashboard/auditoria", label: "Auditoría", icon: "ShieldCheck", module: "audit",
            roles: ["owner", "admin", "superadmin"],
            description: "Quién hizo qué, cuándo y desde dónde." },
        ],
      },
      {
        title: "Plataforma",
        items: [
          { href: "/dashboard/administracion/integraciones", label: "Integraciones", icon: "Plug",
            roles: ["owner", "admin", "superadmin"],
            description: "OTAs, pagos, mensajería, contabilidad y fisco." },
        ],
      },
    ],
  },
];

export const PORTAL_NAV: ModuleNode[] = [
  { href: "/portal", label: "Resumen", icon: "LayoutDashboard", description: "Tu actividad y saldo." },
  { href: "/portal/catalogo", label: "Catálogo y disponibilidad", icon: "Ticket", description: "Qué puedes vender hoy." },
  { href: "/portal/reservas", label: "Mis reservas", icon: "CalendarCheck", description: "Reservas creadas por tu equipo." },
  { href: "/portal/liquidaciones", label: "Comisiones y estados", icon: "FileSpreadsheet", description: "Cortes y pagos." },
];

export const SUPERADMIN_NAV: ModuleNode[] = [
  { href: "/superadmin", label: "Métricas globales", icon: "Globe2", description: "Salud de la plataforma." },
  { href: "/superadmin/empresas", label: "Empresas", icon: "Building2", description: "Tenants y su plan." },
  { href: "/superadmin/planes", label: "Planes y suscripciones", icon: "Layers", description: "Precios y límites." },
  { href: "/superadmin/auditoria", label: "Auditoría global", icon: "ShieldCheck", description: "Trazas entre tenants." },
];

const ROLE_RANK: Record<string, number> = {
  superadmin: 100, owner: 90, admin: 80, manager: 60,
  operations: 40, cashier: 40, seller: 20, partner: 10,
};

export function rankOf(role?: string): number {
  return ROLE_RANK[role || ""] ?? 0;
}

/**
 * Routes a seller may reach. Sellers are the most restricted internal role:
 * they get the commercial surface and nothing else.
 */
const SELLER_ROUTES = [
  "/dashboard",
  "/dashboard/inicio",
  "/dashboard/ventas",
  "/dashboard/pos",
  "/dashboard/checkin",
  "/dashboard/reservas",
  "/dashboard/salidas",
  "/dashboard/productos",
  "/dashboard/catalogo",
  "/dashboard/crm",
  "/dashboard/clientes",
  "/dashboard/comisiones",
];

function sellerAllows(href: string): boolean {
  return SELLER_ROUTES.some((r) => href === r || href.startsWith(`${r}/`));
}

export function canSeeModule(item: ModuleNode, role?: string, modules?: string[] | null, companyType?: string): boolean {
  if (item.roles && role && !item.roles.includes(role)) return false;
  if (item.module && modules && modules.length > 0 && !modules.includes(item.module)) return false;
  if (item.companyTypes && companyType && !item.companyTypes.includes(companyType)) return false;
  if (role === "seller" && !sellerAllows(item.href)) return false;
  return true;
}

export function canSeeDomain(domain: Domain, role?: string, modules?: string[] | null, companyType?: string): boolean {
  if (domain.roles && role && !domain.roles.includes(role)) return false;
  return visibleSections(domain, role, modules, companyType).length > 0;
}

export function visibleSections(
  domain: Domain, role?: string, modules?: string[] | null, companyType?: string
): DomainSection[] {
  return domain.sections
    .map((s) => ({ ...s, items: s.items.filter((i) => canSeeModule(i, role, modules, companyType)) }))
    .filter((s) => s.items.length > 0);
}

export function visibleDomains(role?: string, modules?: string[] | null, companyType?: string): Domain[] {
  return DOMAINS.filter((d) => canSeeDomain(d, role, modules, companyType));
}

export function domainBySlug(slug: string): Domain | undefined {
  return DOMAINS.find((d) => d.slug === slug);
}

/** Every module across every domain, flattened — used by the command palette. */
export function allModules(): { domain: Domain; item: ModuleNode }[] {
  return DOMAINS.flatMap((domain) => domain.sections.flatMap((s) => s.items.map((item) => ({ domain, item }))));
}

/**
 * Resolves which domain owns a pathname. Matches the longest module href first
 * so historical top-level routes (`/dashboard/pos`) land in the right domain,
 * then falls back to the `/dashboard/<slug>` prefix, then to `inicio`.
 */
export function domainOf(pathname: string): Domain {
  let best: { domain: Domain; length: number } | null = null;
  for (const { domain, item } of allModules()) {
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      if (!best || item.href.length > best.length) best = { domain, length: item.href.length };
    }
  }
  if (best) return best.domain;

  const segment = pathname.replace(/^\/dashboard\/?/, "").split("/")[0];
  return domainBySlug(segment) || DOMAINS[0];
}

/** The active module inside a domain, if any (longest href match). */
export function moduleOf(pathname: string): ModuleNode | undefined {
  let best: ModuleNode | undefined;
  for (const { item } of allModules()) {
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      if (!best || item.href.length > best.href.length) best = item;
    }
  }
  return best;
}

export interface Crumb { label: string; href: string }

/** Breadcrumb trail: Domain → Module. */
export function breadcrumbs(pathname: string): Crumb[] {
  const domain = domainOf(pathname);
  const trail: Crumb[] = [{ label: domain.label, href: domain.href }];
  const mod = moduleOf(pathname);
  if (mod && mod.href !== domain.href) trail.push({ label: mod.label, href: mod.href });
  return trail;
}
