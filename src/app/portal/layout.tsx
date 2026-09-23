import { redirect } from "next/navigation";
import { getTenantContext, tenantQuery, esDeSocio } from "@/lib/tenant";
import { SideShell } from "@/components/tf/side-shell";
import { PORTAL_NAV } from "@/lib/nav";
import { PortalProvider } from "./portal-context";
import type { Partner } from "@/lib/types";
import { vetoDeSocio } from "@/lib/partner-lifecycle";
import { SocioSinAcceso } from "./_components/socio-sin-acceso";
import { CondicionesPendientes } from "./_components/condiciones-pendientes";

/**
 * B2B portal shell. Partner users live here permanently; internal staff may
 * open it to see exactly what their resellers see.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  if (!ctx.companyId) redirect("/onboarding");

  /**
   * El socio apagado ve una explicación, no un portal roto.
   *
   * Antes de consultar NADA: el muro no puede depender de una consulta que la
   * propia regla de aislamiento podría rechazar, y pedir datos que no se van a
   * dibujar es trabajo para enseñar un párrafo.
   */
  if (ctx.partnerId) {
    const veto = vetoDeSocio(ctx.partnerStatus);
    if (veto) return <SocioSinAcceso motivo={veto.motivo} mensaje={veto.mensaje} />;
  }

  let partnerName = ctx.company?.name || "Portal B2B";
  let condicionesPendientes = 0;
  if (ctx.partnerId) {
    const rows = await tenantQuery<Partner>(ctx.companyId, "partner", { _filter: { _id: ctx.partnerId }, _limit: 1 });
    const partner = rows[0];
    if (partner) partnerName = partner.commercial_name || partner.name || partnerName;
    // Solo al socio: el personal interno que entra a auditar el portal no tiene
    // nada que aceptar, y enseñarle el aviso lo invitaría a firmar por otro.
    if (partner?.terms_status === "pendiente" && esDeSocio(ctx)) {
      condicionesPendientes = partner.terms_version ?? 1;
    }
  }

  const isStaff = !esDeSocio(ctx);

  return (
    <SideShell
      nav={PORTAL_NAV}
      brand="TourFlow"
      badge="B2B"
      subtitle={partnerName}
      user={{ name: ctx.name, role: ctx.role, companyName: partnerName }}
      extraLinks={isStaff ? [{ href: "/dashboard", label: "Volver al panel interno", icon: "ArrowLeft" }] : []}
    >
      <PortalProvider role={ctx.role} partnerId={ctx.partnerId}>
        {condicionesPendientes > 0 && <CondicionesPendientes version={condicionesPendientes} />}
        {children}
      </PortalProvider>
    </SideShell>
  );
}
