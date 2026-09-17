"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { StatusBadge } from "@/components/tf/status-badge";
import { CERT_STATUS, CERT_TYPE, YES_NO } from "@/lib/labels-modules";
import { optionsFrom } from "@/components/tf/options";
import { formatDate } from "@/lib/format";
import { certificationState } from "@/lib/hr";

/**
 * CERTIFICACIONES.
 *
 * Dos cosas cambian aquí respecto de la versión anterior, y las dos importan:
 *
 *  · **El estado que se ve es el REAL.** Antes se pintaba la columna `status`,
 *    que se teclaba el día del alta y no se volvía a tocar: la fecha de
 *    vencimiento pasaba y la insignia seguía verde. Ahora se deduce de la
 *    fecha en el momento de pintar, así que no depende de que el barrido
 *    diario haya corrido.
 *
 *  · **«Bloquea asignación» hace algo.** Era una casilla decorativa. Desde
 *    0051, una certificación bloqueante vencida impide crear el turno, publicar
 *    el cuadrante y asignar a esa persona a una salida.
 */

/** Hoy, en la forma en que el dominio compara días. */
const hoy = () => new Date().toISOString().slice(0, 10);

export default function Page() {
  return (
    <SimpleResource
      resource="certification"
      eyebrow="Equipo"
      title="Certificaciones"
      description="Licencias, cursos y certificados del personal. Una certificación vencida puede bloquear la asignación a un turno."
      emptyIcon="Award"
      filters={[
        { name: "status", label: "Estado", dict: CERT_STATUS },
        { name: "cert_type", label: "Tipo", dict: CERT_TYPE },
      ]}
      emptyTitle="Sin certificaciones"
      emptyDescription="Licencias y acreditaciones del equipo, con su vencimiento."
      createLabel="Nueva certificación"
      fields={[
        { name: "name", label: "Certificación", required: true },
        { name: "staff", label: "Personal", type: "reference", resource: "staff", optionLabel: (s: any) => s.full_name || s.code },
        { name: "cert_type", label: "Tipo", type: "select", defaultValue: "first_aid", options: optionsFrom(CERT_TYPE) },
        { name: "issuer", label: "Emitida por" },
        { name: "number", label: "Número" },
        { name: "issued_at", label: "Emitida el", type: "date" },
        { name: "expires_at", label: "Vence", type: "date" },
        { name: "status", label: "Estado", type: "select", defaultValue: "valid", options: optionsFrom(CERT_STATUS) },
        { name: "blocks_assignment", label: "Bloquea asignación si vence", type: "select", defaultValue: "no", options: optionsFrom(YES_NO) },
        { name: "notes", label: "Notas", type: "textarea", span: 2 },
      ]}
      columns={[
        { key: "name", header: "Certificación" },
        { key: "staff", header: "Persona", kind: "ref" },
        { key: "cert_type", header: "Tipo", kind: "badge", dict: CERT_TYPE },
        { key: "issued_at", header: "Emitida", kind: "date", hideOn:"md" },
        {
          key: "expires_at", header: "Vence",
          render: (c: any) => {
            const estado = certificationState(c, hoy());
            return (
              <span className={estado === "expired" ? "font-semibold text-destructive" : estado === "expiring" ? "font-semibold text-amber-600" : ""}>
                {c.expires_at ? formatDate(c.expires_at) : "No caduca"}
              </span>
            );
          },
        },
        {
          key: "status", header: "Estado",
          // Deducido de la fecha, no leído de la columna: ese era el fallo.
          render: (c: any) => <StatusBadge value={certificationState(c, hoy())} dict={CERT_STATUS} />,
        },
        {
          key: "blocks_assignment", header: "Bloquea",
          render: (c: any) =>
            c.blocks_assignment ? (
              <span className="text-xs font-semibold">Sí, impide asignar</span>
            ) : (
              <span className="text-xs text-muted-foreground">No</span>
            ),
        },
      ]}
    />
  );
}
