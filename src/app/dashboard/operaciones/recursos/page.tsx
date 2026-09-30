"use client";

import { useState } from "react";
import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { EnlaceDeRespuesta } from "@/components/tf/enlace-de-respuesta";
import { optionsFrom } from "@/components/tf/options";
import { ACCEPTANCE_STATUS, RESOURCE_ROLE, RESOURCE_STATUS } from "@/lib/labels-modules";
import { formatDateTime, formatNumber } from "@/lib/format";

/**
 * ASIGNACIÓN DE RECURSOS, CON LA CONFORMIDAD DEL PROVEEDOR A LA VISTA.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LO QUE FALTABA
 *
 * Esta pantalla enseñaba vehículo, persona y estado, y **no enseñaba de quién era
 * el servicio ni si ese proveedor había aceptado** — aunque la fila lo sabe: el
 * disparador de 0085 deriva `supplier_id` del vehículo o de la persona, y 0087
 * añadió el plazo y la respuesta.
 *
 * Y `POST /api/proveedor/enlace`, que es la única forma de crear la credencial con
 * la que un proveedor SIN CUENTA contesta, no la llamaba nadie. El camino sin
 * cuenta estaba construido de punta a punta —página pública incluida— y sin manera
 * de empezarlo.
 *
 * Juntas, las dos cosas valen más que separadas: mandar el enlace sin poder ver
 * quién no ha contestado es trabajar a ciegas, y ver quién no ha contestado sin
 * poder mandarle nada es peor.
 */

interface Recurso {
  _id: string;
  departure?: { product?: { name?: string }; departure_at?: string } | string;
  supplier?: { commercial_name?: string; name?: string } | string;
  vehicle?: { plate?: string; name?: string } | string;
  staff?: { full_name?: string } | string;
  resource_role?: string;
  pax_assigned?: number;
  status?: string;
  acceptance?: string;
  acceptance_deadline?: string;
  responded_at?: string;
  responded_via?: string;
  confirmation_number?: string;
}

const nombre = (r: unknown, ...claves: string[]): string => {
  if (!r || typeof r !== "object") return "—";
  const o = r as Record<string, unknown>;
  for (const k of claves) if (typeof o[k] === "string" && o[k]) return o[k] as string;
  return "—";
};

/** Cómo se llama esta asignación en el mensaje que se le manda al proveedor. */
function tituloDe(r: Recurso): string {
  const salida = typeof r.departure === "object" && r.departure ? r.departure : null;
  const producto = salida?.product?.name || "Salida";
  const cuando = salida?.departure_at ? ` · ${formatDateTime(salida.departure_at)}` : "";
  return `${producto}${cuando}`;
}

