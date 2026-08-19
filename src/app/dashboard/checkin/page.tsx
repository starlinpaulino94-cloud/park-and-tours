import { ComingSoon } from "@/components/tf/coming-soon";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="Operación"
      title="Check-in"
      description="Búsqueda por voucher, check-in total o parcial, no-show y validación de pago."
      icon="ScanLine"
      endpoints={["GET /api/checkin/lookup", "POST /api/bookings/[id]/checkin"]}
    />
  );
}
