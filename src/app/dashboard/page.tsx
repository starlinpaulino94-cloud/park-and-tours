import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { PanelEmpresa } from "./_components/panel-empresa";

/**
 * A DÓNDE ATERRIZA CADA QUIEN.
 *
 * Todo el mundo caía en el panel de la empresa. Para quien vende a comisión eso
 * son ocupación de salidas, canales y alertas de caja —nada de lo cual es
 * suyo— con sus tres cifras escondidas en medio. Y si además su cuenta no está
 * vinculada a ninguna ficha, el panel sale VACÍO sin decir por qué: parece una
 * avería del sistema y es una configuración a medio hacer.
 *
 * El rango más bajo del ERP aterriza en su apartado. De `cashier` hacia arriba
 * no se desvía a nadie: quien gestiona necesita el panel de la empresa, y si
 * además vende llega a «Mi espacio» por el menú, que para eso no tiene rango
 * mínimo.
 *
 * Es una comodidad, no una barrera: quien teclee `/dashboard` a mano acaba en
 * el mismo sitio, y lo que de verdad protege cada pantalla es su propia guarda.
 */
export default async function DashboardPage() {
  const ctx = await getTenantContext();
  if (ctx?.role === "seller") redirect("/dashboard/mi-espacio");
  return <PanelEmpresa />;
}
