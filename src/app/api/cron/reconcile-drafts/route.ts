import { NextRequest } from "next/server";
import { supabaseService } from "@/lib/supabase/service";
import { ok, fail } from "@/lib/api-response";
import { startJobRun, finishJobRun, reportIncident, barridoVigilado } from "@/lib/system-health-service";
import { TenantError } from "@/lib/tenant";
import { reconcileStaleDrafts } from "@/lib/booking-service";
import { writeAudit } from "@/lib/audit";
import type { ResumenBarrido } from "@/lib/barrido";

/**
 * GET /api/cron/reconcile-drafts — las ventas que se quedaron a medias.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA REPARACIÓN EXISTÍA Y NO LA EJECUTABA NADIE
 *
 * `createOrderWithBookings` es una saga: crea la orden en `draft`, va escribiendo
 * reservas, vouchers, comisiones y cuentas por cobrar, y al final la promueve a
 * `pending_payment`. Si algo lanza, `compensateOrder` lo deshace todo dentro de
 * la misma petición.
 *
 * Pero si el PROCESO MUERE —un tiempo de espera de Vercel, un despliegue a medio
 * vuelo, un OOM— no hay excepción que capturar y la compensación no corre nunca.
 * Lo que queda es una orden `draft` con sus reservas apartando plazas, un voucher
 * que escanea como válido, una comisión `pending` que la próxima liquidación
 * PAGA, y una cuenta por cobrar que parece cobrable. Una venta que no existió,
 * con todos sus efectos.
 *
 * `reconcileStaleDrafts` se escribió justo para eso, con su propio comentario:
 * «Meant to be run periodically (cron) or on demand by an admin». Y **nada la
 * ejecutaba**. La única puerta era `POST /api/maintenance/reconcile-drafts`, que
 * exige sesión de `admin` y mismo origen: un programador de tareas no tiene ni
 * una cosa ni la otra, así que no había forma de que se ejecutara sola. No
 * estaba mal escrita — estaba sin enchufar, que es la familia de fallos de la
 * plantilla que nada disparaba y de la casilla que nadie leía.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ LA VENTANA ES DE UNA HORA Y NO DE TREINTA MINUTOS
 *
 * La ruta de mantenimiento usa treinta por defecto. Aquí se sube a sesenta a
 * propósito: esto corre sin nadie mirando y sobre TODAS las empresas, así que un
 * falso positivo revierte una venta buena. Una saga normal tarda menos de un
 * segundo; entre un segundo y una hora solo caben las que de verdad murieron.
 * Prefiero que una venta huérfana viva una hora de más a revertir una viva.
 */
export const dynamic = "force-dynamic";

/** Cuántos minutos tiene que llevar un borrador para considerarse abandonado. */
const VENTANA_MINUTOS = 60;

export async function GET(req: NextRequest) {
  let runId: string | null = null;
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new TenantError("CRON_SECRET no está configurado en el entorno", 503);
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      console.warn("[cron/reconcile-drafts] intento de ejecución sin credencial válida");
      throw new TenantError("No autorizado", 401);
    }

    runId = await startJobRun("reconcile-drafts");

    const corte = new Date(Date.now() - VENTANA_MINUTOS * 60_000).toISOString();

    /**
     * Las empresas con borradores viejos, leídas ENTERAS.
     *
     * Con el tope fijo que tenían los demás barridos antes de la ola 9.11, una
     * operadora podía no aparecer nunca en la lista y quedarse con sus ventas a
     * medias para siempre. Por eso va por `barridoVigilado`, ordenado, y si
     * llega al techo levanta un incidente en vez de callarse.
     */
    const empresas = new Set<string>();
    const barrido: ResumenBarrido = await barridoVigilado<{ id: string; organization_id: string }>({
      etiqueta: "borradores:empresas",
      modo: "recorrido",
      idDe: (fila) => fila.id,
      leer: async (desde, hasta) => {
        const { data, error } = await supabaseService()
          .from("sales_order")
          .select("id, organization_id")
          .eq("status", "draft")
          .lt("created_at", corte)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(desde, hasta);
        if (error) throw new Error(error.message);
        return (data ?? []) as { id: string; organization_id: string }[];
      },
      tratar: async (filas) => { for (const f of filas) empresas.add(f.organization_id); },
    });

    let revertidas = 0;
    let revisadas = 0;
    const fallidas: string[] = [];

    for (const companyId of empresas) {
      try {
        const r = await reconcileStaleDrafts(companyId, VENTANA_MINUTOS);
        revisadas += r.scanned;
        revertidas += r.reverted;

        /**
         * Y QUEDA EN LA BITÁCORA DE ESA EMPRESA.
         *
         * Revertir una venta sin dejar rastro es peor que no revertirla: al día
         * siguiente falta una orden que alguien recuerda haber hecho y no hay
         * nada que lo explique. El aviso va con severidad de advertencia porque
         * cada reversión aquí significa que un proceso se murió a mitad de una
         * venta — es un síntoma, no una limpieza rutinaria.
         */
        if (r.reverted > 0) {
          await writeAudit({
            companyId,
            action: "drafts_reconciled",
            entityType: "order",
            entityId: companyId,
            description: `Reconciliación automática: ${r.reverted} de ${r.scanned} venta(s) a medias revertidas`,
            severity: "warning",
            metadata: { ...r, ventana_minutos: VENTANA_MINUTOS },
          });
        }
      } catch (err) {
        // Una empresa con un problema no puede dejar a las demás con sus plazas
        // apartadas por ventas que no existieron.
        console.error(`[cron/reconcile-drafts] ${companyId} falló:`, err);
        fallidas.push(companyId);
      }
    }

    const report = {
      companies: empresas.size,
      scanned: revisadas,
      reverted: revertidas,
      failed: fallidas,
      window_minutes: VENTANA_MINUTOS,
      barrido,
      ranAt: new Date().toISOString(),
    };

    console.log(
      `[cron/reconcile-drafts] ${empresas.size} empresa(s) · ${revertidas} venta(s) a medias revertidas de ${revisadas}`
    );

    /**
     * Y SI SE REVIRTIÓ ALGO, ES UN INCIDENTE DE PLATAFORMA.
     *
     * Cada reversión es la huella de un proceso que se murió a mitad de una
     * venta. Apuntarlo solo en el resumen del trabajo lo dejaría en un JSON que
     * nadie abre; como incidente sale en la pantalla de salud y alguien puede
     * preguntarse por qué se están muriendo.
     */
    if (revertidas > 0) {
      await reportIncident({
        source: "cron:reconcile-drafts",
        error: `${revertidas} venta(s) quedaron a medias y se revirtieron: algún proceso murió durante la venta`,
        level: "warning",
        context: report,
      });
    }

    await finishJobRun(runId, { status: "ok", summary: report });
    return ok(report);
  } catch (err) {
    console.error("[cron/reconcile-drafts] error:", err);
    await finishJobRun(runId, { status: "failed", error: String(err) });
    await reportIncident({ source: "cron:reconcile-drafts", error: err });
    return fail(err);
  }
}
