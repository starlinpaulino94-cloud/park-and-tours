import { ComingSoon } from "@/components/tf/coming-soon";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="Red de ventas"
      title="Liquidaciones"
      description="Agrupación de comisiones por beneficiario y período con cuenta por pagar."
      icon="FileSpreadsheet"
      endpoints={["POST /api/settlements/generate"]}
    />
  );
}
