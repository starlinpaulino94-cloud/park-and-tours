import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, esInterno, TenantError } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { enviarManifiesto } from "@/lib/manifiesto-envio-service";

/**
 * POST /api/departures/:id/manifest/enviar — mandarlo ahora, sin esperar al barrido.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACE FALTA ADEMÁS DEL BARRIDO
 *
 * El barrido corre una vez al día. Cuando se reasigna el vehículo a las cuatro
 * de la tarde, o entra un grupo de doce, la operadora no puede esperar a mañana:
 * necesita decir «mándalo otra vez» y que el chofer tenga la lista de ahora. La
 * huella de la lista hace que eso NO escriba dos veces a nadie si en realidad no
 * cambió nada — apretar el botón tres veces deja un mensaje.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUIÉN PUEDE
 *
 * Esto manda datos de clientes FUERA de la casa. Por eso pide rango de
 * operación y ser de dentro: un proveedor con sesión pidiendo que se mande el
 * manifiesto «a quien lo opera» se lo estaría mandando a sí mismo, de una salida
 * que no tiene por qué ser suya.
 *
 * La ventana de 36 horas NO se comprueba aquí sino dentro de
 * `enviarManifiesto`: una puerta que la comprobara por su cuenta sería la
 * segunda copia de la misma regla, y la segunda copia es la que un día dice otra
 * cosa.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    if (!esInterno(ctx)) throw new TenantError("El manifiesto lo manda la operación", 403);
    requireAtLeast(ctx, "operations");
    await assertRateLimit({
      key: rateLimitKey(req, "departures:manifest:enviar", ctx.userId), limit: 20, windowMs: 60_000,
    });

    const envio = await enviarManifiesto(ctx.company, ctx.companyId, id);

    /**
     * Se audita SIEMPRE, incluso cuando no salió nada.
     *
     * «Se mandó el manifiesto» y «se intentó y la salida ya había pasado» son
     * respuestas distintas a la misma pregunta —«¿por qué el chofer no lo
     * tenía?»— y sin el segundo caso en la bitácora la operadora no puede
     * distinguirlas.
     */
    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "manifest_dispatched",
      entityType: "departure", entityId: id,
      severity: envio.encolados > 0 ? "info" : "warning",
      description: envio.veto
        ? `${ctx.email} intentó mandar el manifiesto y no salió: ${envio.veto}`
        : `${ctx.email} mandó el manifiesto a ${envio.destinatarios.length} destinatario(s)`,
      metadata: {
        huella: envio.huella,
        encolados: envio.encolados,
        duplicados: envio.duplicados,
        veto: envio.veto,
        // Con el recorte de cada uno: es lo que permite responder «¿qué se le
        // entregó al transportista?» sin abrir la bandeja mensaje a mensaje.
        destinatarios: envio.destinatarios.map((d) => `${d.publico}:${d.nombre}`),
        sin_salida: envio.sinSalida,
      },
    });

    return ok(envio);
  } catch (err) {
    return fail(err);
  }
}
