import { ComingSoon } from "@/components/tf/coming-soon";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="Finanzas"
      title="Cuentas por pagar"
      description="Deudas con proveedores, transportistas, guías, vendedores y partners."
      icon="ArrowUpFromLine"
      endpoints={["GET /api/reports/aging?type=payable"]}
    />
  );
}
