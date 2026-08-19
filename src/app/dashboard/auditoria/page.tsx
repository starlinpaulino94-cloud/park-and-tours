import { ComingSoon } from "@/components/tf/coming-soon";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="Sistema"
      title="Auditoría"
      description="Registro inmutable de acciones sensibles, con IP, usuario y suplantación."
      icon="ShieldCheck"
      endpoints={["GET /api/erp/audit_log"]}
    />
  );
}
