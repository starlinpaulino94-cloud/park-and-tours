"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { ACTIVE_STATUS } from "@/lib/labels";
import { ACCOUNT_TYPE, NORMAL_SIDE, SUBLEDGER, YES_NO } from "@/lib/labels-modules";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";

export default function Page() {
  return (
    <SimpleResource
      resource="ledger_account"
      eyebrow="Finanzas"
      title="Plan de cuentas"
      description="Catálogo de cuentas contables con su submayor y lado normal. Es la base de la partida doble del sistema."
      emptyIcon="Network"
      filters={[
        { name: "account_type", label: "Naturaleza", dict: ACCOUNT_TYPE },
      ]}
      emptyTitle="Sin plan de cuentas"
      emptyDescription="El plan base se siembra solo al registrar el primer asiento; aquí se añaden las cuentas propias."
      createLabel="Nueva cuenta"
      fields={[
        { name: "code", label: "Código", required: true, placeholder: "1101" },
        { name: "name", label: "Nombre", required: true },
        { name: "account_type", label: "Tipo", type: "select", defaultValue: "asset", options: optionsFrom(ACCOUNT_TYPE) },
        { name: "normal_side", label: "Naturaleza", type: "select", defaultValue: "debit", options: optionsFrom(NORMAL_SIDE) },
        { name: "subledger", label: "Submayor", type: "select", options: optionsFrom(SUBLEDGER) },
        { name: "parent", label: "Cuenta padre", type: "reference", resource: "ledger_account", optionLabel: (a: any) => `${a.code} · ${a.name}` },
        { name: "is_postable", label: "Admite asientos", type: "select", defaultValue: "yes", options: optionsFrom(YES_NO) },
        { name: "currency", label: "Moneda", type: "select", options: CURRENCY_OPTIONS },
        { name: "status", label: "Estado", type: "select", defaultValue: "active", options: optionsFrom(ACTIVE_STATUS) },
      ]}
      columns={[
        { key: "code", header: "Código" },
        { key: "name", header: "Cuenta" },
        { key: "account_type", header: "Naturaleza", kind: "badge", dict: ACCOUNT_TYPE },
        { key: "subledger", header: "Submayor", kind: "badge", dict: SUBLEDGER, hideOn:"md" },
        { key: "normal_side", header: "Lado normal", kind: "badge", dict: NORMAL_SIDE, hideOn:"lg" },
        { key: "balance", header: "Saldo", kind: "money", align:"right" },
      ]}
    />
  );
}
