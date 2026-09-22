import Link from "next/link";
import { requireTenant, atLeast } from "@/lib/tenant";
import type { AppRole } from "@/lib/auth";
import { gruposDeReportes } from "@/lib/reportes";
import { PageHeader } from "@/components/tf/page-header";
import { Icon } from "@/components/tf/icon";
import { Card } from "@/components/ui/card";

/**
 * EL ÍNDICE DE REPORTES.
 *
 * Tiene dos mitades, y la diferencia importa:
 *
 *  • Los ANALÍTICOS (abajo, escritos a mano): pantallas que CALCULAN —margen,
 *    antigüedad de saldos, ocupación—. Cada una vive en el módulo dueño de su
 *    dato, para que dos pantallas no cuenten historias distintas.
 *
 *  • Los DOCUMENTOS (arriba, salidos del registro `reportes.ts`): listados
 *    acotados a un período, con totales, pensados para imprimirse y
 *    archivarse. No se enumeran aquí a mano a propósito: añadir uno al
 *    registro tiene que bastar para que aparezca, o el índice se queda atrás
 *    y el reporte nuevo no existe para nadie.
 */

/** Un ícono por grupo del registro; el genérico si el grupo es nuevo. */
const ICONO_GRUPO: Record<string, string> = {
  Comercial: "ShoppingCart", Dinero: "Banknote", "Operación": "CalendarRange",
  "Almacén": "Layers3", Equipo: "UserRoundCheck", "Huésped": "Star",
};

/**
 * `rol` es el mínimo que la API del documento exige.
 *
 * Sin esto, el índice ofrece tarjetas que llevan a un «No tienes permisos»:
 * quien opera la jornada ve «Estados financieros», lo abre y se come un 403.
 * Ofrecer una puerta cerrada es peor que no ofrecerla — hace pensar que el
 * sistema está roto, no que el permiso no alcanza.
 */
type Item = { href: string; label: string; description: string; icon: string; rol?: AppRole };

const REPORTS: { group: string; items: Item[] }[] = [
  {
    group: "Documentos que se firman",
    items: [
      { href: "/dashboard/reportes/cierre-del-dia", label: "Cierre del día", icon: "ClipboardCheck",
        description: "Qué operó, qué se vendió, qué entró y si la caja cuadra. Con líneas de firma.", rol: "operations" },
      { href: "/dashboard/reportes/estados-financieros", label: "Estados financieros", icon: "Scale",
        description: "Estado de resultados y balance general por meses contables. Avisa si no cuadra.", rol: "manager" },
      { href: "/dashboard/reportes/declaracion-dgii", label: "Declaración DGII (606/607/608)", icon: "Landmark",
        description: "La declaración del mes, legible, con lo que queda fuera y por qué.", rol: "manager" },
      { href: "/dashboard/reportes/antiguedad-saldos", label: "Antigüedad de saldos", icon: "ArrowDownToLine",
        description: "Lo que se debe y desde cuándo, por tramo. Foto del momento, con su fecha de corte.", rol: "manager" },
      { href: "/dashboard/reportes/actividad", label: "Bitácora de actividad", icon: "ScrollText",
        description: "Todo lo que se hizo en un período: quién, qué y sobre qué. Imprimible." },
    ],
  },
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
  const ctx = await requireTenant();
  const puede = (item: Item) => !item.rol || atLeast(ctx.role, item.rol);

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Analítica"
        title="Reportes operativos"
        description="Los documentos que se imprimen por fecha y los análisis que calculan. Ninguno inventa un dato: todos salen del módulo que lo produce."
      />

      {/* Documentos imprimibles: salen del registro, no de una lista a mano. */}
      <section className="space-y-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Documentos imprimibles por fecha
        </h2>
        <p className="-mt-1 text-xs text-muted-foreground">
          Cada uno se abre en el período que elijas, se imprime con encabezado de empresa y se baja en CSV.
        </p>
        {gruposDeReportes().map(({ grupo, reportes }) => (
          <div key={grupo} className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">{grupo}</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {reportes.map((r) => (
                <Link key={r.slug} href={`/dashboard/reportes/${r.slug}`} className="group">
                  <Card className="flex h-full items-start gap-3 p-4 transition-colors hover:border-primary/40 hover:bg-primary/[0.03]">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                      <Icon name={ICONO_GRUPO[grupo] ?? "FileText"} className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{r.titulo}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{r.descripcion}</span>
                    </span>
                    <Icon name="Printer" className="ml-auto size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </section>

      {REPORTS.map((section) => ({ ...section, items: section.items.filter(puede) }))
        .filter((section) => section.items.length > 0)
        .map((section) => (
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
