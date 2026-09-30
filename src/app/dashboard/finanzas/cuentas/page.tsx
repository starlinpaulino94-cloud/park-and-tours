"use client";

import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { SimpleResource } from "@/components/tf/simple-resource";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/tf/icon";
import { ACTIVE_STATUS } from "@/lib/labels";
import { ACCOUNT_TYPE, NORMAL_SIDE, SUBLEDGER, YES_NO } from "@/lib/labels-modules";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";

/**
 * PLAN DE CUENTAS, CON EL SEMBRADO QUE NO SE PODÍA PEDIR.
 *
 * El catálogo siempre se pudo mirar y editar por el CRUD genérico: eso no era el
 * hueco. El hueco era `POST /api/ledger/chart`, que crea las cuentas que falten
 * del plan base —idempotente, no toca las que ya están— y no lo llamaba nadie.
 *
 * `ensureChart` también corre sola antes de cada asiento automático
 * (`ledger-events.ts`), así que una empresa que vende ya tiene su plan. Este
 * botón es para las dos veces que eso no basta: la empresa recién creada que
 * quiere ver su catálogo antes de la primera venta, y el plan base que CRECE
 * —cuando se añaden cuentas nuevas al estándar, aquí se piden sin esperar a que
 * la próxima venta las traiga.
 */
export default function Page() {
  const [version, setVersion] = useState(0);
  const [sembrando, setSembrando] = useState(false);

  const sembrar = async () => {
    setSembrando(true);
    const res = await api.post<{ created: number }>("/api/ledger/chart", {});
    setSembrando(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo sembrar el plan de cuentas");
      return;
    }
    const creadas = res.data?.created ?? 0;
    toast.success(creadas === 0
      ? "El plan base ya estaba completo: no faltaba ninguna cuenta"
      : `${creadas} cuenta${creadas === 1 ? "" : "s"} del plan base creada${creadas === 1 ? "" : "s"}`);
    if (creadas > 0) setVersion((v) => v + 1);
  };

  return (
    <SimpleResource
      key={version}
      extraActions={
        <Button variant="outline" onClick={sembrar} disabled={sembrando}>
          <Icon name="Plus" className="size-4" />
          {sembrando ? "Sembrando…" : "Sembrar plan base"}
        </Button>
      }
      resource="ledger_account"
      eyebrow="Finanzas"
      title="Plan de cuentas"
      description="Catálogo de cuentas contables con su submayor y lado normal. Es la base de la partida doble del sistema."
      emptyIcon="Network"
      filters={[
        { name: "account_type", label: "Naturaleza", dict: ACCOUNT_TYPE },
      ]}
      emptyTitle="Sin plan de cuentas"
      emptyDescription="Siembra el plan base con el botón de arriba, o deja que lo haga el primer asiento automático; aquí se añaden además las cuentas propias."
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
