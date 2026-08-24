import { cookies } from "next/headers";
import { requireSuperadmin, IMPERSONATION_COOKIE } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { supabaseService } from "@/lib/supabase/service";

/**
 * POST /api/superadmin/impersonate — entra o sale de una empresa.
 * La suplantación nunca es invisible: se marca en la interfaz y se audita.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireSuperadmin();
    const body = await readJson<{ company_id?: string | null; stop?: boolean }>(req);
    const jar = await cookies();

    if (body.stop || !body.company_id) {
      const previous = jar.get(IMPERSONATION_COOKIE)?.value;
      jar.delete(IMPERSONATION_COOKIE);
      await writeAudit({
        companyId: previous, userId: ctx.userId, impersonatedBy: ctx.userId,
        action: "impersonation_stopped", entityType: "company", entityId: previous,
        severity: "warning", description: `${ctx.email} finalizó la suplantación`,
      });
      console.log(`[impersonate] ${ctx.email} salió de ${previous}`);
      return ok({ impersonating: false });
    }

    const { data: company, error } = await supabaseService()
      .from("organizations")
      .select("id, name")
      .eq("id", body.company_id)
      .eq("kind", "tenant")
      .maybeSingle();
    if (error) throw error;
    if (!company) throw Object.assign(new Error("Empresa no encontrada"), { status: 404 });

    jar.set(IMPERSONATION_COOKIE, company.id, {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 2,
      secure: (process.env.NEXT_PUBLIC_APP_URL || "").startsWith("https://"),
    });

    await writeAudit({
      companyId: company.id, userId: ctx.userId, impersonatedBy: ctx.userId,
      action: "impersonation_started", entityType: "company", entityId: company.id,
      severity: "critical",
      description: `${ctx.email} inició sesión suplantada en ${company.name}`,
    });

    console.log(`[impersonate] ${ctx.email} → ${company.name}`);
    return ok({ impersonating: true, company: { _id: company.id, id: company.id, name: company.name } });
  } catch (err) {
    return fail(err);
  }
}
