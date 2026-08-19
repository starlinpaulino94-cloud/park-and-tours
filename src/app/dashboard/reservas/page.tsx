import { ComingSoon } from "@/components/tf/coming-soon";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="Comercial"
      title="Reservas"
      description="Doce estados, historial completo, cancelaciones con política aplicada y check-in."
      icon="CalendarCheck"
      endpoints={["GET /api/erp/booking", "POST /api/bookings/[id]/cancel"]}
    />
  );
}
