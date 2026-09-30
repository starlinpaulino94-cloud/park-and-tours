import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { trialBalance } from "@/lib/ledger";

/**
 * GET /api/ledger/trial-balance[?period=AAAA-MM]
 *
 * El informe que existe para demostrar que los libros cuadran. Sin `period`
 * suma toda la historia.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ VIAJAN `entries` Y `truncated`
 *
 * El motor los devuelve a propósito y esta ruta los tiraba. `trialBalance`
 * pagina y se rinde en un techo de 200 000 asientos; pasado ese techo el
 * informe está INCOMPLETO y, aun así, `balanced` puede salir `true` —los
 * débitos y créditos de lo que sí se leyó cuadran entre ellos—. Un informe
 * recortado que dice «cuadrado» es peor que uno que falla: es el único papel
 * con el que se cierra un mes.
 *
 * Y `entries` es la cifra contra la que se contrasta el total: un «cuadrado»
 * sin saber sobre cuántos asientos se calculó no se puede verificar con nada.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    requireAtLeast(ctx, "manager");
    const period = req.nextUrl.searchParams.get("period") || undefined;
    const result = await trialBalance(ctx.companyId, period);
    return ok(result.rows, {
      totals: result.totals,
      balanced: result.balanced,
      entries: result.entries,
      truncated: result.truncated,
    });
  } catch (err) {
    console.error("[api/ledger/trial-balance] error:", err);
    return fail(err);
  }
}
