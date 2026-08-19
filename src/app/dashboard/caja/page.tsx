import { ComingSoon } from "@/components/tf/coming-soon";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="Finanzas"
      title="Caja y POS"
      description="Apertura, movimientos, cierre y arqueo con diferencias auditadas."
      icon="Wallet"
      endpoints={["GET /api/cash/sessions", "POST /api/cash/sessions/[id]/close"]}
    />
  );
}
