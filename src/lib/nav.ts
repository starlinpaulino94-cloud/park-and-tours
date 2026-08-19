/**
 * Navigation map for the ERP shell. Client-safe (no server imports).
 * `roles` restricts a section to the listed roles; `module` hides it when the
 * tenant plan has the module disabled.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: string;
  roles?: string[];
  module?: string;
  badge?: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    title: "Dirección",
    items: [
      { href: "/dashboard", label: "Panel ejecutivo", icon: "LayoutDashboard" },
      { href: "/dashboard/rentabilidad", label: "Rentabilidad", icon: "TrendingUp", module: "reports", roles: ["owner", "admin", "manager", "superadmin"] },
    ],
  },
  {
    title: "Comercial",
    items: [
      { href: "/dashboard/pos", label: "Nueva venta", icon: "ShoppingCart", badge: "POS" },
      { href: "/dashboard/reservas", label: "Reservas", icon: "CalendarCheck", module: "bookings" },
      { href: "/dashboard/salidas", label: "Salidas y cupos", icon: "CalendarRange", module: "bookings" },
      { href: "/dashboard/productos", label: "Excursiones", icon: "Ticket" },
      { href: "/dashboard/promociones", label: "Promociones", icon: "BadgePercent" },
      { href: "/dashboard/clientes", label: "Clientes", icon: "Users" },
      { href: "/dashboard/crm", label: "CRM y leads", icon: "Sparkles", module: "crm" },
    ],
  },
  {
    title: "Red de ventas",
    items: [
      { href: "/dashboard/vendedores", label: "Vendedores", icon: "UserRound" },
      { href: "/dashboard/partners", label: "Tour centers y agencias", icon: "Handshake" },
      { href: "/dashboard/comisiones", label: "Comisiones", icon: "Percent", module: "commissions" },
      { href: "/dashboard/liquidaciones", label: "Liquidaciones", icon: "FileSpreadsheet", module: "settlements" },
    ],
  },
  {
    title: "Operación",
    items: [
      { href: "/dashboard/operaciones", label: "Despacho diario", icon: "Radar", module: "operations" },
      { href: "/dashboard/checkin", label: "Check-in", icon: "ScanLine", module: "bookings" },
      { href: "/dashboard/pickups", label: "Pickups y hoteles", icon: "MapPin", module: "pickups" },
      { href: "/dashboard/transporte", label: "Transporte", icon: "Bus", module: "transport" },
      { href: "/dashboard/personal", label: "Guías y personal", icon: "IdCard" },
    ],
  },
  {
    title: "Finanzas",
    items: [
      { href: "/dashboard/caja", label: "Caja y POS", icon: "Wallet", module: "cash_pos" },
      { href: "/dashboard/pagos", label: "Pagos y reembolsos", icon: "CreditCard", module: "payments" },
      { href: "/dashboard/cobros", label: "Cuentas por cobrar", icon: "ArrowDownToLine", module: "accounting" },
      { href: "/dashboard/deudas", label: "Cuentas por pagar", icon: "ArrowUpFromLine", module: "accounting" },
      { href: "/dashboard/gastos", label: "Gastos", icon: "Receipt", module: "accounting" },
      { href: "/dashboard/proveedores", label: "Proveedores", icon: "Truck" },
    ],
  },
  {
    title: "Sistema",
    items: [
      { href: "/dashboard/auditoria", label: "Auditoría", icon: "ShieldCheck", module: "audit", roles: ["owner", "admin", "superadmin"] },
      { href: "/dashboard/configuracion", label: "Configuración", icon: "Settings", roles: ["owner", "admin", "superadmin"] },
    ],
  },
];

export const PORTAL_NAV: NavItem[] = [
  { href: "/portal", label: "Resumen", icon: "LayoutDashboard" },
  { href: "/portal/catalogo", label: "Catálogo y disponibilidad", icon: "Ticket" },
  { href: "/portal/reservas", label: "Mis reservas", icon: "CalendarCheck" },
  { href: "/portal/liquidaciones", label: "Comisiones y estados", icon: "FileSpreadsheet" },
];

export const SUPERADMIN_NAV: NavItem[] = [
  { href: "/superadmin", label: "Métricas globales", icon: "Globe2" },
  { href: "/superadmin/empresas", label: "Empresas", icon: "Building2" },
  { href: "/superadmin/planes", label: "Planes y suscripciones", icon: "Layers" },
  { href: "/superadmin/auditoria", label: "Auditoría global", icon: "ShieldCheck" },
];

const ROLE_RANK: Record<string, number> = {
  superadmin: 100, owner: 90, admin: 80, manager: 60,
  operations: 40, cashier: 40, seller: 20, partner: 10,
};

export function canSee(item: NavItem, role?: string, modules?: string[] | null): boolean {
  if (item.roles && role && !item.roles.includes(role)) return false;
  if (item.module && modules && modules.length > 0 && !modules.includes(item.module)) return false;
  // Sellers only get the commercial surface.
  if (role === "seller" && ROLE_RANK[role] < 40) {
    const allowed = ["/dashboard", "/dashboard/pos", "/dashboard/reservas", "/dashboard/salidas",
      "/dashboard/productos", "/dashboard/clientes", "/dashboard/crm", "/dashboard/comisiones"];
    return allowed.includes(item.href);
  }
  return true;
}
