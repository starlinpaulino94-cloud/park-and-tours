import { redirect } from "next/navigation";
import { getTenantContext, tenantCount } from "@/lib/tenant";
import { AppShell, type NavBadges, type ShellUser } from "@/components/tf/app-shell";

/**
 * Contadores del sidebar. Solo tres, y solo accionables: algo que alguien tiene
 * que resolver hoy. Si alguna cuenta falla no se rompe la navegación: el badge
 * simplemente no aparece.
 */
async function loadBadges(companyId: string, userId: string, role: string): Promise<NavBadges> {
  const safe = async (label: string, run: () => Promise<number>) => {
    try {
      return await Promise.race([
        run(),
        new Promise<number>((resolve) => {
          setTimeout(() => {
            console.warn(`[shell] conteo de ${label} omitido por timeout`);
            resolve(0);
          }, 1200);
        }),
      ]);
    } catch (err) {
      console.error(`[shell] no se pudo contar ${label}:`, err);
      return 0;
    }
  };

  const canApprove = ["superadmin", "owner", "admin", "manager"].includes(role);

  const [tasks, approvals, incidents] = await Promise.all([
    safe("tareas", () => tenantCount(companyId, "task", {
      assigned_to: userId, status: { in: ["todo", "in_progress", "blocked", "waiting"] },
    })),
    canApprove
      ? safe("aprobaciones", () => tenantCount(companyId, "approval_request", { status: "pending" }))
      : Promise.resolve(0),
    safe("incidentes", () => tenantCount(companyId, "incident", {
      status: { in: ["open", "investigating", "action_required", "escalated"] },
    })),
  ]);

  return { tasks, approvals, incidents };
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const started = Date.now();
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  if (!ctx.companyId) redirect("/onboarding");
  // Los usuarios del portal nunca entran al ERP interno.
  if (ctx.role === "partner") redirect("/portal");

  const user: ShellUser = {
    name: ctx.name,
    email: ctx.email,
    role: ctx.role,
    companyName: ctx.company?.name || "Mi empresa",
    companyType: ctx.company?.company_type,
    modules: ctx.company?.modules_enabled || null,
    impersonating: ctx.impersonating,
    subscriptionStatus: ctx.company?.subscription_status,
    trialEndsAt: (ctx.company?.trial_ends_at as string) || null,
  };

  const badges = ctx.role === "superadmin" && !ctx.impersonating
    ? {}
    : await loadBadges(ctx.companyId, ctx.userId, ctx.role);
  const elapsed = Date.now() - started;
  if (process.env.NODE_ENV !== "production" && elapsed > 800) {
    console.warn(`[shell] DashboardLayout tardó ${elapsed}ms`);
  }

  return <AppShell user={user} badges={badges}>{children}</AppShell>;
}
