"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { KpiCard } from "@/components/tf/kpi-card";
import { Icon } from "@/components/tf/icon";
import { LEAD_SOURCE, LEAD_STATUS } from "@/lib/labels";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { CURRENCY_OPTIONS, optionsFrom } from "@/components/tf/options";
import { LeadDrawer, overdueAction, type Lead } from "./lead-drawer";

const PIPELINE = ["new", "contacted", "interested", "quoted", "follow_up", "booked", "lost"];
const CLOSED = new Set(["booked", "lost"]);

const isOpen = (l: Lead) => !CLOSED.has(l.status || "");
const startOfTomorrow = () => {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime();
};
/** Vence hoy: agendado antes de mañana y todavía no pasado. */
const dueToday = (l: Lead) =>
  Boolean(l.next_action_at) && !overdueAction(l) &&
  new Date(l.next_action_at!).getTime() < startOfTomorrow();

/**
 * Suma por divisa.
 *
 * Los leads guardan su propia `currency`; antes el pipeline sumaba todos los
 * `estimated_value` y los etiquetaba "usd", mezclando monedas en una cifra que
 * no significaba nada. Aquí cada divisa se totaliza por separado.
 */
function sumByCurrency(rows: Lead[]): [string, number][] {
  const map = new Map<string, number>();
  for (const l of rows) {
    if (!l.estimated_value) continue;
    const key = (l.currency || "usd").toLowerCase();
    map.set(key, (map.get(key) || 0) + l.estimated_value);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

/** Divisa dominante como cifra principal; el resto va al detalle del KPI. */
const leadTotal = (totals: [string, number][]) =>
  totals.length === 0 ? formatMoney(0, "usd") : formatMoney(totals[0][1], totals[0][0]);

const currencyHint = (totals: [string, number][], fallback: string) =>
  totals.length > 1
    ? `+ ${totals.slice(1).map(([c, v]) => formatMoney(v, c)).join(" · ")}`
    : fallback;

/** Embudo + la cola de trabajo del vendedor. */
function Summary({ rows, onOpen }: { rows: Lead[]; onOpen: (id: string) => void }) {
  const byStatus = new Map<string, { count: number; value: number }>();
  for (const l of rows) {
    const key = l.status || "new";
    const agg = byStatus.get(key) || { count: 0, value: 0 };
    agg.count += 1;
    agg.value += l.estimated_value ?? 0;
    byStatus.set(key, agg);
  }

  const open = rows.filter(isOpen);
  const won = rows.filter((l) => l.status === "booked");
  const closed = won.length + rows.filter((l) => l.status === "lost").length;
  const openTotals = sumByCurrency(open);
  const wonTotals = sumByCurrency(won);

  // La cola: lo que un vendedor abre el CRM para resolver.
  const overdue = open.filter(overdueAction);
  const today = open.filter(dueToday);
  const unscheduled = open.filter((l) => !l.next_action_at);
  const queue = [...overdue, ...today].slice(0, 8);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard tone="primary" icon="Sparkles" label="Oportunidades abiertas"
          value={formatNumber(open.length)} hint={`${formatNumber(rows.length)} leads en esta página`} />
        <KpiCard icon="Banknote" label="Valor del pipeline"
          value={leadTotal(openTotals)}
          hint={currencyHint(openTotals, "Valor estimado de los leads abiertos")}
          definition="Suma del valor estimado de los leads abiertos, totalizada por divisa." />
        <KpiCard tone="ink" icon="Trophy" label="Ganado"
          value={leadTotal(wonTotals)}
          hint={currencyHint(wonTotals, `${formatNumber(won.length)} leads convertidos en reserva`)} />
        <KpiCard tone="amber" icon="Target" label="Tasa de conversión"
          value={`${closed > 0 ? ((won.length / closed) * 100).toFixed(0) : 0}%`}
          hint={`${formatNumber(won.length)} de ${formatNumber(closed)} leads cerrados`} />
      </div>

      {(overdue.length > 0 || today.length > 0 || unscheduled.length > 0) && (
        <section className="tf-card p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="font-display text-sm font-semibold">Tu cola de seguimiento</h2>
            {overdue.length > 0 && <Pill tone="danger">{overdue.length} vencidos</Pill>}
            {today.length > 0 && <Pill tone="warning">{today.length} para hoy</Pill>}
            {unscheduled.length > 0 && <Pill tone="neutral">{unscheduled.length} sin agendar</Pill>}
          </div>
          {queue.length > 0 ? (
            <ul className="divide-y divide-border">
              {queue.map((l) => (
                <li key={l._id}>
                  <button type="button" onClick={() => onOpen(l._id)}
                    className="flex w-full items-center gap-3 py-2 text-left hover:bg-muted/50">
                    <span className={overdueAction(l) ? "text-destructive" : "text-amber-600 dark:text-amber-400"}>
                      <Icon name={overdueAction(l) ? "TriangleAlert" : "Clock"} className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{l.name || "Sin nombre"}</span>
                      <span className="block text-xs text-muted-foreground">
                        {l.next_action_at ? formatDateTime(l.next_action_at) : "Sin agendar"}
                        {l.estimated_value ? ` · ${formatMoney(l.estimated_value, l.currency || "usd")}` : ""}
                      </span>
                    </span>
                    <StatusBadge value={l.status} dict={LEAD_STATUS} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nada vencido ni para hoy. Quedan {unscheduled.length} leads abiertos sin próxima acción agendada.
            </p>
          )}
        </section>
      )}

      <div className="tf-card tf-scroll flex gap-2 overflow-x-auto p-3">
        {PIPELINE.map((status) => {
          const agg = byStatus.get(status) || { count: 0, value: 0 };
          return (
            <div key={status} className="min-w-[140px] flex-1 rounded-lg border border-border bg-muted/25 p-3">
              <StatusBadge value={status} dict={LEAD_STATUS} />
              <p className="mt-2 tf-num text-xl">{agg.count}</p>
              <p className="text-xs text-muted-foreground">
                {formatNumber(agg.count)} lead{agg.count === 1 ? "" : "s"}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function CrmPage() {
  const [sellerLabel, setSellerLabel] = useState<Record<string, string>>({});
  const [openLead, setOpenLead] = useState<string | null>(null);
  // Remontar la lista es la forma de refrescarla sin tocar ResourcePage.
  const [reloadKey, setReloadKey] = useState(0);

  // Cheap lookup so the table can show the seller name without expanding twice.
  useEffect(() => {
    api.get<any[]>("/api/erp/seller?limit=300").then((res) => {
      if (!res.ok) {
        console.error("[crm] no se pudieron cargar los vendedores:", res.error);
        return;
      }
      const map: Record<string, string> = {};
      for (const s of res.data || []) {
        map[s._id] = [s.first_name, s.last_name].filter(Boolean).join(" ") || s.code || "Vendedor";
      }
      setSellerLabel(map);
    });
  }, []);

  return (
    <>
      <ResourcePage
        key={reloadKey}
        resource="lead"
        eyebrow="Comercial"
        title="CRM y oportunidades"
        description="Cada lead conserva su origen, su vendedor y su valor estimado hasta que se convierte en venta o se pierde."
        createLabel="Nuevo lead"
        searchPlaceholder="Buscar por nombre, email o teléfono…"
        emptyIcon="Sparkles"
        emptyTitle="Todavía no hay leads"
        emptyDescription="Registra las oportunidades que llegan por WhatsApp, web o recomendación para no perder ninguna."
        renderSummary={(rows) => <Summary rows={rows as Lead[]} onOpen={setOpenLead} />}
        onRowClick={(row) => setOpenLead(row._id)}
        filters={[
          { name: "status", label: "Etapa", options: optionsFrom(LEAD_STATUS) },
          { name: "source", label: "Origen", options: optionsFrom(LEAD_SOURCE) },
        ]}
        columns={[
          {
            key: "name", header: "Lead",
            render: (l: any) => (
              <div>
                <p className="font-semibold">{l.name || "Sin nombre"}</p>
                <p className="text-xs text-muted-foreground">{l.email || l.phone || l.whatsapp || "Sin contacto"}</p>
              </div>
            ),
          },
          { key: "source", header: "Origen", hideOn: "lg",
            render: (l: any) => (l.source ? <StatusBadge value={l.source} dict={LEAD_SOURCE} dot={false} /> : "—") },
          { key: "product", header: "Interés", hideOn: "md",
            render: (l: any) => (typeof l.product === "object" && l.product ? l.product.name : "—") },
          { key: "seller", header: "Vendedor", hideOn: "lg",
            render: (l: any) => {
              const s = l.seller;
              if (s && typeof s === "object") return [s.first_name, s.last_name].filter(Boolean).join(" ");
              return typeof s === "string" ? sellerLabel[s] || "—" : "—";
            } },
          { key: "pax", header: "Pax", align: "right", hideOn: "sm", render: (l: any) => formatNumber(l.pax ?? 0) },
          { key: "value", header: "Valor estimado", align: "right",
            render: (l: any) => formatMoney(l.estimated_value ?? 0, l.currency) },
          {
            key: "next", header: "Próxima acción", align: "right", hideOn: "lg",
            render: (l: Lead) => {
              if (!l.next_action_at) {
                return isOpen(l)
                  ? <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">Sin agendar</span>
                  : <span className="text-muted-foreground">—</span>;
              }
              return (
                <span className={overdueAction(l) && isOpen(l)
                  ? "text-xs font-semibold text-destructive"
                  : "text-xs"}>
                  {formatDate(l.next_action_at)}
                </span>
              );
            },
          },
          { key: "status", header: "Etapa", render: (l: any) => <StatusBadge value={l.status} dict={LEAD_STATUS} /> },
        ]}
        fields={[
          { name: "name", label: "Nombre del lead", required: true, span: 2 },
          { name: "email", label: "Email", type: "email" },
          { name: "phone", label: "Teléfono" },
          { name: "whatsapp", label: "WhatsApp" },
          { name: "customer", label: "Cliente existente", type: "reference", resource: "customer",
            optionLabel: (c: any) => [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || "Cliente" },
          { name: "product", label: "Excursión de interés", type: "reference", resource: "product" },
          { name: "seller", label: "Vendedor asignado", type: "reference", resource: "seller",
            optionLabel: (s: any) => [s.first_name, s.last_name].filter(Boolean).join(" ") },
          { name: "partner", label: "Partner", type: "reference", resource: "partner",
            optionLabel: (p: any) => p.commercial_name || p.name },
          { name: "source", label: "Origen", type: "select", options: optionsFrom(LEAD_SOURCE) },
          { name: "status", label: "Etapa", type: "select", defaultValue: "new", options: optionsFrom(LEAD_STATUS) },
          { name: "pax", label: "Pax estimados", type: "number" },
          { name: "estimated_value", label: "Valor estimado", type: "number" },
          { name: "currency", label: "Moneda", type: "select", defaultValue: "usd", options: CURRENCY_OPTIONS },
          { name: "travel_date", label: "Fecha de viaje prevista", type: "date" },
          { name: "next_action_at", label: "Próxima acción", type: "datetime" },
          { name: "lost_reason", label: "Motivo de pérdida", span: 2 },
          { name: "notes", label: "Notas", type: "textarea", span: 2 },
        ]}
      />

      <LeadDrawer
        leadId={openLead}
        onClose={() => setOpenLead(null)}
        onChanged={() => setReloadKey((k) => k + 1)}
      />
    </>
  );
}
