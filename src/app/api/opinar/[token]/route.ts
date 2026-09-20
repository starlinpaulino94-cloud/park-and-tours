import { NextRequest, NextResponse } from "next/server";
import { fail, readJson } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { answerSurvey } from "@/lib/voice-service";

/**
 * POST /api/opinar/:token — el pasajero contesta la encuesta.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SIN SESIÓN Y SIN CSRF, COMO EL MOTOR PÚBLICO
 *
 * No hay sesión que robar: quien tiene el enlace contesta, y ese enlace se lo
 * mandamos nosotros a su correo. Exigirle una cuenta a alguien que acaba de
 * bajarse de una guagua es garantizar que no conteste nadie.
 *
 * Lo que lo hace aceptable es lo poco que ese token PUEDE hacer: poner una
 * nota, escribir un comentario y darse de baja. Nada que mueva dinero, nada que
 * enseñe datos de otro cliente, y caduca a los treinta días.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA BIFURCACIÓN NO SE DECIDE AQUÍ NI EN LA PANTALLA
 *
 * A quién se le enseña el botón de la reseña pública lo decide el servicio a
 * partir de la nota que acaba de guardar. Si lo decidiera el navegador,
 * cualquiera pediría la dirección de Google poniéndose un 10 en el inspector, y
 * la operadora acabaría con reseñas escritas por gente que puso un 2.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;

    // Generoso pero real: una persona contesta una vez, quizá dos si se
    // equivoca al enviar. Quien manda cien está probando tokens.
    await assertRateLimit({ key: rateLimitKey(req, "survey:answer"), limit: 20, windowMs: 3_600_000 });

    const body = await readJson<{
      nps?: unknown; ratingGuide?: unknown; ratingTransport?: unknown;
      ratingValue?: unknown; comment?: unknown;
    }>(req);

    const outcome = await answerSurvey(String(token ?? ""), {
      nps: Number(body?.nps),
      ratingGuide: numeroONada(body?.ratingGuide),
      ratingTransport: numeroONada(body?.ratingTransport),
      ratingValue: numeroONada(body?.ratingValue),
      comment: typeof body?.comment === "string" ? body.comment : null,
    });

    if (!outcome.ok) {
      /**
       * Un token que no existe y uno que ya se contestó se distinguen A
       * PROPÓSITO, y no es una fuga: el que tiene el enlace ya lo tiene. Decirle
       * «esto ya lo contestaste» en vez de «no existe» evita que crea que se
       * perdió su respuesta y la vuelva a escribir tres veces.
       */
      const status = outcome.reason === "not_found" ? 404 : outcome.reason === "invalid" ? 400 : 409;
      return NextResponse.json(
        { ok: false, error: { message: MENSAJE[outcome.reason ?? "not_found"], code: outcome.reason } },
        { status }
      );
    }

    return NextResponse.json({
      ok: true,
      data: { step: outcome.step, reviewUrl: outcome.reviewUrl ?? null },
    });
  } catch (err) {
    return fail(err);
  }
}

const MENSAJE: Record<string, string> = {
  not_found: "Este enlace no existe.",
  already_answered: "Ya nos diste tu opinión sobre este viaje. ¡Gracias!",
  expired: "Este enlace ya caducó. Si quieres contarnos algo, escríbenos.",
  not_asked: "Este enlace no está activo.",
  invalid: "La puntuación tiene que estar entre 0 y 10.",
};

function numeroONada(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
