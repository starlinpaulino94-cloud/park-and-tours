import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { post, reverse, type PostingInput } from "@/lib/ledger";

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenant();
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
