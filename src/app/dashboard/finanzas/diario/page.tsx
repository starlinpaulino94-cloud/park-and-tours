"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { LEDGER_SOURCE } from "@/lib/labels-modules";

export default function Page() {
  return (
    <SimpleResource
      resource="ledger_entry"
      eyebrow="Finanzas"
      title="Libro diario"
      description="Líneas de asiento inmutables. Un error no se borra: se corrige con un asiento de reversa, así la historia se conserva."
      emptyIcon="Scale"
      filters={[
        { name: "source_type", label: "Origen", dict: LEDGER_SOURCE },
      ]}
      columns={[
        { key: "posted_at", header: "Fecha", kind: "datetime" },
        { key: "entry_code", header: "Asiento" },
        { key: "ledger_account", header: "Cuenta", kind: "ref" },
        { key: "memo", header: "Concepto", hideOn:"md" },
        { key: "debit", header: "Débito", kind: "money", align:"right" },
        { key: "credit", header: "Crédito", kind: "money", align:"right" },
        { key: "source_type", header: "Origen", kind: "badge", dict: LEDGER_SOURCE, hideOn:"lg" },
      ]}
    />
  );
}
