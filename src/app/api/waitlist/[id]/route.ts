import { NextRequest } from "next/server";
import { requireTenantWrite } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { leaveWaitlist } from "@/lib/waitlist-service";

/**
 * DELETE /api/waitlist/:id — dar de baja una espera.
 *
 * No se borra la fila: se marca. Lo que una persona decidió tiene que quedar,
 * porque es parte de la cuenta de cuánta demanda se perdió y por qué.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenantWrite();
    const body = await readJson<{ reason?: string }>(req);
    await leaveWaitlist(ctx, id, body.reason ?? null);
    return ok({ id, status: "cancelled" });
  } catch (err) {
    return fail(err);
  }
}
