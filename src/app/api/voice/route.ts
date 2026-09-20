import { NextRequest } from "next/server";
import { requireTenant } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { loadVoice } from "@/lib/voice-service";

/**
 * GET /api/voice?days=90 — la reputación de la operadora.
 *
 * Con sesión, al revés que todo lo demás de este módulo: aquí quien pregunta es
 * la operadora y la RLS hace de segunda frontera por debajo del filtro.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    const raw = Number(req.nextUrl.searchParams.get("days"));
    // Acotado: una ventana de diez años traería veinte mil filas para pintar
    // cuatro números.
    const days = Number.isFinite(raw) && raw >= 7 && raw <= 730 ? Math.round(raw) : 90;
    return ok(await loadVoice(ctx.companyId, days));
  } catch (err) {
    return fail(err);
  }
}
