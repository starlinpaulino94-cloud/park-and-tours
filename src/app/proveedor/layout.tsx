import { redirect } from "next/navigation";
import { getTenantContext, tenantQuery, esDeProveedor, esInterno } from "@/lib/tenant";
import { SideShell } from "@/components/tf/side-shell";
import { PROVEEDOR_NAV } from "@/lib/nav";

/**
 * EL PORTAL DEL PROVEEDOR.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NACE CON SU GUARDA, Y ESO ES UNA NORMA, NO UNA PRECAUCIÓN
 *
 * El plan lo dice con todas las letras: «toda pantalla nueva de actor externo
 * nace con guarda en el layout». Viene de haber contado que 5 de 129 páginas
 * miraban el rol en el servidor, y de que el menú nunca fue una barrera —
 * esconder una entrada no cierra la ruta que hay debajo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y QUIÉN ENTRA SE DECIDE POR EL IDENTIFICADOR
 *
 * `esDeProveedor` mira `ctx.supplierId`, no el nombre del rol. Esa ficha ya
 * pasó por su comprobación en `auth-context`: si la operadora desactivó al
 * proveedor o le desvinculó la cuenta, el contexto llega sin identificador y
 * aquí no entra — sin esperar a que su sesión se renueve.
 *
 * El personal interno SÍ puede mirar, que es como se atiende un «no me sale
 * nada» por teléfono. Lo que no puede es entrar sin ser nadie.
 */
export default async function ProveedorLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  if (!ctx.companyId) redirect("/onboarding");

  // Ni proveedor ni interno: no tiene nada que hacer aquí. Al panel, que ya
  // decidirá él si esa persona tiene sitio.
  if (!esDeProveedor(ctx) && !esInterno(ctx)) redirect("/dashboard");

  let nombre = ctx.company?.name || "Portal de proveedores";
  if (ctx.supplierId) {
    const [ficha] = await tenantQuery<{ name?: string }>(ctx.companyId, "supplier", {
      _filter: { _id: ctx.supplierId }, _limit: 1,
    });
    if (ficha?.name) nombre = ficha.name;
  }

  return (
    <SideShell
      nav={PROVEEDOR_NAV}
      brand="TourFlow"
      badge="Proveedor"
      accent="ink"
      subtitle={nombre}
      user={{ name: ctx.name, role: ctx.role, companyName: nombre }}
      extraLinks={
        esInterno(ctx) ? [{ href: "/dashboard", label: "Volver al panel interno", icon: "ArrowLeft" }] : []
      }
    >
      {children}
    </SideShell>
  );
}
