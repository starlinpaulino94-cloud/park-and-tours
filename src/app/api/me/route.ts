import { getTenantContext } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { supabaseService } from "@/lib/supabase/service";
import type { Plan } from "@/lib/types";

/** Current session profile + tenant, used to bootstrap the app shell. */
export async function GET() {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return ok({ authenticated: false });

    let plan: Plan | null = null;
    const planRef = ctx.company?.plan;
    if (planRef) {
      const planId = typeof planRef === "string" ? planRef : planRef._id;
      if (planId) {
        const { data } = await supabaseService().from("plan").select("*").eq("id", planId).maybeSingle();
        plan = data ? ({ ...data, _id: data.id, createdAt: data.created_at, updatedAt: data.updated_at } as Plan) : null;
      }
    }

    return ok({
      authenticated: true,
      user: {
        id: ctx.userId, email: ctx.email, name: ctx.name,
        role: ctx.role, partnerId: ctx.partnerId,
      },
      companyId: ctx.companyId,
      company: ctx.company,
      plan,
      needsOnboarding: !ctx.companyId && ctx.role !== "superadmin",
    });
  } catch (err) {
    return fail(err);
  }
}
