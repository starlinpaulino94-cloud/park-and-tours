import "server-only";
import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { workspaceBySlug, workspaceLanding } from "@/lib/nav";

/**
 * Entrada a un workspace.
 *
 * La URL del workspace (`/dashboard/comercial`) se conserva para no romper
 * enlaces históricos, pero ya no pinta una pantalla de tarjetas: resuelve el
 * módulo principal que ese usuario puede ver y entra directo. Es una redirección
 * barata —no consulta ninguna tabla— frente a las veinte agregaciones que
 * costaba el hub anterior.
 */
export async function enterWorkspace(slug: string): Promise<never> {
  const workspace = workspaceBySlug(slug);
  if (!workspace) {
    console.error(`[nav] workspace desconocido: ${slug}`);
    redirect("/dashboard");
  }

  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");

  const target = workspaceLanding(workspace, {
    role: ctx.role,
    modules: ctx.company?.modules_enabled,
    companyType: ctx.company?.company_type,
  });

  console.log(`[nav] entrando a ${slug} → ${target} (rol ${ctx.role})`);
  redirect(target);
}
