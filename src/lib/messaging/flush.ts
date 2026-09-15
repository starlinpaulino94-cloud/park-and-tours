import "server-only";
import { after } from "next/server";
import { dispatchQueue } from "@/lib/messaging/outbox";
import { serviceStore } from "@/lib/messaging/service-store";
import type { Company } from "@/lib/types";

/**
 * Entregar la cola al TERMINAR la petición, no dentro de ella.
 *
 * Encolar y entregar están separados a propósito: que el proveedor de correo
 * esté caído no puede tumbar una venta ya cobrada, ni hacer esperar al cajero
 * con el cliente delante. Pero esa separación dejaba la entrega en manos del
 * cron, y el cron pasó a ser diario —el plan Hobby de Vercel no admite menos—,
 * así que la confirmación de una reserva hecha a las 9 de la mañana salía a la
 * mañana siguiente. Para un voucher eso es no mandarlo.
 *
 * `after()` es la vía que no obliga a elegir: el trabajo corre cuando la
 * respuesta ya salió, así que el cliente recibe su aviso en segundos y la venta
 * no espera ni un milisegundo por Resend. El cron diario deja de ser el
 * repartidor y pasa a ser lo que debía: barrido y reintento de lo que no salió.
 */

/** Cuántos mensajes se intentan por petición. Los de una venta son dos o tres. */
const DEFAULT_LIMIT = 10;

/**
 * Drena la cola de una empresa.
 *
 * Usa el cliente de SERVICIO con filtro explícito de `organization_id`, igual
 * que el cron y por la misma razón: esto corre después de la respuesta, donde no
 * hay garantía de que las ayudas de inquilino sigan resolviendo la sesión desde
 * las cookies. Si fallara, no se rompería —leería cero mensajes y diría que no
 * hay nada que mandar—, que es el peor fallo posible en una cola. El
 * `companyId` sale de `requireTenant()` en la ruta que llama, así que el ámbito
 * es el mismo que tendría con RLS.
 *
 * Se exporta aparte de `flushOutboxAfterResponse` para poder probarlo sin
 * montar un contexto de petición de Next.
 */
export async function drainOutbox(
  company: Company | null,
  companyId: string,
  limit = DEFAULT_LIMIT
): Promise<void> {
  try {
    const report = await dispatchQueue(company, companyId, limit, serviceStore());
    if (report.picked > 0) {
      console.log(
        `[mensajería] tras la respuesta: ${report.sent} enviados · ` +
        `${report.failed} fallidos · ${report.waiting} en espera`
      );
    }
  } catch (err) {
    // Nada de lo que pase aquí puede escalar: la respuesta ya se envió y la
    // operación ya está hecha. Lo que no salga lo recoge el barrido diario.
    console.error("[mensajería] el drenado tras la respuesta falló:", err);
  }
}

/**
 * Programa el drenado para cuando la respuesta haya salido.
 *
 * Se llama desde la ruta, no desde el servicio que encola: `after()` necesita el
 * contexto de la petición, y hacerlo explícito en cada ruta deja a la vista qué
 * caminos entregan al momento y cuáles esperan al barrido.
 */
export function flushOutboxAfterResponse(
  company: Company | null,
  companyId: string,
  limit = DEFAULT_LIMIT
): void {
  try {
    after(() => drainOutbox(company, companyId, limit));
  } catch (err) {
    // Fuera de una petición —una prueba, un script— "después de la respuesta"
    // no significa nada. No es un fallo: el barrido diario lo recoge.
    console.warn("[mensajería] no hay contexto de petición para drenar la cola:", err);
  }
}
