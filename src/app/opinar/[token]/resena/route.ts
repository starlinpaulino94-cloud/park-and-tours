import { NextRequest, NextResponse } from "next/server";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { loadSurvey, markReviewClicked } from "@/lib/voice-service";
import { supabaseService } from "@/lib/supabase/service";
import { mustRead } from "@/lib/supabase/io";

/**
 * GET /opinar/:token/resena — el salto a la reseña pública.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO ES UN ENLACE DIRECTO A GOOGLE
 *
 * Porque entonces no se sabría nunca cuántos de los que dijeron «un 10» llegan
 * de verdad a escribirla, que es la única cifra que dice si el embudo funciona.
 * Con este salto en medio, el panel puede contestar «de 40 promotores, 9
 * escribieron», y con eso se decide si el texto del botón sirve o no.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SOLO SALTA QUIEN YA PUSO UN 9 O UN 10
 *
 * La dirección no se entrega por tener el enlace: se comprueba la nota que hay
 * escrita en la fila. Si bastara con conocer la URL, cualquiera —incluido quien
 * puso un 2— llegaría a la reseña pública desde el mismo correo.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const home = new URL("/", req.url);

  try {
    await assertRateLimit({ key: rateLimitKey(req, "survey:review"), limit: 60, windowMs: 3_600_000 });
  } catch {
    return NextResponse.redirect(home, 302);
  }

  try {
    const survey = await loadSurvey(String(token ?? ""));
    if (!survey) return NextResponse.redirect(home, 302);

    // Contestada y promotora: las dos condiciones, leídas de la base.
    if (survey.status !== "answered" || Number(survey.nps ?? -1) < 9) {
      return NextResponse.redirect(new URL(`/opinar/${encodeURIComponent(token)}`, req.url), 302);
    }

    const company = await mustRead<{ review_url: string | null }>(
      "leer la dirección de reseñas de la empresa",
      supabaseService().from("organizations").select("review_url").eq("id", survey.companyId).maybeSingle()
    );
    const destino = (company?.review_url ?? "").trim();
    if (!destino) return NextResponse.redirect(home, 302);

    await markReviewClicked(String(token));
    return NextResponse.redirect(destino, 302);
  } catch {
    // Que no se pueda anotar el clic no puede impedirle dejar la reseña; lo que
    // no se hace es mandarlo a una dirección que no se pudo comprobar.
    return NextResponse.redirect(home, 302);
  }
}
