import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { AppShell, type ShellUser } from "@/components/tf/app-shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  if (!ctx.companyId) redirect("/onboarding");
  // Portal users never reach the internal ERP.
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

  return <AppShell user={user}>{children}</AppShell>;
}