export default function Page() {
  const [version, setVersion] = useState(0);
  const [enlazando, setEnlazando] = useState<Recurso | null>(null);

  return (
    <>
      <ResourcePage
        key={version}
        resource="departure_resource"
        eyebrow="Operaciones"
        title="Asignación de recursos"
        description="Qué vehículo, guía y personal cubre cada salida, y si el proveedor lo ha confirmado. Un conflicto aquí es una salida que no puede operar."
        emptyIcon="Boxes"
        searchPlaceholder="Buscar por notas…"
        filters={[
          { name: "resource_role", label: "Rol", options: optionsFrom(RESOURCE_ROLE) },
          { name: "status", label: "Estado", options: optionsFrom(RESOURCE_STATUS) },
          // La pregunta que se hace despacho por la mañana: quién no ha contestado.
          { name: "acceptance", label: "Conformidad", options: optionsFrom(ACCEPTANCE_STATUS) },
        ]}
        createLabel="Asignar recurso"
        rowActions={(r: Recurso) =>
          // Solo si hay proveedor y sigue sin contestar: la ruta rechaza el resto
          // con su motivo, pero ofrecer un botón que va a fallar es un callejón.
          typeof r.supplier === "object" && r.supplier && (r.acceptance === "pending" || r.acceptance === "expired") ? (
            <Button variant="ghost" size="sm" onClick={() => setEnlazando(r)}>
              <Icon name="ExternalLink" className="size-3.5" /> Enlace
            </Button>
          ) : null
        }
        columns={[
          { key: "departure", header: "Salida",
            render: (r: Recurso) => <span className="text-sm">{tituloDe(r)}</span> },
          { key: "resource_role", header: "Rol",
            render: (r: Recurso) => <StatusBadge value={r.resource_role} dict={RESOURCE_ROLE} /> },
          { key: "supplier", header: "Proveedor", hideOn: "md",
            render: (r: Recurso) => (
              <span className="text-sm">{nombre(r.supplier, "commercial_name", "name")}</span>
            ) },
          { key: "recurso", header: "Vehículo / persona", hideOn: "lg",
            render: (r: Recurso) => (
              <span className="text-sm">
                {nombre(r.vehicle, "plate", "name") !== "—"
                  ? nombre(r.vehicle, "plate", "name")
                  : nombre(r.staff, "full_name")}
              </span>
            ) },
          { key: "pax_assigned", header: "Pax", align: "right",
            render: (r: Recurso) => <span className="tf-num">{formatNumber(r.pax_assigned ?? 0)}</span> },
          {
            key: "acceptance", header: "Conformidad",
            /**
             * El plazo debajo del estado, y solo cuando importa. «Sin contestar»
             * a secas no dice si queda un día o dos horas, que es lo único que
             * decide si se llama por teléfono ahora o después.
             */
            render: (r: Recurso) => (
              <div className="space-y-1">
                <StatusBadge value={r.acceptance || "not_required"} dict={ACCEPTANCE_STATUS} />
                {r.acceptance === "pending" && r.acceptance_deadline && (
                  <p className="tf-num text-xs text-muted-foreground">
                    hasta {formatDateTime(r.acceptance_deadline)}
                  </p>
                )}
                {r.acceptance === "accepted" && r.responded_via === "tacito" && (
                  // Tácito quiere decir que NO contestó nadie y lo dio por bueno una
                  // política. El día que se discuta, esa diferencia es todo lo que hay.
                  <Pill tone="warning">por vencimiento, sin respuesta</Pill>
                )}
                {r.confirmation_number && (
                  <p className="tf-num text-xs text-muted-foreground">{r.confirmation_number}</p>
                )}
              </div>
            ),
          },
          { key: "status", header: "Estado",
            render: (r: Recurso) => <StatusBadge value={r.status} dict={RESOURCE_STATUS} /> },
        ]}
        fields={[
          { name: "departure", label: "Salida", type: "reference", resource: "departure",
            optionLabel: (d: any) => `${d.product?.name || "Salida"} · ${String(d.departure_at || "").slice(0, 16).replace("T", " ")}`,
            required: true, span: 2 },
          { name: "resource_role", label: "Rol", type: "select", options: optionsFrom(RESOURCE_ROLE) },
          { name: "staff", label: "Persona", type: "reference", resource: "staff",
            optionLabel: (s: any) => s.full_name || s.code },
          { name: "vehicle", label: "Vehículo", type: "reference", resource: "vehicle",
            optionLabel: (v: any) => v.plate || v.name || v.code },
          { name: "pax_assigned", label: "Pasajeros asignados", type: "number" },
          { name: "start_time", label: "Desde", placeholder: "07:00" },
          { name: "end_time", label: "Hasta", placeholder: "15:00" },
          { name: "status", label: "Estado", type: "select", options: optionsFrom(RESOURCE_STATUS) },
          { name: "notes", label: "Notas", type: "textarea", span: 2 },
        ]}
      />

      <EnlaceDeRespuesta
        tipo="departure_resource"
        servicioId={enlazando?._id ?? null}
        titulo={enlazando ? tituloDe(enlazando) : ""}
        onClose={() => { setEnlazando(null); setVersion((v) => v + 1); }}
      />
    </>
  );
}
