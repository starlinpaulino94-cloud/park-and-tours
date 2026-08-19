import { ComingSoon } from "@/components/tf/coming-soon";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="Finanzas"
      title="Pagos y reembolsos"
      description="Cobros por método, moneda y caja, enlazados a reserva, orden y cliente."
      icon="CreditCard"
      endpoints={["GET /api/erp/payment", "POST /api/payments"]}
    />
  );
}
