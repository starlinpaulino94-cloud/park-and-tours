import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, TenantError } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { supabaseService } from "@/lib/supabase/service";
import { writeAudit } from "@/lib/audit";
import type { AppRole } from "@/lib/auth";

const ASSIGNABLE_ROLES: AppRole[] = ["owner", "admin", "manager", "operations", "cashier", "seller", "partner"];

function assertRole(role: string): AppRole {
  if (!ASSIGNABLE_ROLES.includes(role as AppRole)) throw new TenantError(`Rol no válido: ${role}`, 400);
  return role as AppRole;
}

function mapUser(user: any, membership: any) {
  return {
    _id: user.id,
    id: user.id,
    email: user.email,
    name: user.user_metadata?.name || user.email,
    phone: user.phone || user.user_metadata?.phone || null,
    role: membership.role,
    status: membership.status,
    company_id: membership.organization_id,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

export async function GET() {
  try {
    const ctx = await requireTenant();
    requireAtLeast(ctx, "manager");

    const sb = supabaseService();
    const { data: memberships, error } = await sb
      .from("organization_memberships")
      .select("*")
      .eq("organization_id", ctx.companyId)
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw error;

    const users = await Promise.all((memberships || []).map(async (m) => {
      const { data } = await sb.auth.admin.getUserById(m.user_id);
      return data.user ? mapUser(data.user, m) : { _id: m.user_id, role: m.role, status: m.status, company_id: m.organization_id };
    }));

    return ok(users, { total: users.length });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    requireAtLeast(ctx, "admin");

    const body = await readJson<{ email?: string; name?: string; password?: string; role?: string; phone?: string | null }>(req);
    const email = (body.email || "").trim().toLowerCase();
    const name = (body.name || "").trim();
    const password = body.password || "";
    if (!email || !name) throw new TenantError("El nombre y el email son obligatorios", 400);
    if (password.length < 8) throw new TenantError("La contraseña debe tener al menos 8 caracteres", 400);
    const role = assertRole(body.role || "seller");

    const sb = supabaseService();
    const { data: created, error: createError } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, phone: body.phone || undefined },
    });
    if (createError) throw Object.assign(new Error(createError.message), { status: 409 });
    const userId = created.user?.id;
    if (!userId) throw new Error("No se pudo crear la cuenta");

    const { error: memberError } = await sb.from("organization_memberships").insert({
      user_id: userId,
      organization_id: ctx.companyId,
      role,
      status: "active",
      is_primary: true,
    });
    if (memberError) throw memberError;

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId, action: "team_member_created",
      entityType: "user", entityId: userId, severity: "warning",
      description: `${ctx.email} creó el usuario ${email} con rol ${role}`,
    });

    return ok({ _id: userId, email, name, role, status: "active" });
  } catch (err) {
    return fail(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    requireAtLeast(ctx, "admin");

    const body = await readJson<{ user_id?: string; role?: string; status?: string; phone?: string | null; name?: string }>(req);
    if (!body.user_id) throw new TenantError("Falta el identificador del usuario", 400);
    if (body.user_id === ctx.userId && body.role && body.role !== ctx.role) throw new TenantError("No puedes cambiar tu propio rol", 400);
    if (body.user_id === ctx.userId && body.status && body.status !== "active") throw new TenantError("No puedes desactivar tu propia cuenta", 400);

    const sb = supabaseService();
    const { data: membership, error: loadError } = await sb
      .from("organization_memberships")
      .select("*")
      .eq("user_id", body.user_id)
      .eq("organization_id", ctx.companyId)
      .maybeSingle();
    if (loadError) throw loadError;
    if (!membership) throw new TenantError("Usuario no encontrado en esta empresa", 404);

    const patch: Record<string, unknown> = {};
    if (body.role) patch.role = assertRole(body.role);
    if (body.status) patch.status = body.status;
    if (Object.keys(patch).length > 0) {
      const { error } = await sb
        .from("organization_memberships")
        .update(patch)
        .eq("user_id", body.user_id)
        .eq("organization_id", ctx.companyId);
      if (error) throw error;
    }

    const userPatch: Record<string, unknown> = {};
    if (body.name !== undefined) userPatch.name = body.name;
    if (body.phone !== undefined) userPatch.phone = body.phone || null;
    if (Object.keys(userPatch).length > 0) {
      const { error } = await sb.auth.admin.updateUserById(body.user_id, { user_metadata: userPatch });
      if (error) throw error;
    }

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId, action: "team_member_updated",
      entityType: "user", entityId: body.user_id, severity: "warning",
      description: `${ctx.email} actualizó un usuario`, metadata: { ...patch, ...userPatch },
    });

    return ok({ _id: body.user_id, ...patch, ...userPatch });
  } catch (err) {
    return fail(err);
  }
}
