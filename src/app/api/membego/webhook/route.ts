import { NextRequest, NextResponse } from "next/server";
import { verifyMembegoWebhook, parseMembegoEvent } from "@/lib/membego";
import { membegoSecret, linkByCompany, applyMembegoEvent } from "@/lib/membego-service";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { fail } from "@/lib/api-response";

export const dynamic = "force-dynamic";

/**
 * POST /api/membego/webhook — los eventos que MembeGo empuja hacia acá.
 *
 * MembeGo notifica registros de clientes, visitas, compras, membresías y
 * referidos con un sobre firmado (`X-Membego-Firma` = HMAC-SHA256 hex del
 * CUERPO CRUDO). Las reglas del contrato que este handler cumple al pie:
 *
 *   · La firma se verifica sobre `req.text()` TAL CUAL llegó. Parsear y
 *     re-serializar el JSON produce, tarde o temprano, otra cadena y una
 *     firma que no cuadra — por eso aquí no hay `readJson`.
 *   · Idempotencia por el id del sobre: `applyMembegoEvent` inserta la fila
 *     de `membego_event` (clave primaria) ANTES de tocar nada; el reintento
 *     choca ahí y responde 200 sin repetir el efecto.
 *   · Un tipo desconocido responde 200 y se ignora: MembeGo añadirá eventos
 *     y un satélite que devuelva error por eso acabaría en su DEAD_LETTER.
 *   · Responder rápido (<10 s) y 2xx; un error nuestro responde 5xx para que
 *     su cola reintente (8 intentos horarios).
 *
 * Una empresa SIN vínculo responde 503: es el caso «webhook configurado antes
 * del primer SSO del administrador», y el reintento horario de MembeGo lo
 * resuelve solo en cuanto el vínculo exista. Un 200 aquí tiraría el evento; un
 * 4xx lo mandaría a DEAD_LETTER — ambos pierden datos por una carrera normal
 * del alta.
 *
 * NO lleva `assertSameOriginMutation`: lo firma una máquina de otro origen, y
 * la firma HMAC es exactamente la prueba de identidad que el CSRF aproxima.
 * Tampoco exige sesión: `/api/*` no pasa por el middleware de auth, y el
 * servicio filtra por la organización DEL VÍNCULO en cada consulta.
 */
export async function POST(req: NextRequest) {
  try {
    // Ancho de banda razonable para una cola con reintentos, corto para un
    // atacante probando firmas a ciegas.
    assertRateLimit({ key: rateLimitKey(req, "membego-webhook"), limit: 120, windowMs: 60_000 });

    const secret = membegoSecret();
    if (!secret) {
      console.error("[membego/webhook] MEMBEGO_SECRETO no está configurado en el entorno");
      return NextResponse.json({ ok: false, error: "No configurado" }, { status: 503 });
    }

    const rawBody = await req.text();
    if (!verifyMembegoWebhook(rawBody, req.headers.get("x-membego-firma"), secret)) {
      console.warn("[membego/webhook] firma inválida o ausente");
      return NextResponse.json({ ok: false, error: "Firma inválida" }, { status: 401 });
    }

    const event = parseMembegoEvent(rawBody);
    if (!event) {
      // Firmado pero ininteligible: reintentarlo daría lo mismo. A registro y 400.
      console.error("[membego/webhook] sobre sin id/tipo/companyId:", rawBody.slice(0, 300));
      return NextResponse.json({ ok: false, error: "Sobre inválido" }, { status: 400 });
    }

    const link = await linkByCompany(event.companyId);
    if (!link) {
      console.warn(`[membego/webhook] empresa sin vínculo todavía: ${event.companyId} (evento ${event.id})`);
      return NextResponse.json(
        { ok: false, error: "Empresa aún no vinculada; reintentar" },
        { status: 503 }
      );
    }
    if (link.status !== "active") {
      // Suspendido a propósito: no procesar, y 503 para que el evento espere
      // en la cola de MembeGo por si el vínculo se reactiva.
      console.warn(`[membego/webhook] vínculo suspendido: ${event.companyId} (evento ${event.id})`);
      return NextResponse.json({ ok: false, error: "Vínculo suspendido" }, { status: 503 });
    }

    const outcome = await applyMembegoEvent(link, event);
    return NextResponse.json({ ok: true, data: { id: event.id, ...outcome } });
  } catch (err) {
    // 5xx: que la cola de MembeGo reintente. El detalle queda en el log y, si
    // el fallo fue aplicando efectos, también en la fila de membego_event.
    console.error("[membego/webhook] error:", err);
    return fail(err);
  }
}
