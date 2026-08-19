import { ComingSoon } from "@/components/tf/coming-soon";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="Red de ventas"
      title="Comisiones"
      description="Comisiones generadas por el CommissionEngine con snapshot inmutable."
      icon="Percent"
      endpoints={["GET /api/erp/commission", "POST /api/commissions/bulk"]}
    />
  );
}
