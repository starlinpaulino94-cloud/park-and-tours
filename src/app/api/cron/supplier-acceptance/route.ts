import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api-response";
import { startJobRun, finishJobRun, reportIncident } from "@/lib/system-health-service";
import { TenantError } from "@/lib/tenant";
import { barrerVencimientos, empresasConPlazosVencidos } from "@/lib/respuesta-proveedor";

/**
 * GET /api/cron/supplier-acceptance
 *
 * Cierra los plazos de respuesta que ya vencieron: los marca y avisa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DIARIO, Y ESO ACOTA LO QUE ESTO PUEDE PROMETER
 *
 * Querría ser horario: el plazo por defecto son veinticuatro horas y nunca pasa
 * de la hora de la salida, así que un barrido diario puede enterarse de un
 * plazo vencido a las diez cuando el autobús ya salió. Pero el plan de Vercel
 * en el que esto corre solo admite trabajos diarios —un cron más frecuente NO
 * DESPLIEGA, y tumba el despliegue entero, no solo el cron—, y hay una guarda
 * que lo comprueba desde que pasó.
 *
 * Así que lo que este trabajo da es el ESTADO al día y el aviso de la mañana,
 * no una alarma inmediata. Si algún día la cuenta admite frecuencias menores,
 * subirlo a cada hora es cambiar una línea de `vercel.json` y la expectativa de
 * `system-health`; lo de abajo ya no depende de ello.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y NINGUNA LECTURA DEPENDE DE ESTO
 *
 * Mismo criterio que la caducidad de aprobaciones: `puedeResponder` compara el
 * plazo con el reloj en cada consulta, así que un cron caído NO permite
 * contestar tarde. Lo único que se pierde si esto no corre es que el estado
 * guardado y el aviso lleguen tarde; nunca que alguien acepte un servicio
 * fuera de plazo.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  let runId: string | null = null;
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new TenantError("CRON_SECRET no está configurado en el entorno", 503);
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      console.warn("[cron/supplier-acceptance] intento de ejecución sin credencial válida");
      throw new TenantError("No autorizado", 401);
    }

    runId = await startJobRun("supplier-acceptance");

    const ahora = new Date();
    const empresas = await empresasConPlazosVencidos(ahora);
    let vencidos = 0;
    let aceptadosPorSilencio = 0;
    for (const companyId of empresas) {
      // El MISMO instante para todas: leyendo el reloj por empresa, una que
      // tarde en procesarse aplicaría un corte distinto al de la anterior.
      const parcial = await barrerVencimientos(companyId, ahora);
      vencidos += parcial.vencidos;
      aceptadosPorSilencio += parcial.aceptadosPorSilencio;
    }

    await finishJobRun(runId, {
      status: "ok",
      summary: { empresas: empresas.length, vencidos, aceptadosPorSilencio },
    });
    return ok({ empresas: empresas.length, vencidos, aceptadosPorSilencio, ranAt: ahora.toISOString() });
  } catch (err) {
    console.error("[cron/supplier-acceptance] error:", err);
    await finishJobRun(runId, { status: "failed", error: String(err) });
    await reportIncident({ source: "cron:supplier-acceptance", error: err });
    return fail(err);
  }
}
