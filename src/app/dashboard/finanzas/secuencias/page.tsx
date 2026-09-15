"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { NCF_TYPE } from "@/lib/labels-modules";
import { ACTIVE_STATUS } from "@/lib/labels";
import { optionsFrom } from "@/components/tf/options";

/**
 * Los rangos de comprobantes que autorizó la DGII.
 *
 * Uno por TIPO, que es como se autorizan: B01 (crédito fiscal), B02 (consumo) y
 * B04 (nota de crédito) tienen rangos distintos y se agotan por separado. Un
 * solo contador para todos era la raíz del problema — repetía números entre
 * tipos y no avisaba de nada.
 *
 * `next_number` no se edita aquí a propósito: lo consume la emisión de forma
 * atómica, y moverlo a mano es exactamente cómo se repiten o se saltan números.
 */
export default function Page() {
  return (
    <SimpleResource
      resource="ncf_sequence"
      eyebrow="Finanzas"
      title="Secuencias de NCF"
      description="El rango autorizado por la DGII para cada tipo de comprobante, con su vencimiento. Quedarse sin números es dejar de facturar."
      emptyIcon="ListChecks"
      emptyTitle="Sin secuencias configuradas"
      emptyDescription="Sin al menos una secuencia activa no se puede emitir ninguna factura."
      createLabel="Nueva secuencia"
      filters={[
        { name: "ncf_type", label: "Tipo", dict: NCF_TYPE },
        { name: "status", label: "Estado", dict: ACTIVE_STATUS },
      ]}
      fields={[
        { name: "ncf_type", label: "Tipo de comprobante", type: "select", required: true, options: optionsFrom(NCF_TYPE),
          help: "Una sola secuencia viva por tipo: dos serían dos numeraciones paralelas." },
        { name: "max_number", label: "Último número autorizado", type: "number", required: true,
          help: "El final del rango que concedió la DGII. Al llegar aquí deja de emitirse." },
        { name: "expires_at", label: "Vencimiento de la autorización", type: "date",
          help: "Pasada esta fecha la secuencia no entrega números, aunque le queden." },
        { name: "authorization_code", label: "Número de autorización",
          help: "El que devuelve la DGII, para poder cotejarlo." },
        { name: "tax_profile", label: "Perfil fiscal", type: "reference", resource: "tax_profile",
          optionLabel: (t: any) => t.name },
        { name: "status", label: "Estado", type: "select", defaultValue: "active", options: optionsFrom(ACTIVE_STATUS) },
        { name: "notes", label: "Notas", type: "textarea", span: 2 },
      ]}
      columns={[
        { key: "ncf_type", header: "Tipo", kind: "badge", dict: NCF_TYPE },
        { key: "next_number", header: "Próximo", kind: "number", align: "right" },
        { key: "max_number", header: "Hasta", kind: "number", align: "right" },
        { key: "expires_at", header: "Vence", kind: "date" },
        { key: "authorization_code", header: "Autorización" },
        { key: "status", header: "Estado", kind: "badge", dict: ACTIVE_STATUS },
      ]}
    />
  );
}
