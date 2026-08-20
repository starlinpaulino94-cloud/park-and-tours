"use client";

import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge } from "@/components/tf/status-badge";
import { GENERIC_STATUS } from "@/lib/labels";
import { WAREHOUSE_TYPE, YES_NO } from "@/lib/labels-modules";
import { optionsFrom } from "@/components/tf/options";

export default function AlmacenesPage() {
  return (
    <ResourcePage
      resource="warehouse"
      eyebrow="Comercio"
      title="Almacenes"
      description="Cocina, bar, tienda, taller y tránsito. Separar almacenes es lo que permite saber dónde se pierde el producto."
      createLabel="Nuevo almacén"
      emptyIcon="Warehouse"
      emptyTitle="Sin almacenes"
      emptyDescription="Crea al menos un almacén principal para empezar a registrar existencias."
      filters={[{ name: "warehouse_type", label: "Tipo", options: optionsFrom(WAREHOUSE_TYPE) }]}
      columns={[
        {
          key: "name", header: "Almacén",
          render: (w: any) => (
            <div>
              <p className="font-semibold">{w.name}</p>
              <p className="text-xs text-muted-foreground">
                {[w.code, w.branch?.name || w.zone?.name || w.location].filter(Boolean).join(" · ") || "—"}
              </p>
            </div>
          ),
        },
        { key: "type", header: "Tipo", render: (w: any) => <StatusBadge value={w.warehouse_type} dict={WAREHOUSE_TYPE} dot={false} /> },
        { key: "neg", header: "Permite negativo", hideOn: "md", render: (w: any) => <StatusBadge value={w.allows_negative} dict={YES_NO} dot={false} /> },
        { key: "status", header: "Estado", render: (w: any) => <StatusBadge value={w.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "name", label: "Nombre", required: true, span: 2 },
        { name: "code", label: "Código" },
        { name: "warehouse_type", label: "Tipo", type: "select", defaultValue: "main", options: optionsFrom(WAREHOUSE_TYPE) },
        { name: "branch", label: "Sucursal", type: "reference", resource: "branch" },
        { name: "zone", label: "Zona", type: "reference", resource: "zone" },
        { name: "location", label: "Ubicación" },
        { name: "allows_negative", label: "Permite stock negativo", type: "select", defaultValue: "no", options: optionsFrom(YES_NO),
          help: "Actívalo sólo si necesitas registrar salidas antes que las entradas." },
        { name: "notes", label: "Notas", type: "textarea", span: 2 },
        { name: "status", label: "Estado", type: "select", defaultValue: "active",
          options: [{ value: "active", label: "Activo" }, { value: "inactive", label: "Inactivo" }] },
      ]}
    />
  );
}
