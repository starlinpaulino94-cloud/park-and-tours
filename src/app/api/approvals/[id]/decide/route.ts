import { NextRequest } from "next/server";
import { requireTenant, TenantError } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { decide } from "@/lib/approvals";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";

/**
 * POST /api/approvals/:id/decide
 *
 * Única vía para aprobar o rechazar. `decide` revalida en servidor el rango
 * mínimo según la acción, la autoaprobación, la expiración y que la segunda
 * firma sea de otra persona; además deja registro en auditoría.
 *
 * Body: { action: "approve" | "reject", comment?: string }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Es la mutación financiera más sensible de la aplicación y era la única
    // que no comprobaba el origen ni tenía límite de tasa.
    assertSameOriginMutation(req);

    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, "approvals:decide", ctx.userId), limit: 30, windowMs: 60_000 });

    const { id } = await params;
    const body = await readJson<{ action: "approve" | "reject"; comment?: string }>(req);

    if (body.action !== "approve" && body.action !== "reject") {
      throw new TenantError("Indica si apruebas o rechazas la solicitud", 400);
    }
    // Rechazar sin explicar por qué deja al solicitante sin nada accionable.
    if (body.action === "reject" && !body.comment?.trim()) {
      throw new TenantError("Indica el motivo del rechazo", 400);
    }

    const row = await decide(ctx, id, body.action, body.comment);
    return ok(row);
  } catch (err) {
    console.error("[api/approvals/decide] error:", err);
    return fail(err);
  }
}
