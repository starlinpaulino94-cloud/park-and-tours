import { redirect } from "next/navigation";
import { getTenantContext, atLeast } from "@/lib/tenant";
import type { AppRole } from "@/lib/auth";
import { PageHeader } from "@/components/tf/page-header";
import { EmptyState } from "@/components/tf/empty-state";

/**
 * GUARDAS DE ROL EN SERVIDOR, PARA PANTALLAS DE CLIENTE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL MENÚ NO ES UNA BARRERA
 *
 * De 129 pantallas del panel, 5 miraban el rol en servidor — y ninguna de ellas
 * era de las que enseñan dinero. El menú esconde `/dashboard/comisiones` a
 * quien no tiene rango; la URL, no. Quien la teclea entra, y la pantalla pide
 * sus datos a la API.
 *
 * La API sí se defiende (`READ_ROLE` devuelve 403), así que lo que se veía era
 * una pantalla rota llena de errores en vez de un «esto no es para ti». Pero
 * apoyarse en eso es apoyarse en que ninguna de las rutas que esa pantalla
 * llama tenga un hueco. La pantalla tiene que negarse por su cuenta.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ UN LAYOUT Y NO UN CAMBIO EN CADA PÁGINA
 *
 * Las pantallas del panel son componentes de cliente: no pueden leer el
 * contexto de sesión. Convertir cada una en pareja servidor+cliente serían dos
 * ficheros por pantalla y un sitio más donde olvidarse.
 *
 * Un `layout.tsx` de dos líneas junto a la carpeta corre en el SERVIDOR, no
 * toca la página y **cubre también sus subpáginas** —`/dashboard/vendedores`
 * protege metas, bonos, tipos y atribución de una vez—. Añadir una pantalla
 * nueva dentro de una carpeta protegida la protege sola.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SE EXPLICA, NO SE REDIRIGE
 *
 * Un desvío silencioso a otra pantalla hace pensar que el enlace está roto y
 * que hay que volver a intentarlo. Se dice qué hace falta y quién lo da.
 */

const NOMBRE_DEL_RANGO: Partial<Record<AppRole, string>> = {
  manager: "gerencia",
  admin: "administración",
  owner: "propiedad",
  operations: "operaciones",
  cashier: "caja",
};

/**
 * Devuelve un `layout` que exige este rango.
 *
 * Se usa así, en un `layout.tsx` junto a la pantalla:
 *
 *     import { guardedLayout } from "@/lib/page-guard";
 *     export default guardedLayout("manager");
 */
export function guardedLayout(minimo: AppRole) {
  return async function LayoutConGuarda({ children }: { children: React.ReactNode }) {
    const ctx = await getTenantContext();
    // Sin sesión no se decide nada aquí: eso lo resuelve el layout del panel.
    if (!ctx) redirect("/login");
    if (atLeast(ctx.role, minimo)) return <>{children}</>;

    return (
      <div className="space-y-5">
        <PageHeader title="Esta sección no está disponible para tu rol" />
        <EmptyState
          icon="Lock"
          title={`Hace falta rango de ${NOMBRE_DEL_RANGO[minimo] ?? minimo}`}
          description={
            "Aquí se ven cifras y condiciones de toda la empresa. Si necesitas " +
            "entrar, pídeselo a quien administra tu cuenta. Lo tuyo —tus ventas, " +
            "tu comisión y tu meta— está en «Mi espacio»."
          }
        />
      </div>
    );
  };
}
