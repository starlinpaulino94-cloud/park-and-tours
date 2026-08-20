import Link from "next/link";
import { requireTenant } from "@/lib/tenant";
import { PageHeader } from "@/components/tf/page-header";
import { Icon } from "@/components/tf/icon";
import { Card } from "@/components/ui/card";

/**
 * Index of the reports the business actually runs on. Each one lives in the
 * module that owns its data, so the numbers never diverge between screens.
 */
const REPORTS: { group: string; items: { href: string; label: string; description: string; icon: string }[] }[] = [
  {
    group: "Comercial",
    items: [
      { href: "/dashboard/rentabilidad", label: "Rentabilidad por producto", icon: "TrendingUp",
        description: "Venta, costo y margen por producto y canal." },
      { href: "/dashboard/ventas", label: "Resumen de ventas", icon: "ShoppingCart",
        description: "Órdenes, reservas y ticket promedio del período." },
      { href: "/dashboard/comisiones", label: "Comisiones devengadas", icon: "Percent",
        description: "Comisión por socio y vendedor, con su estado de pago." },
      { href: "/dashboard/liquidaciones", label: "Liquidaciones a socios", icon: "FileSpreadsheet",
        description: "Cortes por socio con lo pagado y lo pendiente." },
    ],
  },
  {
    group: "Operación",
    items: [
      { href: "/dashboard/salidas", label: "Ocupación de salidas", icon: "CalendarRange",
        description: "Cupo vendido, disponible y sobreventa por salida." },
      { href: "/dashboard/operaciones/despacho", label: "Despacho del día", icon: "Radar",
        description: "Qué opera hoy, con qué recursos y quién falta." },
      { href: "/dashboard/parque/control", label: "Estado de atracciones", icon: "MonitorDot",
        description: "Downtime, cola y visitantes por atracción." },
      { href: "/dashboard/mantenimiento/fuera-de-servicio", label: "Activos fuera de servicio", icon: "OctagonX",
        description: "Qué está caído y cuánta capacidad se pierde." },
    ],
  },
  {
    group: "Finanzas",
    items: [
      { href: "/dashboard/finanzas/diario", label: "Libro diario", icon: "Scale",
        description: "Todos los asientos con su origen y contrapartida." },
      { href: "/dashboard/finanzas/cuentas", label: "Balance por cuenta", icon: "Network",
        description: "Saldo acumulado de cada cuenta del plan contable." },
      { href: "/dashboard/cobros", label: "Antigüedad de saldos", icon: "ArrowDownToLine",
        description: "Cuentas por cobrar por tramo de vencimiento." },
      { href: "/dashboard/finanzas/facturas", label: "Facturación emitida", icon: "Receipt",
        description: "Facturas y notas de crédito con su estado fiscal." },
    ],
  },
  {
    group: "Inventario y equipo",
    items: [
      { href: "/dashboard/comercio/existencias", label: "Existencias valorizadas", icon: "Layers3",
        description: "Saldo y costo promedio por artículo y almacén." },
      { href: "/dashboard/comercio/movimientos", label: "Kardex de movimientos", icon: "ArrowRightLeft",
        description: "Trazabilidad completa de entradas y salidas." },
      { href: "/dashboard/equipo/asistencia", label: "Horas trabajadas", icon: "UserRoundCheck",
        description: "Marcajes, horas normales y extras por persona." },
    ],
  },
];

export default async function ReportsPage() {
  await requireTenant();

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Analítica"
        title="Reportes operativos"
        description="Los reportes indispensables del negocio, cada uno alimentado por el módulo dueño de su dato."
      />

      {REPORTS.map((section) => (
        <section key={section.group} className="space-y-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            {section.group}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {section.items.map((item) => (
              <Link key={item.href} href={item.href} className="group">
                <Card className="flex h-full items-start gap-3 p-4 transition-colors hover:border-primary/40 hover:bg-primary/[0.03]">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                    <Icon name={item.icon} className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{item.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{item.description}</span>
                  </span>
                  <Icon name="ArrowRight" className="ml-auto size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
