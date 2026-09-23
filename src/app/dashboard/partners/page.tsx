"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { Icon } from "@/components/tf/icon";
import { GENERIC_STATUS, PARTNER_TYPE } from "@/lib/labels";
import { formatMoney, formatPercent } from "@/lib/format";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";

interface PartnerBalance { balance: number; documents: number; overdue: number; currency?: string }

export default function PartnersPage() {
  // El saldo no vive en la ficha del partner: son sus cuentas por cobrar
  // abiertas. Se traen una vez y se cruzan por id, que es lo que da sentido al
  // límite de crédito de al lado.
  const [balances, setBalances] = useState<Record<string, PartnerBalance>>({});

  useEffect(() => {
    let alive = true;
    api.get<Record<string, PartnerBalance>>("/api/partners/balances").then((res) => {
      if (alive && res.ok && res.data) setBalances(res.data);
    });
    return () => { alive = false; };
  }, []);

  const balanceOf = (id: string) => balances[id]?.balance ?? 0;
  const overLimit = (p: any) => Boolean(p.credit_limit) && balanceOf(p._id) > p.credit_limit;

  return (
    <ResourcePage
      resource="partner"
      eyebrow="Red de ventas"
      title="Tour centers, agencias y partners"
      description="Contratos, condiciones comerciales, límite de crédito, tarifas B2B y catálogo autorizado de cada canal externo."
      createLabel="Nuevo partner"
      searchPlaceholder="Buscar por nombre comercial, RNC, contacto o email…"
      emptyIcon="Handshake"
      emptyTitle="Aún no hay partners"
      emptyDescription="Da de alta tus tour centers y agencias para venderles con tarifa neta y comisión propia."
      filters={[
        { name: "partner_type", label: "Tipo", options: optionsFrom(PARTNER_TYPE) },
        { name: "status", label: "Estado", options: optionsFrom(GENERIC_STATUS, ["active", "inactive", "blocked", "pending"]) },
      ]}
      columns={[
        {
          key: "name", header: "Partner",
          render: (p: any) => (
            <div>
              <p className="font-semibold">{p.commercial_name || p.name}</p>
              <p className="text-xs text-muted-foreground">{p.city ? `${p.city} · ` : ""}{p.contact_name || p.email || "Sin contacto"}</p>
            </div>
          ),
        },
        { key: "type", header: "Tipo", render: (p: any) => <StatusBadge value={p.partner_type} dict={PARTNER_TYPE} dot={false} /> },
        { key: "commission", header: "Comisión", align: "right", hideOn: "sm", render: (p: any) => formatPercent(p.default_commission_pct ?? 0) },
        { key: "credit", header: "Crédito", align: "right", hideOn: "md",
          render: (p: any) => (
            <div>
              <p>{p.credit_limit ? formatMoney(p.credit_limit, p.currency || "usd") : "Sin límite"}</p>
              <p className="text-[11px] text-muted-foreground">{p.credit_days ?? 0} días</p>
            </div>
          ) },
        { key: "balance", header: "Saldo", align: "right",
          render: (p: any) => {
            const balance = balanceOf(p._id);
            const entry = balances[p._id];
            return (
              <div>
                <span className={overLimit(p) ? "font-semibold text-rose-700 dark:text-rose-300" : balance > 0 ? "font-semibold text-amber-700 dark:text-amber-300" : ""}>
                  {formatMoney(balance, entry?.currency || p.currency || "usd")}
                </span>
                {entry && entry.overdue > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    {formatMoney(entry.overdue, entry.currency || p.currency || "usd")} vencido
                  </p>
                )}
              </div>
            );
          } },
        { key: "limit", header: "", align: "right", hideOn: "sm",
          render: (p: any) => overLimit(p)
            ? <Pill tone="danger"><Icon name="TriangleAlert" className="size-3" /> Sobre el límite</Pill>
            : null },
        { key: "status", header: "Estado", render: (p: any) => <StatusBadge value={p.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "name", label: "Razón social", required: true },
        { name: "commercial_name", label: "Nombre comercial" },
        { name: "partner_type", label: "Tipo", type: "select", required: true, defaultValue: "tour_center", options: optionsFrom(PARTNER_TYPE) },
        { name: "tax_id", label: "RNC / Identificación fiscal" },
        { name: "contact_name", label: "Persona de contacto" },
        { name: "email", label: "Email", type: "email" },
        { name: "phone", label: "Teléfono" },
        { name: "whatsapp", label: "WhatsApp" },
        { name: "city", label: "Ciudad" },
        { name: "country", label: "País" },
        /**
         * Cómo gana este socio. Va justo encima de la comisión estándar a
         * propósito: con «neto» esa casilla deja de aplicarse, y verlas juntas
         * es lo que evita rellenar las dos creyendo que se suman.
         */
        { name: "pricing_model", label: "Modelo comercial", type: "select", defaultValue: "commission",
          help: "Con «neto» su margen ya va en el precio: no se le liquida comisión.",
          options: [
            { value: "commission", label: "Vende a tarifa y cobra comisión" },
            { value: "net", label: "Compra a precio neto (sin comisión)" },
          ] },
        { name: "default_commission_pct", label: "Comisión estándar", type: "number", suffix: "%" },
        { name: "currency", label: "Moneda", type: "select", options: CURRENCY_OPTIONS },
        /**
         * Cómo PAGA este socio, y va justo encima del límite de crédito por el
         * mismo motivo que el modelo comercial va encima de la comisión: con
         * «prepago» esas dos casillas dejan de aplicarse, y verlas juntas evita
         * rellenar las dos creyendo que se suman.
         */
        { name: "payment_mode", label: "Forma de pago", type: "select", defaultValue: "credit",
          help: "Con «prepago» cada venta descuenta de su saldo y no hay descubierto: sin saldo no vende.",
          options: [
            { value: "credit", label: "A crédito (vende ahora, paga después)" },
            { value: "prepaid", label: "Prepago (ingresa y va gastando)" },
          ] },
        /**
         * Y QUIÉN COBRA al turista. Va junto a la forma de pago porque son las
         * dos mitades de la misma pregunta —quién tiene el dinero y cuándo— y
         * declararlas lejos una de otra es cómo se pactan dos cosas que no
         * encajan.
         */
        { name: "collection_mode", label: "Quién cobra al turista", type: "select",
          defaultValue: "operator_collects",
          help: "Con «cobra el punto de venta», su efectivo no pasa por tu caja y te debe el neto.",
          options: [
            { value: "operator_collects", label: "El cliente paga todo al operador" },
            { value: "pos_collects", label: "Cobra el punto de venta y debe el neto" },
            { value: "seller_retains", label: "Su vendedor retiene la comisión; el cliente paga el resto al subir" },
          ] },
        { name: "credit_limit", label: "Límite de crédito", type: "number" },
        { name: "credit_days", label: "Días de crédito", type: "number" },
        { name: "contract_from", label: "Contrato desde", type: "date" },
        { name: "contract_to", label: "Contrato hasta", type: "date" },
        { name: "parent_partner", label: "Depende de", type: "reference", resource: "partner",
          help: "Para subagencias dentro de una agencia matriz." },
        { name: "status", label: "Estado", type: "select", defaultValue: "active", options: [
          { value: "active", label: "Activo" }, { value: "inactive", label: "Inactivo" },
          { value: "blocked", label: "Bloqueado" }, { value: "pending", label: "Pendiente" },
        ] },
        { name: "address", label: "Dirección", span: 2 },
        { name: "commercial_terms", label: "Condiciones comerciales", type: "textarea", span: 2 },
        { name: "notes", label: "Notas internas", type: "textarea", span: 2 },
      ]}
    />
  );
}
