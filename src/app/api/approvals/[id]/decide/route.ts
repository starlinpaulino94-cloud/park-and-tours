import { NextRequest } from "next/server";
import { requireTenant } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { decide } from "@/lib/approvals";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireTenant();
    const { id } = await params;
    const body = await readJson<{ action: "approve" | "reject"; comment?: string }>(req);
    const row = await decide(ctx, id, body.action, body.comment);
    return ok(row);
  } catch (err) {
    console.error("[api/approvals/decide] error:", err);
    return fail(err);
  }
}
