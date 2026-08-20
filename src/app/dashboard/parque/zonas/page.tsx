"use client";

import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge } from "@/components/tf/status-badge";
import { GENERIC_STATUS } from "@/lib/labels";
import { ZONE_TYPE, YES_NO } from "@/lib/labels-modules";
import { optionsFrom } from "@/components/tf/options";
import { formatNumber } from "@/lib/format";

/** Occupancy bar: the visual signal an operations manager reads first. */
function Occupancy({ current, max }: { current?: number; max?: number }) {
  if (!max || max <= 0) return <span className="text-xs text-muted-foreground">Sin aforo definido</span>;
  const pct = Math.min(100, Math.round(((current || 0) / max) * 100));
  const tone = pct > 90 ? "bg-rose-500" : pct > 70 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="tf-num text-xs font-semibold">{pct}%</span>
    </div>
  );
}

export default function ZonasPage() {
  return (
    <ResourcePage
      resource="zone"
      eyebrow="Parque"
      title="Zonas y aforo"
      description="Aforo máximo y ocupación actual por zona. El aforo es el primer límite de todo lo que se puede vender y dejar entrar."
      createLabel="Nueva zona"
      emptyIcon="Map"
      emptyTitle="Sin zonas definidas"
      emptyDescription="Define zonas para controlar aforo, asignar personal y organizar las recogidas."
      filters={[{ name: "zone_type", label: "Tipo", options: optionsFrom(ZONE_TYPE) }]}
      columns={[
        {
          key: "name", header: "Zona",
          render: (z: any) => (
            <div className="flex items-center gap-2">
              {z.color && <span className="size-2.5 shrink-0 rounded-full" style={{ background: z.color }} />}
              <div>
                <p className="font-semibold">{z.name}</p>
                <p className="text-xs text-muted-foreground">{z.description || "—"}</p>
              </div>
            </div>
          ),
        },
        { key: "type", header: "Tipo", hideOn: "md", render: (z: any) => <StatusBadge value={z.zone_type} dict={ZONE_TYPE} dot={false} /> },
        { key: "cap", header: "Aforo máx.", align: "right", render: (z: any) => <span className="tf-num">{formatNumber(z.max_capacity)}</span> },
        { key: "now", header: "Ahora", align: "right", hideOn: "sm", render: (z: any) => <span className="tf-num">{formatNumber(z.current_occupancy)}</span> },
        { key: "occ", header: "Ocupación", render: (z: any) => <Occupancy current={z.current_occupancy} max={z.max_capacity} /> },
        { key: "band", header: "Pulsera", hideOn: "lg", render: (z: any) => <StatusBadge value={z.requires_wristband} dict={YES_NO} dot={false} /> },
        { key: "status", header: "Estado", render: (z: any) => <StatusBadge value={z.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "name", label: "Nombre", required: true },
        { name: "zone_type", label: "Tipo de zona", type: "select", defaultValue: "attraction_area", options: optionsFrom(ZONE_TYPE) },
        { name: "max_capacity", label: "Aforo máximo", type: "number", suffix: "personas" },
        { name: "current_occupancy", label: "Ocupación actual", type: "number", suffix: "personas" },
        { name: "requires_wristband", label: "Requiere pulsera", type: "select", defaultValue: "no", options: optionsFrom(YES_NO) },
        { name: "color", label: "Color", placeholder: "#2563eb" },
        { name: "description", label: "Descripción", type: "textarea", span: 2 },
        { name: "status", label: "Estado", type: "select", defaultValue: "active",
          options: [{ value: "active", label: "Activa" }, { value: "inactive", label: "Inactiva" }] },
      ]}
    />
  );
}
