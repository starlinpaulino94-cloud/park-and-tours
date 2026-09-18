import { NextRequest, NextResponse } from "next/server";
import { healthReport } from "@/lib/system-health-service";
import { atLeast, getTenantContext } from "@/lib/tenant";

/**
 * GET /api/health — ¿está el sistema en pie?
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE
 *
 * El enganche que emite la sesión estuvo roto horas y nadie podía entrar. Quien
 * se enteró fue un job de integración continua. No había ningún punto que
 * preguntar, así que tampoco había nada que vigilar desde fuera.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS RESPUESTAS, Y LA DIFERENCIA IMPORTA
 *
 * SIN CREDENCIAL devuelve solo el veredicto: `{ status, checked_at }`. Es lo que
 * necesita un vigilante externo —los que llaman cada minuto desde fuera— y es
 * todo lo que puede saber cualquiera: el detalle nombra la fontanería de dentro
 * (qué enganche, qué trabajo, cuántos incidentes) y eso no se le cuenta a quien
 * solo sabe la URL.
 *
 * CON CREDENCIAL —el secreto del cron, o una sesión de administrador— devuelve
 * las comprobaciones una por una.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL CÓDIGO HTTP TAMBIÉN ES LA RESPUESTA
 *
 * `down` sale con 503, no con 200. Un vigilante externo mira el código antes
 * que el cuerpo; devolver 200 con un `{"status":"down"}` dentro es exactamente
 * cómo una caída pasa inadvertida durante horas.
 *
 * `degraded` sale con 200: los avisos de cobro no salieron anoche y eso no
 * impide vender hoy. Si también despertara a alguien de madrugada, a la tercera
 * vez nadie miraría la alerta — y entonces tampoco vería la de verdad.
 */
export const dynamic = "force-dynamic";

async function puedeVerElDetalle(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") === `Bearer ${secret}`) return true;

  // Una sesión de administrador también vale: es quien va a mirar la pantalla
  // de estado. `getTenantContext` y no `requireTenant` porque aquí no tener
  // sesión no es un error — es el caso normal del vigilante externo.
  const ctx = await getTenantContext().catch(() => null);
  return Boolean(ctx && atLeast(ctx.role, "admin"));
}

export async function GET(req: NextRequest) {
  const report = await healthReport();
  const status = report.level === "down" ? 503 : 200;

  if (!(await puedeVerElDetalle(req))) {
    return NextResponse.json(
      { status: report.level, checked_at: report.checked_at },
      { status, headers: { "cache-control": "no-store" } }
    );
  }

  return NextResponse.json(report, { status, headers: { "cache-control": "no-store" } });
}
