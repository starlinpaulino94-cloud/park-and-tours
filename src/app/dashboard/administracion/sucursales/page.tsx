"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { GENERIC_STATUS } from "@/lib/labels";
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
