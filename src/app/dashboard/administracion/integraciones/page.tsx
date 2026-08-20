"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { INTEGRATION_CATEGORY, INTEGRATION_PROVIDER, INTEGRATION_STATUS } from "@/lib/labels-modules";

export default function Page() {
  return (
    <SimpleResource
      resource="integration"
      eyebrow="Administración"
      title="Integraciones"
      description="Conexiones con OTAs, pasarelas de pago, mensajería, contabilidad y organismos fiscales."
      emptyIcon="Plug"
      filters={[
        { name: "status", label: "Estado", dict: INTEGRATION_STATUS },
        { name: "category", label: "Categoría", dict: INTEGRATION_CATEGORY },
      ]}
      columns={[
        { key: "name", header: "Integración" },
        { key: "provider", header: "Proveedor", kind: "badge", dict: INTEGRATION_PROVIDER },
        { key: "category", header: "Categoría", kind: "badge", dict: INTEGRATION_CATEGORY },
        { key: "status", header: "Estado", kind: "badge", dict: INTEGRATION_STATUS },
        { key: "last_sync_at", header: "Última sincronización", kind: "datetime", hideOn:"md" },
        { key: "records_synced", header: "Registros", kind: "number", align:"right" },
      ]}
    />
  );
}
