import { ComingSoon } from "@/components/tf/coming-soon";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="Comercial"
      title="Excursiones y productos"
      description="Catálogo con modalidades, tarifas por canal y costes por salida."
      icon="Ticket"
      endpoints={["GET /api/erp/product", "GET /api/erp/product_modality"]}
    />
  );
}
