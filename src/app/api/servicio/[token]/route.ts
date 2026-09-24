import { NextRequest, NextResponse } from "next/server";
import { fail, readJson } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import {
  abrirEnlace, responderConEnlace, MENSAJE_DEL_ENLACE,
  type Respuesta,
} from "@/lib/respuesta-proveedor";

/**
 * EL ENLACE DE UN CLIC DEL PROVEEDOR.
 *
 *   GET  /api/servicio/:token — qué servicio es y si admite respuesta.
 *   POST /api/servicio/:token — aceptar o rechazar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SIN SESIÓN, COMO LA ENCUESTA — Y CON MÁS CUIDADO QUE ELLA
 *
 * No hay cuenta que exigir: un transportista con cuatro guaguas no mantiene una
 * sesión abierta en el móvil, y la alternativa real no es que entre al portal,
 * es que conteste por WhatsApp y alguien de la casa lo escriba a mano.
 *
 * Lo que lo hace aceptable NO es lo mismo que en la encuesta. Allí el token
 * pone una nota a un viaje que ya pasó. Aquí compromete a una empresa a poner
 * un autobús, así que el enlace es ancho (treinta y dos bytes), se guarda solo
 * su huella, es de un solo uso, está atado a ESA fila, caduca con la salida y
 * se revoca al reasignar. Y cada apertura queda anotada, incluida la de un
 * token que no existe: cuarenta aperturas fallidas desde la misma dirección son
 * alguien probando.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL LÍMITE ES POR DIRECCIÓN, Y ESTRECHO
 *
 * Es la única defensa contra el que prueba tokens, porque aquí no hay usuario
 * al que atar el contador. Un proveedor abre su enlace una vez y contesta una
 * vez; quien pide cien está haciendo otra cosa.
 */

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    await assertRateLimit({ key: rateLimitKey(req, "supplier:link:open"), limit: 30, windowMs: 3_600_000 });

    const vista = await abrirEnlace(String(token ?? ""));
    if (!vista.ok) {
      /**
       * El servicio se DEVUELVE igual cuando lo hay: quien abre el enlace
       * después de contestar tiene derecho a ver qué contestó y con qué número,
       * en vez de una pantalla que solo dice que no.
       */
      return NextResponse.json(
        {
          ok: false,
          data: vista.servicio ? { servicio: vista.servicio } : undefined,
          error: { message: MENSAJE_DEL_ENLACE[vista.motivo ?? "not_found"], code: vista.motivo },
        },
        { status: vista.motivo === "not_found" ? 404 : 409 }
      );
    }
    return NextResponse.json({ ok: true, data: { servicio: vista.servicio } });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    await assertRateLimit({ key: rateLimitKey(req, "supplier:link:answer"), limit: 20, windowMs: 3_600_000 });

    const body = await readJson<{ respuesta?: unknown; nota?: unknown }>(req);
    const respuesta = String(body?.respuesta ?? "") as Respuesta;
    if (respuesta !== "accepted" && respuesta !== "rejected") {
      return NextResponse.json(
        { ok: false, error: { message: "La respuesta solo puede ser aceptar o rechazar", code: "invalid" } },
        { status: 400 }
      );
    }
    const nota = typeof body?.nota === "string" ? body.nota.trim().slice(0, 500) || null : null;

    const hecho = await responderConEnlace(String(token ?? ""), respuesta, nota);
    if (!hecho.ok) {
      return NextResponse.json(
        { ok: false, error: { message: MENSAJE_DEL_ENLACE[hecho.motivo ?? "not_found"], code: hecho.motivo } },
        { status: hecho.motivo === "not_found" ? 404 : 409 }
      );
    }
    return NextResponse.json({
      ok: true,
      data: { answer: hecho.answer, confirmation_number: hecho.confirmation_number ?? null },
    });
  } catch (err) {
    return fail(err);
  }
}
