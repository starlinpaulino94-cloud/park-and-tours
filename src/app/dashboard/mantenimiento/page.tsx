import { enterWorkspace } from "@/lib/workspace-entry";

/**
 * Ruta heredada: «mantenimiento» pasó a formar parte de «operaciones».
 * El enlace antiguo sigue vivo y lleva al módulo principal del área.
 */
export default async function LegacyHub() {
  await enterWorkspace("operaciones");
}
