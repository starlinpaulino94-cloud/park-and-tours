import { NextRequest } from "next/server";
import { requireTenant, requireTenantWrite, requireAtLeast, TenantError } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { supabaseService } from "@/lib/supabase/service";
import { createApiKey, maskedToken, type ApiScope } from "@/lib/api-keys";
import { writeAudit } from "@/lib/audit";

/**
 * Las llaves de API de la empresa: listar, emitir y revocar.
 *
 * Emitir una llave es entregar una credencial que vende en nombre de la
 * operadora y que va a vivir años en el servidor de otra empresa. Por eso pide
 * rol de administrador, queda en la bitácora con severidad crítica y el secreto
 * SE ENSEÑA UNA SOLA VEZ: si se pierde, se emite otra y se revoca la anterior.
 * Guardarlo para poder volver a enseñarlo sería guardar una contraseña en claro.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    requireAtLeast(ctx, "admin");
    await assertRateLimit({ key: rateLimitKey(req, "api-keys:list", ctx.userId), limit: 60, windowMs: 60_000 });

    const { data } = await supabaseService()
      .from("api_key")
      .select("id, name, prefix, scope, partner_id, last_used_at, revoked_at, created_at")
      .eq("organization_id", ctx.companyId)
      .order("created_at", { ascending: false })
      .limit(100);

    return ok((data ?? []).map((row) => ({
      _id: row.id,
      name: row.name,
      // Nunca el secreto: solo lo suficiente para saber cuál es cuál.
      token: maskedToken(row.prefix as string),
      scope: row.scope,
      partner_id: row.partner_id,
      last_used_at: row.last_used_at,
      revoked_at: row.revoked_at,
      createdAt: row.created_at,
    })));
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    requireAtLeast(ctx, "admin");
    await assertRateLimit({ key: rateLimitKey(req, "api-keys:create", ctx.userId), limit: 10, windowMs: 3_600_000 });

    const body = await readJson<{ name?: string; scope?: string; partner_id?: string | null }>(req);
    const name = (body.name || "").trim().slice(0, 80);
    if (!name) throw new TenantError("Ponle un nombre: «Web de Bávaro Tours», «Conector Viator».", 400);
    const scope: ApiScope = body.scope === "write" ? "write" : "read";

    const material = createApiKey();
    const { data, error } = await supabaseService()
      .from("api_key")
      .insert({
        organization_id: ctx.companyId,
        name,
        prefix: material.prefix,
        secret_hash: material.secretHash,
        scope,
        partner_id: body.partner_id || null,
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "api_key_created",
      entityType: "api_key", entityId: data.id as string,
      severity: "critical",
      description: `${ctx.email} emitió la llave «${name}» (${scope === "write" ? "lectura y escritura" : "solo lectura"})`,
      metadata: { name, scope, prefix: material.prefix },
    });

    return ok({
      _id: data.id,
      name,
      scope,
      // La única vez que el secreto existe fuera de la memoria de esta petición.
      token: material.token,
    });
  } catch (err) {
    return fail(err);
  }
}

/** DELETE /api/api-keys?id=… — revoca. No se borra: la bitácora la menciona. */
export async function DELETE(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    requireAtLeast(ctx, "admin");
    await assertRateLimit({ key: rateLimitKey(req, "api-keys:revoke", ctx.userId), limit: 30, windowMs: 60_000 });

    const id = req.nextUrl.searchParams.get("id") || "";
    if (!id) throw new TenantError("Falta la llave a revocar", 400);

    const { data, error } = await supabaseService()
      .from("api_key")
      .update({ revoked_at: new Date().toISOString() })
      // El filtro por empresa es lo que impide revocar la llave de otra.
      .eq("organization_id", ctx.companyId)
      .eq("id", id)
      .select("name")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new TenantError("Esa llave no existe en esta empresa", 404);

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "api_key_revoked",
      entityType: "api_key", entityId: id,
      severity: "critical",
      description: `${ctx.email} revocó la llave «${data.name}»`,
    });

    return ok({ revoked: true });
  } catch (err) {
    return fail(err);
  }
}
