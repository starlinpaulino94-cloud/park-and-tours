import { ComingSoon } from "@/components/tf/coming-soon";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="Sistema"
      title="Configuración"
      description="Empresa, sucursales, cajas, políticas, reglas de precio y de comisión."
      icon="Settings"
      endpoints={["GET /api/me", "GET /api/erp/commission_rule"]}
    />
  );
}
