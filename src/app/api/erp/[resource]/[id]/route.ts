import { NextRequest } from "next/server";
import { requireTenant, tenantFindOne, tenantUpdate, tenantDelete, requireAtLeast, TenantError } from "@/lib/tenant";
import { getResource, sanitizePayload } from "@/lib/resources";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";

type Params = { params: Promise<{ resource: string; id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { resource, id } = await params;
    const def = getResource(resource);
    if (!def) throw new TenantError(`Recurso desconocido: ${resource}`, 404);

    const ctx = await requireTenant();
    const record = await tenantFindOne(ctx.companyId, def.table, id, def.expandOne || def.expand || {});
    return ok(record);
  } catch (err) {
    return fail(err);
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const { resource, id } = await params;
    const def = getResource(resource);
    if (!def) throw new TenantError(`Recurso desconocido: ${resource}`, 404);
    if (def.writable.length === 0) throw new TenantError("Este recurso es de solo lectura", 405);

    const ctx = await requireTenant();
    if (def.writeRole) requireAtLeast(ctx, def.writeRole);

    const body = await readJson(req);
    const payload = sanitizePayload(def, body);
    if (Object.keys(payload).length === 0) throw new TenantError("No se enviaron datos válidos", 400);

    const updated = await tenantUpdate(ctx.companyId, def.table, id, payload);
    console.log(`[api] ${ctx.email} actualizó ${def.table}/${id}`);
    return ok(updated);
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { resource, id } = await params;
    const def = getResource(resource);
    if (!def) throw new TenantError(`Recurso desconocido: ${resource}`, 404);

    const ctx = await requireTenant();
    requireAtLeast(ctx, def.writeRole === "seller" ? "manager" : def.writeRole || "manager");

    await tenantDelete(ctx.companyId, def.table, id);
    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "record_deleted", entityType: def.table, entityId: id,
      description: `${ctx.email} eliminó ${def.table}/${id}`,
      severity: "warning",
    });
    return ok({ deleted: true, id });
  } catch (err) {
    return fail(err);
  }
}
