"use client";

import { AgingReport } from "@/components/tf/aging-report";

export default function ReceivablesPage() {
  return (
    <AgingReport
      type="receivable"
      eyebrow="Finanzas"
      title="Cuentas por cobrar"
      description="Lo que te deben los tour centers, agencias y clientes a crédito, ordenado por antigüedad y contrastado con su límite de crédito."
      entityHeader="Deudor"
      emptyTitle="No hay saldos pendientes de cobro"
      emptyDescription="Cuando vendas a crédito a un partner, la deuda aparecerá aquí hasta que se salde."
    />
  );
}
