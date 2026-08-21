import { enterWorkspace } from "@/lib/workspace-entry";

/**
 * Un workspace no es una pantalla intermedia: entra directo a su módulo
 * principal y el menú lateral muestra el resto del área.
 */
export default async function Page() {
  await enterWorkspace("comercio");
}
