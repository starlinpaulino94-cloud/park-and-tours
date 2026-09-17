"use client";

import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge } from "@/components/tf/status-badge";
import { GENERIC_STATUS } from "@/lib/labels";
import { optionsFrom } from "@/components/tf/options";

/**
 * LOS TIPOS DE VENDEDOR.
 *
 * Tiene pantalla propia por una razón que no es de menú: una regla de comisión
 * o una meta comercial se ponen «a todos los hoteles», y sin un catálogo eso
 * sería la palabra «hotel» tecleada a mano en cada regla. «Hotel» y «hotel»
 * serían dos tipos distintos y una de las dos reglas no pagaría — en silencio,
 * porque una regla que no encaja no da error: simplemente no aplica.
 */
export default function SellerTypesPage() {
  return (
    <ResourcePage
      resource="seller_type"
      eyebrow="Red de ventas"
      title="Tipos de vendedor"
      description="Empleado, hotel, taxi, agencia, promotor de playa… Son los grupos sobre los que se pueden fijar comisiones y metas de una vez."
      createLabel="Nuevo tipo"
      searchPlaceholder="Buscar tipo…"
      emptyIcon="Tags"
      emptyTitle="Todavía no hay tipos de vendedor"
      emptyDescription="Crea los que uses de verdad: normalmente son cuatro o cinco, no veinte."
      filters={[
        { name: "status", label: "Estado", options: optionsFrom(GENERIC_STATUS, ["active", "inactive"]) },
      ]}
      columns={[
        { key: "name", header: "Tipo", render: (t: any) => <span className="font-semibold">{t.name}</span> },
        { key: "description", header: "Descripción", hideOn: "sm",
          render: (t: any) => t.description || "—" },
        { key: "status", header: "Estado",
          render: (t: any) => <StatusBadge value={t.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "name", label: "Nombre", required: true,
          help: "Como lo dice el equipo: «Hotel», «Taxi», «Agencia»." },
        { name: "description", label: "Para qué lo usas", type: "textarea" },
        { name: "status", label: "Estado", type: "select", defaultValue: "active",
          options: optionsFrom(GENERIC_STATUS, ["active", "inactive"]) },
      ]}
    />
  );
}
