import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { requireTenant, requireAtLeast, TenantError } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { totalumSdk } from "@/lib/totalum";
import { writeAudit } from "@/lib/audit";
import type { AppRole } from "@/lib/auth";

/**
 * Team management for a tenant. The `user` table scopes by `company_id`
 * (not `company`), so these queries cannot go through the generic tenant helpers.
 */

const ASSIGNABLE_ROLES: AppRole[] = ["owner", "admin", "manager", "operations", "cashier", "seller", "partner"];

function assertRole(role: string): AppRole {
  if (!ASSIGNABLE_ROLES.includes(role as AppRole)) {
    throw new TenantError(`Rol no válido: ${role}`, 400);
  }
  return role as AppRole;
}

/** GET /api/team — usuarios de la empresa con su rol y su vínculo comercial. */
export async function GET() {
  try {
    const ctx = await requireTenant();
    requireAtLeast(ctx, "manager");

    const res = await totalumSdk.crud.query("user", {
      _filter: { company_id: ctx.companyId },
      _sort: { createdAt: "desc" },
      _limit: 300,
      partner_id: true,
      branch: true,
    });
    if (res.errors) {
      console.error("[team] error listando usuarios:", res.errors);
      throw new Error(res.errors.errorMessage || "Error listando los usuarios");
    }

    const users = (res.data || []) as any[];
    console.log(`[team] ${users.length} usuarios de la empresa ${ctx.companyId}`);
    return ok(users, { total: users.length });
  } catch (err) {
    return fail(err);
  }
}

/** POST /api/team — crea una cuenta y la vincula a esta empresa. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    requireAtLeast(ctx, "admin");

    const body = await readJson<{
      email?: string; name?: string; password?: string; role?: string;
      partner_id?: string | null; branch?: string | null; phone?: string | null;
    }>(req);

    const email = (body.email || "").trim().toLowerCase();
    const name = (body.name || "").trim();
    const password = body.password || "";
    if (!email || !name) throw new TenantError("El nombre y el email son obligatorios", 400);
    if (password.length < 8) throw new TenantError("La contraseña debe tener al menos 8 caracteres", 400);

    const role = assertRole(body.role || "seller");
    if (role === "partner" && !body.partner_id) {
      throw new TenantError("Un usuario de portal necesita el partner al que pertenece", 400);
    }

    const existing = await totalumSdk.crud.query("user", { _filter: { email }, _limit: 1 });
    if (existing.errors) {
      console.error("[team] error comprobando el email:", existing.errors);
      throw new Error(existing.errors.errorMessage || "Error comprobando el email");
    }
    if ((existing.data || []).length > 0) {
      throw new TenantError("Ya existe una cuenta con ese email", 409);
    }

    // Better Auth owns password hashing; we never write credentials ourselves.
    const created = await auth.api.signUpEmail({ body: { email, name, password } });
    const newUserId = (created as any)?.user?.id;
    if (!newUserId) {
      console.error("[team] Better Auth no devolvió el usuario creado:", created);
      throw new Error("No se pudo crear la cuenta");
    }

    const patch: Record<string, unknown> = {
      company_id: ctx.companyId,
      role,
      status: "active",
      phone: body.phone || undefined,
      partner_id: role === "partner" ? body.partner_id : null,
      branch: body.branch || null,
    };
    const updated = await totalumSdk.crud.editRecordById("user", newUserId, patch);
    if (updated.errors) {
      console.error("[team] error vinculando el usuario a la empresa:", updated.errors);
      throw new Error(updated.errors.errorMessage || "La cuenta se creó pero no se pudo vincular a la empresa");
    }

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId, action: "team_member_created",
      entityType: "user", entityId: newUserId, severity: "warning",
      description: `${ctx.email} creó el usuario ${email} con rol ${role}`,
    });

    console.log(`[team] usuario ${email} creado con rol ${role} en ${ctx.companyId}`);
    return ok({ _id: newUserId, email, name, role });
  } catch (err) {
    return fail(err);
  }
}

/** PUT /api/team — cambia rol, estado o vínculo de un usuario de la empresa. */
export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    requireAtLeast(ctx, "admin");

    const body = await readJson<{
      user_id?: string; role?: string; status?: string;
      partner_id?: string | null; branch?: string | null; phone?: string | null; name?: string;
    }>(req);
    if (!body.user_id) throw new TenantError("Falta el identificador del usuario", 400);

    // Never let one tenant touch another tenant's account.
    const target = await totalumSdk.crud.query("user", {
      _filter: { _id: body.user_id, company_id: ctx.companyId }, _limit: 1,
    });
    if (target.errors) {
      console.error("[team] error cargando el usuario:", target.errors);
      throw new Error(target.errors.errorMessage || "Error cargando el usuario");
    }
    const user = (target.data || [])[0] as any;
    if (!user) throw new TenantError("Usuario no encontrado en esta empresa", 404);

    if (body.user_id === ctx.userId && body.role && body.role !== ctx.role) {
      throw new TenantError("No puedes cambiar tu propio rol", 400);
    }
    if (body.user_id === ctx.userId && body.status && body.status !== "active") {
      throw new TenantError("No puedes desactivar tu propia cuenta", 400);
    }

    const patch: Record<string, unknown> = {};
    if (body.role) patch.role = assertRole(body.role);
    if (body.status) patch.status = body.status;
    if (body.name !== undefined) patch.name = body.name;
    if (body.phone !== undefined) patch.phone = body.phone || null;
    if (body.branch !== undefined) patch.branch = body.branch || null;
    if (body.partner_id !== undefined) patch.partner_id = body.partner_id || null;
    if (patch.role === "partner" && !patch.partner_id && !user.partner_id) {
      throw new TenantError("Un usuario de portal necesita el partner al que pertenece", 400);
    }
    if (Object.keys(patch).length === 0) throw new TenantError("No se enviaron datos válidos", 400);

    const res = await totalumSdk.crud.editRecordById("user", body.user_id, patch);
    if (res.errors) {
      console.error("[team] error actualizando el usuario:", res.errors);
      throw new Error(res.errors.errorMessage || "Error actualizando el usuario");
    }

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId, action: "team_member_updated",
      entityType: "user", entityId: body.user_id, severity: "warning",
      description: `${ctx.email} actualizó el usuario ${user.email}`, metadata: patch,
    });

    console.log(`[team] usuario ${body.user_id} actualizado`, patch);
    return ok({ _id: body.user_id, ...patch });
  } catch (err) {
    return fail(err);
  }
}
