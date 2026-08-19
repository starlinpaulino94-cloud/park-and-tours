import { ComingSoon } from "@/components/tf/coming-soon";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="Operación"
      title="Pickups, hoteles y zonas"
      description="Zonas, hoteles, puntos y rutas de recogida asignadas a cada salida."
      icon="MapPin"
      endpoints={["GET /api/erp/hotel", "GET /api/erp/pickup_route"]}
    />
  );
}
