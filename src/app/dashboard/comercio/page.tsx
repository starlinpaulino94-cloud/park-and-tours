import { requireTenant } from "@/lib/tenant";
import { WorkspaceHub, type HubMetric } from "@/components/tf/workspace-hub";
import { workspaceBySlug } from "@/lib/nav";
import { countMany, sumMany, todayRange, plural } from "@/lib/hub-stats";
import { formatCompactMoney } from "@/lib/format";

export default async function ComercioHub() {
  const ctx = await requireTenant();
  const today = todayRange();
  const currency = ctx.company?.base_currency || "usd";

  const [c, s] = await Promise.all([
    countMany(ctx.companyId, {
      items: { table: "inventory_item", filter: { status: "active" } },
      levels: { table: "stock_level" },
      lowStock: { table: "stock_level", filter: { available: { lte: 5 } } },
      movementsToday: { table: "stock_movement", filter: { moved_at: today } },
      warehouses: { table: "warehouse", filter: { status: "active" } },
      posOpen: { table: "purchase_order", filter: { status: { in: ["draft", "pending_approval", "approved", "sent", "partially_received"] } } },
      posApproval: { table: "purchase_order", filter: { status: "pending_approval" } },
      suppliers: { table: "supplier", filter: { status: "active" } },
    }),
    sumMany(ctx.companyId, {
      stockValue: { table: "stock_level", field: "quantity" },
      poValue: { table: "purchase_order", field: "total", filter: { status: { in: ["approved", "sent", "partially_received"] } } },
    }),
  ]);

  const metrics: Record<string, HubMetric> = {
    "/dashboard/comercio/articulos": { value: plural(c.items, "artículo", "artículos"), tone: c.items > 0 ? "good" : "neutral" },
    "/dashboard/comercio/existencias": { value: c.lowStock > 0 ? plural(c.lowStock, "bajo mínimo", "bajo mínimo") : `${c.levels} saldos`, tone: c.lowStock > 0 ? "bad" : "good" },
    "/dashboard/comercio/movimientos": { value: plural(c.movementsToday, "movimiento hoy", "movimientos hoy") },
    "/dashboard/comercio/almacenes": { value: plural(c.warehouses, "almacén", "almacenes") },
    "/dashboard/comercio/compras": { value: c.posApproval > 0 ? plural(c.posApproval, "por aprobar", "por aprobar") : plural(c.posOpen, "orden abierta", "órdenes abiertas"), tone: c.posApproval > 0 ? "warn" : "neutral" },
    "/dashboard/proveedores": { value: plural(c.suppliers, "proveedor", "proveedores") },
  };

  return (
    <WorkspaceHub
      workspace={workspaceBySlug("comercio")!}
      role={ctx.role}
      modules={ctx.company?.modules_enabled}
      companyType={ctx.company?.company_type}
      metrics={metrics}
      kpis={[
        { label: "Artículos activos", value: String(c.items), icon: "Boxes", tone: "primary" },
        { label: "Unidades en stock", value: String(Math.round(s.stockValue)), icon: "Layers3", hint: `${c.warehouses} almacenes` },
        { label: "Bajo mínimo", value: String(c.lowStock), icon: "TriangleAlert", tone: c.lowStock > 0 ? "coral" : "default", hint: "Requieren reorden" },
        { label: "Compras en curso", value: formatCompactMoney(s.poValue, currency), icon: "FileInput", tone: "amber", hint: `${c.posOpen} órdenes abiertas` },
      ]}
    />
  );
}
