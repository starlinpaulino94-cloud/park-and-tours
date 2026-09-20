import { NextRequest } from "next/server";
import { requireTenant, requireTenantWrite } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { joinWaitlist, loadWaitlist } from "@/lib/waitlist-service";

/**
 * GET /api/waitlist?departure=<id> — la cola de una salida.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    const departure = req.nextUrl.searchParams.get("departure");
    if (!departure) {
      throw Object.assign(new Error("Falta la salida cuya lista se pide"), { status: 400 });
    }
    return ok(await loadWaitlist(ctx.companyId, departure));
  } catch (err) {
    return fail(err);
  }
}

/**
 * POST /api/waitlist — apuntar a alguien en la cola.
 *
 * El caso que justifica el módulo: el cliente está delante del mostrador, la
 * salida está llena, y la alternativa es que se vaya sin dejar rastro.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    await assertRateLimit({
      key: rateLimitKey(req, "waitlist:join", ctx.userId),
      limit: 60, windowMs: 60_000,
    });
    const body = await readJson<Parameters<typeof joinWaitlist>[1]>(req);
    return ok(await joinWaitlist(ctx, body));
  } catch (err) {
    return fail(err);
  }
}
