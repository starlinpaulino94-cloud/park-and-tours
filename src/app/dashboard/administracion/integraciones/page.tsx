"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { INTEGRATION_CATEGORY, INTEGRATION_PROVIDER, INTEGRATION_STATUS, SYNC_FREQUENCY } from "@/lib/labels-modules";
import { optionsFrom } from "@/components/tf/options";

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
      emptyTitle="Sin integraciones"
      emptyDescription="Conecta canales de distribución, pagos o contabilidad."
      createLabel="Nueva integración"
      fields={[
        { name: "name", label: "Integración", required: true },
        { name: "provider", label: "Proveedor", type: "select", options: optionsFrom(INTEGRATION_PROVIDER) },
        { name: "category", label: "Categoría", type: "select", options: optionsFrom(INTEGRATION_CATEGORY) },
        { name: "status", label: "Estado", type: "select", defaultValue: "pending", options: optionsFrom(INTEGRATION_STATUS) },
        { name: "direction", label: "Dirección" },
        { name: "endpoint_url", label: "Endpoint", type: "url" },
        { name: "external_id", label: "Identificador externo" },
        { name: "sync_frequency", label: "Frecuencia", type: "select", options: optionsFrom(SYNC_FREQUENCY) },
        { name: "partner", label: "Socio", type: "reference", resource: "partner", optionLabel: (p: any) => p.commercial_name || p.name },
        { name: "config", label: "Configuración", type: "textarea", span: 2, help: "JSON con los parámetros del proveedor. Las credenciales no se guardan aquí." },
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
