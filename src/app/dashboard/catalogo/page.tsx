import { requireTenant } from "@/lib/tenant";
import { DomainHub, type HubMetric } from "@/components/tf/domain-hub";
import { domainBySlug } from "@/lib/nav";
import { countMany, plural } from "@/lib/hub-stats";

export default async function CatalogoHub() {
  const ctx = await requireTenant();
  const c = await countMany(ctx.companyId, {
    products: { table: "product", filter: { status: "active" } },
    modalities: { table: "product_modality" },
    categories: { table: "product_category" },
    priceRules: { table: "price_rule", filter: { status: "active" } },
    costs: { table: "product_cost" },
    policies: { table: "cancellation_policy" },
    plans: { table: "membership_plan", filter: { status: "active" } },
    productsNoCost: { table: "product", filter: { status: "active" } },
  });

  const metrics: Record<string, HubMetric> = {
    "/dashboard/productos": { value: plural(c.products, "producto activo", "productos activos"), tone: c.products > 0 ? "good" : "warn" },
    "/dashboard/catalogo/modalidades": { value: plural(c.modalities, "modalidad", "modalidades") },
    "/dashboard/catalogo/categorias": { value: plural(c.categories, "categoría", "categorías") },
    "/dashboard/catalogo/precios": { value: plural(c.priceRules, "regla vigente", "reglas vigentes") },
    "/dashboard/catalogo/costos": { value: plural(c.costs, "costo cargado", "costos cargados"), tone: c.costs === 0 ? "warn" : "neutral" },
    "/dashboard/catalogo/politicas": { value: plural(c.policies, "política", "políticas") },
    "/dashboard/catalogo/membresias": { value: plural(c.plans, "plan activo", "planes activos") },
  };

  return (
    <DomainHub
      domain={domainBySlug("catalogo")!}
      role={ctx.role}
      modules={ctx.company?.modules_enabled}
      companyType={ctx.company?.company_type}
      metrics={metrics}
      kpis={[
        { label: "Productos activos", value: String(c.products), icon: "Ticket", tone: "primary" },
        { label: "Modalidades", value: String(c.modalities), icon: "Layers", hint: "Variantes vendibles" },
        { label: "Reglas de precio", value: String(c.priceRules), icon: "Tags", hint: "Vigentes por canal y temporada" },
        { label: "Costos cargados", value: String(c.costs), icon: "Calculator", tone: c.costs === 0 ? "coral" : "default", hint: "Sin costos no hay margen real" },
      ]}
    />
  );
}
