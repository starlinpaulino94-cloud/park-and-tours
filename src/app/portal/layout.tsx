import { redirect } from "next/navigation";
import { getTenantContext, tenantQuery } from "@/lib/tenant";
import { SideShell } from "@/components/tf/side-shell";
import { PORTAL_NAV } from "@/lib/nav";
import { PortalProvider } from "./portal-context";
import type { Partner } from "@/lib/types";

/**
 * B2B portal shell. Partner users live here permanently; internal staff may
 * open it to see exactly what their resellers see.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  if (!ctx.companyId) redirect("/onboarding");

  let partnerName = ctx.company?.name || "Portal B2B";
  if (ctx.partnerId) {
    const rows = await tenantQuery<Partner>(ctx.companyId, "partner", { _filter: { _id: ctx.partnerId }, _limit: 1 });
    const partner = rows[0];
    if (partner) partnerName = partner.commercial_name || partner.name || partnerName;
  }

  const isStaff = ctx.role !== "partner";

  return (
    <SideShell
      nav={PORTAL_NAV}
      brand="TourFlow"
      badge="B2B"
      subtitle={partnerName}
      user={{ name: ctx.name, role: ctx.role, companyName: partnerName }}
      extraLinks={isStaff ? [{ href: "/dashboard", label: "Volver al panel interno", icon: "ArrowLeft" }] : []}
    >
      <PortalProvider role={ctx.role} partnerId={ctx.partnerId}>{children}</PortalProvider>
    </SideShell>
  );
}
