"use client";

import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge } from "@/components/tf/status-badge";
import { GENERIC_STATUS } from "@/lib/labels";
import { formatDate, formatMoney } from "@/lib/format";
import { CURRENCY_OPTIONS, LANGUAGE_OPTIONS } from "@/components/tf/options";
import type { Customer } from "@/lib/types";

const fullName = (c: any) => [c.first_name, c.last_name].filter(Boolean).join(" ") || "Sin nombre";

export default function CustomersPage() {
  return (
    <ResourcePage
      resource="customer"
      eyebrow="Comercial"
      title="Clientes"
      description="El comprador y los participantes son entidades distintas: un cliente puede comprar entradas para otras personas."
      createLabel="Nuevo cliente"
      searchPlaceholder="Buscar por nombre, email, teléfono o documento…"
      emptyIcon="Users"
      emptyTitle="Todavía no hay clientes"
      emptyDescription="Los clientes se crean automáticamente al registrar una venta, o puedes darlos de alta aquí."
      columns={[
        {
          key: "name", header: "Cliente",
          render: (c: any) => (
            <div>
              <p className="font-semibold">{fullName(c)}</p>
              <p className="text-xs text-muted-foreground">{c.email || c.phone || "Sin contacto"}</p>
            </div>
          ),
        },
        { key: "country", header: "País", hideOn: "md", render: (c: any) => c.country || c.nationality || "—" },
        {
          key: "hotel", header: "Hotel", hideOn: "lg",
          render: (c: any) => (typeof c.hotel === "object" && c.hotel ? `${c.hotel.name}${c.room ? ` · hab. ${c.room}` : ""}` : "—"),
        },
        { key: "bookings", header: "Reservas", align: "right", hideOn: "sm", render: (c: any) => c.bookings_count ?? 0 },
        { key: "spent", header: "Facturado", align: "right", render: (c: any) => formatMoney(c.total_spent ?? 0, "usd") },
        { key: "created", header: "Alta", align: "right", hideOn: "lg", render: (c: any) => formatDate(c.createdAt) },
        { key: "status", header: "Estado", render: (c: any) => <StatusBadge value={c.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "first_name", label: "Nombre", required: true },
        { name: "last_name", label: "Apellidos" },
        { name: "email", label: "Email", type: "email" },
        { name: "phone", label: "Teléfono" },
        { name: "whatsapp", label: "WhatsApp" },
        { name: "document_id", label: "Documento / pasaporte" },
        { name: "country", label: "País" },
        { name: "nationality", label: "Nacionalidad" },
        { name: "language", label: "Idioma", type: "select", options: LANGUAGE_OPTIONS },
        { name: "birth_date", label: "Fecha de nacimiento", type: "date" },
        { name: "hotel", label: "Hotel", type: "reference", resource: "hotel" },
        { name: "room", label: "Habitación" },
        { name: "assigned_seller", label: "Vendedor asignado", type: "reference", resource: "seller",
          optionLabel: (s: any) => [s.first_name, s.last_name].filter(Boolean).join(" ") },
        { name: "source", label: "Origen", type: "select", options: [
          { value: "web", label: "Web" }, { value: "walk_in", label: "Walk-in" },
          { value: "referral", label: "Referido" }, { value: "whatsapp", label: "WhatsApp" },
          { value: "agency", label: "Agencia" }, { value: "ota", label: "OTA" },
        ] },
        { name: "status", label: "Estado", type: "select", defaultValue: "active", options: [
          { value: "active", label: "Activo" }, { value: "inactive", label: "Inactivo" }, { value: "blacklist", label: "Lista negra" },
        ] },
        { name: "address", label: "Dirección", span: 2 },
        { name: "preferences", label: "Preferencias", type: "textarea", span: 2 },
        { name: "notes", label: "Notas internas", type: "textarea", span: 2 },
      ]}
    />
  );
}
