"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { ACCOUNT_TYPE, NORMAL_SIDE, SUBLEDGER } from "@/lib/labels-modules";

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
