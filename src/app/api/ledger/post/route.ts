import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertModule } from "@/lib/plan-service";
import { post, reverse, type PostingInput } from "@/lib/ledger";
import { assertSameOriginMutation } from "@/lib/csrf";

export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    assertModule(ctx, "accounting");
    requireAtLeast(ctx, "manager");
    const body = await readJson<PostingInput & { reverseEntry?: string }>(req);

    if (body.reverseEntry) {
      const result = await reverse(ctx.companyId, body.reverseEntry, ctx.userId);
      return ok(result);
    }
    const result = await post(ctx.companyId, { ...body, userId: ctx.userId });
    return ok(result);
  } catch (err) {
    console.error("[api/ledger/post] error:", err);
    return fail(err);
  }
}
