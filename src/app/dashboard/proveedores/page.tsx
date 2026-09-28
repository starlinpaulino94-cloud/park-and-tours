"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ResourcePage } from "@/components/tf/resource-page";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/tf/icon";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/tf/status-badge";
import { GENERIC_STATUS, SUPPLIER_TYPE, TAX_REGIME } from "@/lib/labels";
import { formatMoney } from "@/lib/format";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";
import type { Supplier } from "@/lib/types";

export default function SuppliersPage() {
  /**
   * «Crear cuenta e invitar», igual que en Vendedores y por el mismo motivo.
   *
   * El portal del proveedor —sus servicios, aceptar o rechazar con plazo, la
   * hoja de ruta del chofer, su estado de cuenta, facturar con NCF— se abre con
   * la cuenta vinculada a la ficha, y hasta ahora NADA en el producto podía
   * ponerla: ni este formulario ni ninguna ruta. Toda esa fase estaba
   * construida y sin puerta por la que entrar.
   */
  const [invitando, setInvitando] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const invitar = async (proveedor: any) => {
    if (!proveedor.email) {
      toast.error("Pon primero el correo de este proveedor en su ficha");
      return;
    }
    setInvitando(proveedor._id);
    const res = await api.post<{ invited?: { email?: string } }>(
      "/api/suppliers/invite", { supplier_id: proveedor._id }
    );
    setInvitando(null);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo crear la cuenta");
      return;
    }
    toast.success(`Invitación enviada a ${res.data?.invited?.email || proveedor.email}`);
    setVersion((v) => v + 1);
  };

  return (
    <ResourcePage
      key={version}
      resource="supplier"
      eyebrow="Finanzas"
      title="Proveedores"
      description="Transportistas, restaurantes, embarcaciones, parques, guías y servicios externos con sus condiciones de pago y saldo."
      createLabel="Nuevo proveedor"
      emptyIcon="Truck"
      emptyTitle="Sin proveedores"
      rowActions={(s: any) => (s.user || s.user_id ? null : (
        <Button
          variant="ghost" size="icon" className="size-8 text-amber-600 hover:text-amber-700"
          aria-label="Crear cuenta e invitar"
          title="Crear cuenta de acceso e invitar al portal del proveedor"
          disabled={invitando === s._id}
          onClick={() => invitar(s)}
        >
          <Icon name={invitando === s._id ? "Loader2" : "UserPlus"} className={invitando === s._id ? "size-3.5 animate-spin" : "size-3.5"} />
        </Button>
      ))}
      filters={[{ name: "supplier_type", label: "Tipo", options: optionsFrom(SUPPLIER_TYPE) }]}
      columns={[
        {
          key: "name", header: "Proveedor",
          render: (s: any) => (
            <div>
              <p className="font-semibold">{s.name}</p>
              <p className="text-xs text-muted-foreground">{s.contact_name || s.email || s.phone || "Sin contacto"}</p>
            </div>
          ),
        },
        { key: "type", header: "Tipo", render: (s: any) => <StatusBadge value={s.supplier_type} dict={SUPPLIER_TYPE} dot={false} /> },
        { key: "terms", header: "Condiciones", align: "right", hideOn: "sm", render: (s: any) => `${s.payment_terms_days ?? 0} días` },
        { key: "balance", header: "Saldo", align: "right", render: (s: any) => formatMoney(s.balance ?? 0, s.currency || "usd") },
        {
          /**
           * QUIÉN PUEDE ENTRAR AL PORTAL, DICHO EN LA LISTA.
           *
           * Sin esta columna, que una ficha no tenga cuenta no se ve en ningún
           * sitio: se descubre el día que el proveedor llama porque no puede
           * confirmar un servicio. Un dato que falta y no se nota es el que
           * más tarda en arreglarse.
           */
          key: "acceso", header: "Portal", hideOn: "sm",
          render: (s: any) => (s.user || s.user_id
            ? <StatusBadge value="active" dict={GENERIC_STATUS} />
            : <span className="text-xs text-amber-600">Sin cuenta</span>),
        },
        { key: "status", header: "Estado", render: (s: any) => <StatusBadge value={s.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "name", label: "Nombre", required: true },
        { name: "supplier_type", label: "Tipo", type: "select", defaultValue: "transport", options: optionsFrom(SUPPLIER_TYPE) },
        { name: "tax_id", label: "RNC / Identificación" },
        { name: "contact_name", label: "Contacto" },
        { name: "email", label: "Email", type: "email" },
        { name: "phone", label: "Teléfono" },
        { name: "payment_terms_days", label: "Días de pago", type: "number" },
        { name: "currency", label: "Moneda", type: "select", options: CURRENCY_OPTIONS },
        // Régimen fiscal y retenciones (0040). Es lo que decide cuánto se le
        // transfiere de verdad: a una persona física hay que retenerle ISR e
        // ITBIS, y pagarle el bruto deja a la empresa debiéndoselo al fisco.
        { name: "tax_regime", label: "Régimen fiscal", type: "select", defaultValue: "company",
          options: optionsFrom(TAX_REGIME),
          help: "Una persona física lleva retención de ISR e ITBIS; una empresa formal, normalmente ninguna." },
        { name: "tax_rate", label: "ITBIS que factura (%)", type: "number",
          help: "Para poder separar el impuesto del importe bruto. En blanco, se entiende que no factura ITBIS." },
        { name: "retention_isr_pct", label: "Retención de ISR (%)", type: "number",
          help: "En blanco, se aplica la del régimen. Un 0 explícito significa no retener." },
        { name: "retention_itbis_pct", label: "Retención de ITBIS (%)", type: "number",
          help: "Porcentaje del ITBIS facturado que se retiene." },
        { name: "bank_name", label: "Banco" },
        { name: "bank_account", label: "Cuenta bancaria" },
        /**
         * La cuenta con la que entra este proveedor.
         *
         * Es lo que convierte «hay un proveedor» en «este proveedor puede
         * confirmar sus servicios». Vincula una cuenta que YA existe; para
         * crearla de cero está el botón de la fila.
         */
        { name: "user", label: "Cuenta de acceso", type: "reference", optionsPath: "/api/team?limit=300",
          optionLabel: (u: any) => `${u.name || u.email}${u.email && u.name ? ` · ${u.email}` : ""}`,
          span: 2,
          help: "Sin esto no puede entrar a su portal: no verá sus servicios ni podrá aceptarlos o rechazarlos." },
        { name: "address", label: "Dirección", span: 2 },
        { name: "notes", label: "Notas", type: "textarea", span: 2 },
        { name: "status", label: "Estado", type: "select", defaultValue: "active",
          options: [{ value: "active", label: "Activo" }, { value: "inactive", label: "Inactivo" }] },
      ]}
    />
  );
}
