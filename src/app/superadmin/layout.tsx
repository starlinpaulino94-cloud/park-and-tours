import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { SideShell } from "@/components/tf/side-shell";
import { SUPERADMIN_NAV } from "@/lib/nav";

/** Platform panel. Only the cross-tenant superadmin role reaches this shell. */
export default async function SuperadminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  if (ctx.role !== "superadmin") {
    console.warn(`[superadmin] acceso denegado a ${ctx.email} (rol ${ctx.role})`);
    redirect("/dashboard");
  }

  return (
    <SideShell
      nav={SUPERADMIN_NAV}
      brand="TourFlow"
      badge="PLATAFORMA"
      subtitle="Panel de plataforma"
      accent="ink"
      user={{ name: ctx.name, role: ctx.role }}
      extraLinks={[{ href: "/dashboard", label: "Ir a un panel de empresa", icon: "LayoutDashboard" }]}
    >
      {children}
    </SideShell>
  );
}
