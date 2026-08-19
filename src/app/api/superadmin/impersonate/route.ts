import { cookies } from "next/headers";
import { requireSuperadmin, IMPERSONATION_COOKIE } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { totalumSdk } from "@/lib/totalum";
import { writeAudit } from "@/lib/audit";
import type { Company } from "@/lib/types";

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

    const res = await totalumSdk.crud.query("company", { _filter: { _id: body.company_id }, _limit: 1 });
    if (res.errors) {
      console.error("[impersonate] error cargando empresa:", res.errors);
      throw new Error(res.errors.errorMessage || "Error cargando la empresa");
    }
    const company = (res.data?.[0] || null) as Company | null;
    if (!company) throw Object.assign(new Error("Empresa no encontrada"), { status: 404 });

    jar.set(IMPERSONATION_COOKIE, company._id, {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 2,
      secure: (process.env.NEXT_PUBLIC_APP_URL || "").startsWith("https://"),
    });

    await writeAudit({
      companyId: company._id, userId: ctx.userId, impersonatedBy: ctx.userId,
      action: "impersonation_started", entityType: "company", entityId: company._id,
      severity: "critical",
      description: `${ctx.email} inició sesión suplantada en ${company.name}`,
    });

    console.log(`[impersonate] ${ctx.email} → ${company.name}`);
    return ok({ impersonating: true, company: { _id: company._id, name: company.name } });
  } catch (err) {
    return fail(err);
  }
}
