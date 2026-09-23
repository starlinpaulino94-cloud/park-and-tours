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
        /**
         * Quién es esta persona COMO VENDEDOR, o null.
         *
         * El shell decidía a dónde llevar a cada quien mirando solo el rol, y
         * con eso no se puede: un gerente que además vende tiene su apartado y
         * su ERP, y un usuario con rol de vendedor SIN ficha vinculada no tiene
         * ventas que enseñar —hay que decírselo, no mandarlo a una pantalla en
         * blanco—. Son tres estados, no dos, y solo este dato los distingue.
         */
        sellerId: ctx.sellerId ?? null,
        /**
         * Qué manda esta persona DENTRO de su tour center.
         *
         * No es el rol: desde 0073 todas las personas de un socio tienen el
         * mismo, así que el rol no distingue a quien puede dar de alta a un
         * compañero de quien no. La pantalla necesita ese dato para no ofrecer
         * un botón que la API va a rechazar.
         */
        partnerRole: ctx.partnerRole ?? null,
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
