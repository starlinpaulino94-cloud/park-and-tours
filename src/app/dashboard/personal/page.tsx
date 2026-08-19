"use client";

import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge } from "@/components/tf/status-badge";
import { GENERIC_STATUS, LANGUAGE, STAFF_TYPE, labelOf } from "@/lib/labels";
import { formatDate, formatMoney } from "@/lib/format";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";
import type { Staff } from "@/lib/types";

export default function StaffPage() {
  return (
    <ResourcePage
      resource="staff"
      eyebrow="Operación"
      title="Guías y personal operativo"
      description="Guías, conductores, fotógrafos, coordinadores y personal externo, con idiomas, documentación, tarifas y disponibilidad."
      createLabel="Nuevo miembro"
      searchPlaceholder="Buscar por nombre, email o documento…"
      emptyIcon="IdCard"
      emptyTitle="Sin personal registrado"
      filters={[
        { name: "staff_type", label: "Tipo", options: optionsFrom(STAFF_TYPE) },
        { name: "status", label: "Estado", options: optionsFrom(GENERIC_STATUS, ["active", "inactive", "unavailable"]) },
      ]}
      columns={[
        {
          key: "name", header: "Persona",
          render: (s: any) => (
            <div>
              <p className="font-semibold">{s.full_name}</p>
              <p className="text-xs text-muted-foreground">{s.email || s.phone || "Sin contacto"}</p>
            </div>
          ),
        },
        { key: "type", header: "Función", render: (s: any) => <StatusBadge value={s.staff_type} dict={STAFF_TYPE} dot={false} /> },
        { key: "langs", header: "Idiomas", hideOn: "md",
          render: (s: any) => (s.languages?.length ? s.languages.map((l: string) => labelOf(LANGUAGE, l).label).join(", ") : "—") },
        { key: "rate", header: "Tarifa diaria", align: "right", hideOn: "sm",
          render: (s: any) => formatMoney(s.daily_rate ?? 0, s.currency || "usd") },
        { key: "license", header: "Licencia", hideOn: "lg", render: (s: any) => (s.license_expiry ? formatDate(s.license_expiry) : "—") },
        { key: "status", header: "Estado", render: (s: any) => <StatusBadge value={s.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "full_name", label: "Nombre completo", required: true },
        { name: "staff_type", label: "Función", type: "select", defaultValue: "guide", options: optionsFrom(STAFF_TYPE) },
        { name: "email", label: "Email", type: "email" },
        { name: "phone", label: "Teléfono" },
        { name: "document_id", label: "Documento" },
        { name: "languages", label: "Idiomas", type: "multiselect", placeholder: "es, en, fr", help: "Códigos separados por comas." },
        { name: "daily_rate", label: "Tarifa diaria", type: "number" },
        { name: "currency", label: "Moneda", type: "select", options: CURRENCY_OPTIONS },
        { name: "supplier", label: "Proveedor (si es externo)", type: "reference", resource: "supplier" },
        { name: "hire_date", label: "Fecha de alta", type: "date" },
        { name: "license_expiry", label: "Vencimiento de licencia", type: "date" },
        { name: "photo_url", label: "Foto (URL)", type: "url" },
        { name: "status", label: "Estado", type: "select", defaultValue: "active", options: [
          { value: "active", label: "Activo" }, { value: "inactive", label: "Inactivo" }, { value: "unavailable", label: "No disponible" },
        ] },
        { name: "notes", label: "Notas", type: "textarea", span: 2 },
      ]}
    />
  );
}
