import { ComingSoon } from "@/components/tf/coming-soon";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="Comercial"
      title="Nueva venta / POS"
      description="Órdenes multiproducto con precio calculado por el motor de tarifas, vouchers y cobro."
      icon="ShoppingCart"
      endpoints={["POST /api/orders", "POST /api/payments"]}
    />
  );
}
