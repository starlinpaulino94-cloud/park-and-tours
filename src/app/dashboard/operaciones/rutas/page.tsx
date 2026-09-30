"use client";

import { useState } from "react";
import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { EnlaceDeRespuesta } from "@/components/tf/enlace-de-respuesta";
import { optionsFrom } from "@/components/tf/options";
import { ACCEPTANCE_STATUS, ROUTE_STATUS } from "@/lib/labels-modules";
import { formatDateTime, formatNumber } from "@/lib/format";

/**
 * RUTAS DE PICKUP, CON LA CONFORMIDAD DEL PROVEEDOR.
 *
 * Lo mismo que en la asignación de recursos, y por el mismo motivo: 0087 añadió el
 * plazo y la respuesta a las DOS tablas, y ninguna de las dos pantallas los
 * enseñaba. La recogida es donde más duele —si el transportista de la ruta de
 * Bávaro no confirma, hay cuarenta personas esperando en la puerta de su hotel.
 */

interface Ruta {
  _id: string;
  name?: string;
  departure?: { product?: { name?: string }; departure_at?: string } | string;
  supplier?: { commercial_name?: string; name?: string } | string;
  zone?: { name?: string } | string;
  start_time?: string;
  pax_total?: number;
  stops_count?: number;
  status?: string;
  acceptance?: string;
  acceptance_deadline?: string;
  responded_via?: string;
  confirmation_number?: string;
}

const nombre = (r: unknown, ...claves: string[]): string => {
  if (!r || typeof r !== "object") return "—";
  const o = r as Record<string, unknown>;
  for (const k of claves) if (typeof o[k] === "string" && o[k]) return o[k] as string;
  return "—";
};

const tituloDe = (r: Ruta): string => {
  const salida = typeof r.departure === "object" && r.departure ? r.departure : null;
  const base = r.name || salida?.product?.name || "Ruta de recogida";
  return salida?.departure_at ? `${base} · ${formatDateTime(salida.departure_at)}` : base;
};

export default function Page() {
  const [version, setVersion] = useState(0);
  const [enlazando, setEnlazando] = useState<Ruta | null>(null);

  return (
    <>
      <ResourcePage
        key={version}
        resource="pickup_route"
        eyebrow="Operaciones"
        title="Rutas de pickup"
        description="Rutas de recogida por zona con su vehículo, conductor, guía y paradas, y si el proveedor las ha confirmado."
        emptyIcon="Route"
        searchPlaceholder="Buscar por nombre de ruta…"
        filters={[
          { name: "status", label: "Estado", options: optionsFrom(ROUTE_STATUS) },
          { name: "acceptance", label: "Conformidad", options: optionsFrom(ACCEPTANCE_STATUS) },
        ]}
        createLabel="Nueva ruta"
        rowActions={(r: Ruta) =>
          typeof r.supplier === "object" && r.supplier && (r.acceptance === "pending" || r.acceptance === "expired") ? (
            <Button variant="ghost" size="sm" onClick={() => setEnlazando(r)}>
              <Icon name="ExternalLink" className="size-3.5" /> Enlace
            </Button>
          ) : null
        }
        columns={[
          { key: "name", header: "Ruta", render: (r: Ruta) => <span className="text-sm">{r.name || "—"}</span> },
          { key: "departure", header: "Salida", hideOn: "md",
            render: (r: Ruta) => {
              const s = typeof r.departure === "object" && r.departure ? r.departure : null;
              return <span className="text-sm">{s?.product?.name || "—"}</span>;
            } },
          { key: "supplier", header: "Proveedor", hideOn: "md",
            render: (r: Ruta) => <span className="text-sm">{nombre(r.supplier, "commercial_name", "name")}</span> },
          { key: "zone", header: "Zona", hideOn: "lg",
            render: (r: Ruta) => <span className="text-sm">{nombre(r.zone, "name")}</span> },
          { key: "start_time", header: "Inicio",
            render: (r: Ruta) => <span className="tf-num text-sm">{r.start_time || "—"}</span> },
          { key: "pax_total", header: "Pax", align: "right",
            render: (r: Ruta) => <span className="tf-num">{formatNumber(r.pax_total ?? 0)}</span> },
          {
            key: "acceptance", header: "Conformidad",
            render: (r: Ruta) => (
              <div className="space-y-1">
                <StatusBadge value={r.acceptance || "not_required"} dict={ACCEPTANCE_STATUS} />
                {r.acceptance === "pending" && r.acceptance_deadline && (
                  <p className="tf-num text-xs text-muted-foreground">
                    hasta {formatDateTime(r.acceptance_deadline)}
                  </p>
                )}
                {r.acceptance === "accepted" && r.responded_via === "tacito" && (
                  <Pill tone="warning">por vencimiento, sin respuesta</Pill>
                )}
                {r.confirmation_number && (
                  <p className="tf-num text-xs text-muted-foreground">{r.confirmation_number}</p>
                )}
              </div>
            ),
          },
          { key: "status", header: "Estado",
            render: (r: Ruta) => <StatusBadge value={r.status} dict={ROUTE_STATUS} /> },
        ]}
        fields={[
          { name: "name", label: "Nombre de la ruta", required: true, span: 2 },
          { name: "departure", label: "Salida", type: "reference", resource: "departure",
            optionLabel: (d: any) => `${d.product?.name || "Salida"} · ${String(d.departure_at || "").slice(0, 16).replace("T", " ")}`,
            span: 2 },
          { name: "zone", label: "Zona", type: "reference", resource: "zone", optionLabel: (z: any) => z.name },
          { name: "vehicle", label: "Vehículo", type: "reference", resource: "vehicle",
            optionLabel: (v: any) => v.plate || v.name || v.code },
          { name: "driver", label: "Chófer", type: "reference", resource: "staff",
            optionLabel: (s: any) => s.full_name || s.code },
          { name: "guide", label: "Guía", type: "reference", resource: "staff",
            optionLabel: (s: any) => s.full_name || s.code },
          { name: "start_time", label: "Primera recogida", placeholder: "06:30" },
          { name: "pax_total", label: "Pasajeros", type: "number" },
          { name: "stops_count", label: "Paradas", type: "number" },
          { name: "status", label: "Estado", type: "select", options: optionsFrom(ROUTE_STATUS) },
          { name: "notes", label: "Notas", type: "textarea", span: 2 },
        ]}
      />

      <EnlaceDeRespuesta
        tipo="pickup_route"
        servicioId={enlazando?._id ?? null}
        titulo={enlazando ? tituloDe(enlazando) : ""}
        onClose={() => { setEnlazando(null); setVersion((v) => v + 1); }}
      />
    </>
  );
}
