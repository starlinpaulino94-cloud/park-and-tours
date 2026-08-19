import { ComingSoon } from "@/components/tf/coming-soon";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="Comercial"
      title="CRM y leads"
      description="Embudo comercial con actividades, próxima acción y motivo de pérdida."
      icon="Sparkles"
      endpoints={["GET /api/erp/lead", "GET /api/erp/crm_activity"]}
    />
  );
}
