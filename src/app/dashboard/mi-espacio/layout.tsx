import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";

/**
 * GUARDA DE SERVIDOR DEL APARTADO PROPIO.
 *
 * Todo lo que cuelga de aquí habla de UNA persona: sus ventas, su comisión, su
 * meta. Quien no tenga sesión no entra, y el usuario del portal B2B tampoco
 * —aunque el layout de arriba ya lo desvía, esta pantalla no puede depender de
 * que otra se acuerde: es la regla de que toda pantalla nueva de actor externo
 * nace con su guarda—.
 *
 * Lo que NO se comprueba aquí es la ficha de vendedor. No tenerla no es falta
 * de permiso: es una configuración a medio hacer, y la respuesta correcta es
 * explicarlo (y decir quién lo arregla), no un 403 ni una pantalla en blanco.
 */
export default async function MiEspacioLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  if (!ctx.companyId) redirect("/onboarding");
  if (ctx.role === "partner") redirect("/portal");
  return <>{children}</>;
}
