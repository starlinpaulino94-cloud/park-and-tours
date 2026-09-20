import { NextRequest, NextResponse } from "next/server";
import { fail } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { optOutByToken } from "@/lib/voice-service";

/**
 * POST /api/opinar/:token/baja — «no me mandéis más encuestas».
 *
 * Un clic, sin cuenta y sin llamar a nadie. Una baja que obliga a escribir un
 * correo no es una baja: es un formulario para que el cliente desista.
 *
 * SILENCIA LAS ENCUESTAS, NO EL VIAJE. El recordatorio de la víspera lleva la
 * hora y el lugar de recogida, y es parte de lo que el cliente compró: darle de
 * baja de eso sería dejarlo tirado en el lobby del hotel a las seis de la
 * mañana. Por eso la columna se llama `survey_opt_out` y no `no_email`.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    await assertRateLimit({ key: rateLimitKey(req, "survey:optout"), limit: 20, windowMs: 3_600_000 });

    const done = await optOutByToken(String(token ?? ""));
    // Un token que no existe se contesta igual que uno que sí: quien pide no
    // recibir más correos no tiene por qué recibir un error a cambio.
    return NextResponse.json({ ok: true, data: { done } });
  } catch (err) {
    return fail(err);
  }
}
