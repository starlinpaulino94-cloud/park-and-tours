"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { ACTIVE_STATUS, GENERIC_STATUS } from "@/lib/labels";
import { optionsFrom } from "@/components/tf/options";
import { BRANCH_TYPE } from "@/lib/labels-modules";

export default function Page() {
  return (
    <SimpleResource
      resource="branch"
      eyebrow="Administración"
      title="Sucursales"
      description="Parques, oficinas, tour centers y puntos de venta de la empresa."
      emptyIcon="Building2"
      filters={[
        { name: "branch_type", label: "Tipo", dict: BRANCH_TYPE },
      ]}
      createLabel="Nueva sucursal"
      fields={[
        { name: "name", label: "Nombre", required: true, span: 2 },
        { name: "code", label: "Código", placeholder: "PUJ-01" },
        { name: "branch_type", label: "Tipo", type: "select", options: optionsFrom(BRANCH_TYPE) },
        { name: "address", label: "Dirección", span: 2 },
        { name: "city", label: "Ciudad" },
        { name: "phone", label: "Teléfono", type: "phone" },
        { name: "email", label: "Correo", type: "email" },
        { name: "parent_branch", label: "Depende de", type: "reference", resource: "branch",
          optionLabel: (b: any) => b.name, help: "Para un punto de venta dentro de un tour center." },
        { name: "status", label: "Estado", type: "select", defaultValue: "active", options: optionsFrom(ACTIVE_STATUS) },
        { name: "notes", label: "Notas", type: "textarea", span: 2 },
      ]}
      columns={[
        { key: "name", header: "Sucursal" },
        { key: "code", header: "Código" },
        { key: "branch_type", header: "Tipo", kind: "badge", dict: BRANCH_TYPE },
        { key: "city", header: "Ciudad", hideOn:"sm" },
        { key: "phone", header: "Teléfono", hideOn:"md" },
        { key: "status", header: "Estado", kind: "badge", dict: GENERIC_STATUS },
      ]}
    />
  );
}
