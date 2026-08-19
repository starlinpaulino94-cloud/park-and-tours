import { ComingSoon } from "@/components/tf/coming-soon";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="Finanzas"
      title="Cuentas por cobrar"
      description="Saldos de partners por antigüedad: corriente, 1-30, 31-60, 61-90 y +90 días."
      icon="ArrowDownToLine"
      endpoints={["GET /api/reports/aging?type=receivable"]}
    />
  );
}
