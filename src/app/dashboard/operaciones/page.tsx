import { ComingSoon } from "@/components/tf/coming-soon";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="Operación"
      title="Despacho diario"
      description="Salidas del día con pasajeros, vehículos, guías, hoteles y conflictos de recursos."
      icon="Radar"
      endpoints={["GET /api/operations/dispatch"]}
    />
  );
}
