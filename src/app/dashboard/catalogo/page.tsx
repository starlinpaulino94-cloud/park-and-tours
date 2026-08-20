import { redirect } from "next/navigation";
import { LEGACY_HUB_REDIRECTS } from "@/lib/nav";

/**
 * Ruta heredada. "catalogo" dejó de ser un área propia al fusionarse en
 * "comercial"; el enlace antiguo sigue funcionando y lleva al workspace correcto.
 * Sus rutas hijas no cambiaron.
 */
export default function LegacyHub() {
  redirect(LEGACY_HUB_REDIRECTS["/dashboard/catalogo"]);
}
