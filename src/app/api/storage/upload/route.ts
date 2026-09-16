import { NextRequest } from "next/server";
import { requireAtLeast, requireTenantWrite, tenantFindOne } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import {
  BUCKETS, type BucketKey, assertUploadable, objectPath, partnerObjectPath,
  uploadObject, signedUrl, publicUrl,
} from "@/lib/supabase/storage";
import { TenantError } from "@/lib/tenant";
import { assertSameOriginMutation } from "@/lib/csrf";
import { RESOURCES } from "@/lib/resources";
import { assertWithinLimit, addStorageUsage } from "@/lib/plan-service";

/**
 * POST /api/storage/upload  (M4)
 * Multipart: file, bucket ('public'|'private'), entity, id.
 * The object path is derived SERVER-SIDE from the caller's org (and partner_id
 * for partner-role users) — the client cannot choose the tenant prefix, so it
 * can never write into another tenant's space. RLS (0016) is the backstop.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();

    const form = await req.formData();
    const file = form.get("file");
    const bucketKey = String(form.get("bucket") || "private") as BucketKey;
    const entity = String(form.get("entity") || "misc").replace(/[^a-z0-9_-]/gi, "");
    const id = String(form.get("id") || "general").replace(/[^a-z0-9_-]/gi, "");

    if (!(file instanceof File)) throw new TenantError("Falta el archivo", 400);
    if (!(bucketKey in BUCKETS)) throw new TenantError("Bucket inválido", 400);
    if (!entity || !id || id === "general") throw new TenantError("Entidad de destino inválida", 400);
    const resource = RESOURCES[entity];
    if (!resource) throw new TenantError("Entidad de destino no permitida", 400);
    if (bucketKey === "public") requireAtLeast(ctx, "manager");
    await tenantFindOne(ctx.companyId, resource.table, id);
    assertUploadable({ size: file.size, type: file.type });
    // El techo se mide en MB enteros hacia arriba: un archivo de 0,4 MB con
    // 0 MB de hueco tiene que ser rechazado, no colado por redondeo a la baja.
    await assertWithinLimit(ctx, "max_storage_mb", Math.max(1, Math.ceil(file.size / (1024 * 1024))));

    // Partner-role users write only under their own partner folder.
    const path = ctx.role === "partner" && ctx.partnerId
      ? partnerObjectPath(ctx.companyId, ctx.partnerId, entity, file.name)
      : objectPath(ctx.companyId, entity, id, file.name);

    const buf = await file.arrayBuffer();
    await uploadObject(bucketKey, path, buf, file.type || undefined);

    // Se acumula DESPUÉS de subir: contar antes cobraría por un archivo que
    // quizá no llegó. Es best-effort y no puede tumbar la respuesta.
    await addStorageUsage(ctx.companyId, file.size);

    const url = bucketKey === "public"
      ? await publicUrl(bucketKey, path)
      : await signedUrl(bucketKey, path, 600);

    return ok({ path, bucket: BUCKETS[bucketKey], url });
  } catch (err) {
    return fail(err);
  }
}
