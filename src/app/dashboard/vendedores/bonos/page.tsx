"use client";

import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { BONUS_STATUS, PAYOUT_KIND } from "@/lib/labels";
import { formatDate, formatMoney } from "@/lib/format";
import { CURRENCY_OPTIONS, optionsFrom } from "@/components/tf/options";

/**
 * LOS BONOS DEL VENDEDOR.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UN BONO NO ES UNA COMISIÓN, Y POR ESO NO VIVE EN LA MISMA TABLA
 *
 * Una comisión nace de una venta concreta, se calcula con una regla y se puede
 * rastrear hasta su reserva. Un bono nace de HABER LLEGADO a algo —una meta,
 * una temporada, un acuerdo verbal— y no tiene reserva detrás. Meterlo en
 * `commission` obligaría a inventarle una venta, y esa venta falsa saldría en
 * el informe de ventas.
 *
 * Lo que sí comparten es la liquidación: al vendedor se le paga todo junto.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE NO ES DINERO NO SE TRANSFIERE
 *
 * Un premio en especie —dos pases para la excursión, una noche de hotel— tiene
 * un valor y cuenta para el expediente y para la declaración. Pero sumarlo al
 * total a pagar haría que la operadora transfiriera dinero por un pase que ya
 * regaló, y el vendedor no va a ser quien lo reporte.
 */
export default function BonusesPage() {
  return (
    <ResourcePage
      resource="seller_bonus"
      eyebrow="Red de ventas"
      title="Bonos y premios"
      description="Lo que se le da a alguien por haber llegado, no por una venta concreta. Lo que está en especie cuenta para el expediente pero no se transfiere."
      createLabel="Nuevo bono"
      searchPlaceholder="Buscar por descripción…"
      emptyIcon="Gift"
      emptyTitle="Todavía no hay bonos"
      emptyDescription="Salen de una meta cumplida, o se dan a mano cuando la operadora lo decide."
      filters={[
        { name: "status", label: "Estado", options: optionsFrom(BONUS_STATUS) },
        { name: "payout_kind", label: "Cómo se paga", options: optionsFrom(PAYOUT_KIND) },
      ]}
      columns={[
        {
          key: "seller", header: "Vendedor",
          render: (b: any) => (
            <div>
              <p className="font-semibold">
                {typeof b.seller === "object" && b.seller
                  ? [b.seller.first_name, b.seller.last_name].filter(Boolean).join(" ")
                  : "—"}
              </p>
              <p className="text-xs text-muted-foreground">{b.description}</p>
            </div>
          ),
        },
        { key: "goal", header: "Meta", hideOn: "lg",
          render: (b: any) => (typeof b.goal === "object" && b.goal ? b.goal.name : "Dado a mano") },
        {
          key: "amount", header: "Importe", align: "right",
          render: (b: any) => (
            <div>
              <span className="font-semibold">{formatMoney(b.amount ?? 0, b.currency)}</span>
              {/* La distinción se enseña SIEMPRE, no solo en el detalle: es la
                  que decide si ese importe sale del banco. */}
              {b.payout_kind === "in_kind" && (
                <p className="text-xs text-muted-foreground">No se transfiere</p>
              )}
            </div>
          ),
        },
        { key: "kind", header: "Cómo se paga", hideOn: "md",
          render: (b: any) => <StatusBadge value={b.payout_kind || "cash"} dict={PAYOUT_KIND} dot={false} /> },
        { key: "awarded", header: "Otorgado", align: "right", hideOn: "lg",
          render: (b: any) => <span className="text-xs">{formatDate(b.awarded_at)}</span> },
        { key: "settlement", header: "Liquidación", hideOn: "lg",
          render: (b: any) => (typeof b.settlement === "object" && b.settlement
            ? <Pill tone="neutral">{b.settlement.code}</Pill>
            : <span className="text-xs text-muted-foreground">Sin liquidar</span>) },
        { key: "status", header: "Estado", render: (b: any) => <StatusBadge value={b.status} dict={BONUS_STATUS} /> },
      ]}
      fields={[
        { name: "seller", label: "Vendedor", type: "reference", resource: "seller", required: true,
          optionLabel: (s: any) => [s.first_name, s.last_name].filter(Boolean).join(" ") },
        { name: "description", label: "De qué es", required: true,
          help: "Es lo que se lee en la liquidación: «Meta de pasajeros de septiembre»." },
        { name: "goal", label: "Meta que lo otorgó", type: "reference", resource: "seller_goal",
          optionLabel: (g: any) => g.name || "Meta sin nombre",
          help: "Vacío si es un premio pactado a mano." },
        { name: "amount", label: "Importe", type: "number", required: true,
          help: "Un premio en especie también lleva su valor, aunque no se transfiera." },
        { name: "currency", label: "Moneda", type: "select", options: CURRENCY_OPTIONS },
        { name: "payout_kind", label: "Cómo se paga", type: "select", defaultValue: "cash",
          options: optionsFrom(PAYOUT_KIND) },
        { name: "status", label: "Estado", type: "select", defaultValue: "pending",
          options: optionsFrom(BONUS_STATUS) },
        { name: "notes", label: "Notas", type: "textarea" },
      ]}
    />
  );
}
