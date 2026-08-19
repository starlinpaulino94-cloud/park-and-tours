import { ComingSoon } from "@/components/tf/coming-soon";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="Finanzas"
      title="Gastos"
      description="Gastos por categoría, sucursal y proveedor con comprobante adjunto."
      icon="Receipt"
      endpoints={["GET /api/erp/expense"]}
    />
  );
}
