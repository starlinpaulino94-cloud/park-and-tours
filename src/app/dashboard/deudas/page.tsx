"use client";

import { AgingReport } from "@/components/tf/aging-report";

export default function PayablesPage() {
  return (
    <AgingReport
      type="payable"
      eyebrow="Finanzas"
      title="Cuentas por pagar"
      description="Comisiones liquidadas, facturas de proveedores y cualquier obligación pendiente, con su antigüedad real."
      entityHeader="Acreedor"
      emptyTitle="No hay deudas pendientes"
      emptyDescription="Las liquidaciones de comisiones y las facturas de proveedores generan automáticamente una cuenta por pagar."
    />
  );
}
