import { ComingSoon } from "@/components/tf/coming-soon";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="Dirección"
      title="Rentabilidad"
      description="Ingreso menos descuentos, comisiones y costes = margen de contribución."
      icon="TrendingUp"
      endpoints={["GET /api/reports/profitability"]}
    />
  );
}
