import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { writeAudit } from "@/lib/audit";
import { membegoStatus, setLinkStatus, unlinkOrganization } from "@/lib/membego-service";

/**
 * GET  /api/membego/status — el estado de la integración para el panel:
 *      si hay secreto configurado, el vínculo, cuánta gente entró por SSO,
 *      cuántos clientes se han sincronizado y los últimos eventos.
 * POST /api/membego/status — administra el vínculo:
 *      { action: "suspend" | "reactivate" | "unlink" }
 *
 * Solo administración: el vínculo decide quién puede ENTRAR a esta
 * organización desde otra plataforma, así que se gobierna con el mismo rango
 * que las membresías. A diferencia del webhook y del SSO, aquí SÍ hay sesión
 * — es la pantalla de un usuario — y por eso vuelven las guardas de siempre.
 */
export async function GET() {
  try {
    const ctx = await requireTenant();
    requireAtLeast(ctx, "admin");
    return ok(await membegoStatus(ctx.companyId));
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenant();
    requireAtLeast(ctx, "admin");

    const body = await readJson<{ action?: string }>(req);
    const action = body.action || "";

    if (action === "suspend" || action === "reactivate") {
      const link = await setLinkStatus(ctx.companyId, action === "suspend" ? "suspended" : "active");
      await writeAudit({
        companyId: ctx.companyId, userId: ctx.userId,
        action: action === "suspend" ? "membego_suspended" : "membego_reactivated",
        entityType: "membego",
        description: action === "suspend"
          ? `Integración con MembeGo suspendida (empresa ${link.membego_company_id})`
          : `Integración con MembeGo reactivada (empresa ${link.membego_company_id})`,
        severity: "warning",
      });
      return ok(link);
    }

    if (action === "unlink") {
      await unlinkOrganization(ctx.companyId);
      await writeAudit({
        companyId: ctx.companyId, userId: ctx.userId,
        action: "membego_unlinked",
        entityType: "membego",
        description: "Vínculo con MembeGo eliminado; los datos sincronizados se conservan",
        severity: "warning",
      });
      return ok({ unlinked: true });
    }

    throw Object.assign(new Error("Acción no reconocida: usa suspend, reactivate o unlink"), { status: 400 });
  } catch (err) {
    return fail(err);
  }
}
