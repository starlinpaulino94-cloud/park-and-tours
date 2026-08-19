import { ComingSoon } from "@/components/tf/coming-soon";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="Comercial"
      title="Salidas y cupos"
      description="Calendario de salidas con capacidad, ocupación y bloqueo de sobreventa."
      icon="CalendarRange"
      endpoints={["GET /api/erp/departure", "POST /api/departures/generate"]}
    />
  );
}
