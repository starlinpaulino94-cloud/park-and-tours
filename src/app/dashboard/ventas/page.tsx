import { enterWorkspace } from "@/lib/workspace-entry";

/**
 * Ruta heredada: «ventas» se fusionó en «comercial».
 * El enlace antiguo sigue vivo y lleva al módulo principal del área.
 */
export default async function LegacyHub() {
  await enterWorkspace("comercial");
}
