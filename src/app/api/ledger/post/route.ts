import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertModule } from "@/lib/plan-service";
import { post, reverse, type PostingInput } from "@/lib/ledger";
import { assertSameOriginMutation } from "@/lib/csrf";
import { writeAudit } from "@/lib/audit";

export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    assertModule(ctx, "accounting");
    requireAtLeast(ctx, "manager");
    const body = await readJson<PostingInput & { reverseEntry?: string }>(req);

    if (body.reverseEntry) {
      const result = await reverse(ctx.companyId, body.reverseEntry, ctx.userId);
      await writeAudit({
        companyId: ctx.companyId, userId: ctx.userId,
        action: "ledger_entry_reversed", entityType: "ledger_entry", entityId: body.reverseEntry,
        description: `${ctx.email} revirtió un asiento contable`, severity: "warning",
      });
      return ok(result);
    }
    const result = await post(ctx.companyId, { ...body, userId: ctx.userId });
    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "ledger_entry_posted", entityType: "ledger_entry",
      description: `${ctx.email} registró un asiento contable`,
      metadata: { origen: body.source },
    });
    return ok(result);
  } catch (err) {
    console.error("[api/ledger/post] error:", err);
    return fail(err);
  }
}
