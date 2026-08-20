import { NextRequest } from "next/server";
import { requireTenant } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { requestApproval, pendingFor, type RequestInput } from "@/lib/approvals";

export async function GET() {
  try {
    const ctx = await requireTenant();
    const rows = await pendingFor(ctx);
    return ok(rows, { total: rows.length });
  } catch (err) {
    console.error("[api/approvals] GET error:", err);
    return fail(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    const body = await readJson<RequestInput>(req);
    const row = await requestApproval(ctx, body);
    return ok(row);
  } catch (err) {
    console.error("[api/approvals] POST error:", err);
    return fail(err);
  }
}
