import "server-only";
import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { workspaceBySlug, workspaceLanding, canSeeWorkspace } from "@/lib/nav";

/**
 * Entrada a un workspace.
 *
 * La URL del workspace (`/dashboard/comercial`) se conserva para no romper
 * enlaces históricos, pero ya no pinta una pantalla de tarjetas: resuelve el
 * módulo principal que ese usuario puede ver y entra directo. Es una redirección
 * barata —no consulta ninguna tabla— frente a las veinte agregaciones que
 * costaba el hub anterior.
 *
 * Si el usuario no puede ver NINGÚN módulo del workspace, `workspaceLanding`
 * cae a `workspace.href`, que es esta misma página: redirigir ahí sería un
 * bucle infinito. El menú lateral ya oculta esos workspaces, pero la URL sigue
 * siendo alcanzable por enlace histórico, marcador o enlace compartido — que es
 * precisamente lo que este flujo promete soportar. Por eso se comprueba la
 * visibilidad aquí y se vuelve al panel.
 */
export async function enterWorkspace(slug: string): Promise<never> {
  const workspace = workspaceBySlug(slug);
  if (!workspace) {
    console.error(`[nav] workspace desconocido: ${slug}`);
    redirect("/dashboard");
  }

  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");

  const navCtx = {
    role: ctx.role,
    modules: ctx.company?.modules_enabled,
    companyType: ctx.company?.company_type,
  };

  if (!canSeeWorkspace(workspace, navCtx)) {
    console.warn(`[nav] ${ctx.email} (rol ${ctx.role}) no tiene módulos visibles en ${slug}; vuelve al panel`);
    redirect("/dashboard");
  }

  const target = workspaceLanding(workspace, navCtx);

  // Cinturón y tirantes: si por cualquier motivo el destino resuelve a esta
  // misma URL, volver al panel antes que entrar en bucle.
  if (target === workspace.href) {
    console.error(`[nav] ${slug}: destino = propia URL; se evita el bucle`);
    redirect("/dashboard");
  }

  console.log(`[nav] entrando a ${slug} → ${target} (rol ${ctx.role})`);
  redirect(target);
}
