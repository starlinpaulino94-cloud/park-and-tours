"use client";

import Link from "next/link";
import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/tf/icon";
import { GENERIC_STATUS, PRODUCT_TYPE } from "@/lib/labels";
import { DEPOSIT_TYPE } from "@/lib/labels-modules";
import { formatMoney, formatNumber } from "@/lib/format";
import { CURRENCY_OPTIONS, optionsFrom } from "@/components/tf/options";

export default function ProductsPage() {
  return (
    <ResourcePage
      resource="product"
      eyebrow="Comercial"
      title="Excursiones y productos"
      description="El catálogo es la fuente de verdad: de aquí salen los precios, los cupos, los costes y las comisiones de toda la operación."
      createLabel="Nueva excursión"
      searchPlaceholder="Buscar por nombre, código o ubicación…"
      emptyIcon="Ticket"
      emptyTitle="Todavía no hay excursiones"
      emptyDescription="Crea tu primera excursión para poder generar salidas y empezar a vender."
      initialSort="sort_order"
      extraActions={
        <Link href="/dashboard/salidas">
          <Button variant="outline" className="gap-1.5">
            <Icon name="CalendarRange" className="size-4" /> Generar salidas
          </Button>
        </Link>
      }
      filters={[
        { name: "product_type", label: "Tipo", options: optionsFrom(PRODUCT_TYPE) },
        { name: "status", label: "Estado", options: optionsFrom(GENERIC_STATUS, ["active", "inactive", "archived"]) },
      ]}
      columns={[
        {
          key: "name", header: "Excursión",
          render: (p: any) => (
            <div className="flex items-center gap-3">
              {p.cover_image_url ? (
                <img src={p.cover_image_url} alt={p.name}
                  className="size-10 shrink-0 rounded-lg object-cover" />
              ) : (
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Icon name="Ticket" className="size-4" />
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate font-semibold">{p.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[p.code, typeof p.category === "object" ? p.category?.name : null, p.location]
                    .filter(Boolean).join(" · ") || "Sin categoría"}
                </p>
              </div>
            </div>
          ),
        },
        {
          key: "modalities", header: "Modalidades", align: "center", hideOn: "lg",
          render: (p: any) => formatNumber((p.product_modality || []).length),
        },
        { key: "duration", header: "Duración", align: "right", hideOn: "md",
          render: (p: any) => (p.duration_hours ? `${p.duration_hours} h` : "—") },
        { key: "capacity", header: "Cupo", align: "right", hideOn: "sm",
          render: (p: any) => formatNumber(p.default_capacity ?? 0) },
        { key: "cost", header: "Coste", align: "right", hideOn: "lg",
          render: (p: any) => formatMoney(p.base_cost ?? 0, p.currency) },
        { key: "price", header: "Precio base", align: "right",
          render: (p: any) => <span className="font-semibold">{formatMoney(p.base_price ?? 0, p.currency)}</span> },
        {
          key: "margin", header: "Margen", align: "right", hideOn: "lg",
          render: (p: any) => {
            const price = p.base_price ?? 0;
            const margin = price - (p.base_cost ?? 0);
            const pct = price > 0 ? (margin / price) * 100 : 0;
            return (
              <span className={margin >= 0 ? "font-semibold text-emerald-700 dark:text-emerald-400" : "font-semibold text-rose-700 dark:text-rose-400"}>
                {pct.toFixed(0)}%
              </span>
            );
          },
        },
        // Publicado en la web: se ve de un vistazo desde el listado, que es
        // donde alguien se pregunta «¿esto ya está en la página?».
        { key: "published", header: "Web", align: "center", hideOn: "md",
          render: (p: any) => (p.published
            ? <Pill tone="success">En la web</Pill>
            : <span className="text-xs text-muted-foreground">—</span>) },
        { key: "status", header: "Estado", render: (p: any) => <StatusBadge value={p.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "name", label: "Nombre", required: true, span: 2 },
        { name: "code", label: "Código" },
        { name: "category", label: "Categoría", type: "reference", resource: "product_category" },
        { name: "product_type", label: "Tipo", type: "select", defaultValue: "excursion", options: optionsFrom(PRODUCT_TYPE) },
        { name: "cancellation_policy", label: "Política de cancelación", type: "reference", resource: "cancellation_policy" },
        { name: "base_price", label: "Precio base", type: "number", required: true },
        { name: "base_cost", label: "Coste base", type: "number", help: "Se usa para calcular el margen de cada venta." },
        { name: "currency", label: "Moneda", type: "select", defaultValue: "usd", options: CURRENCY_OPTIONS },
        { name: "default_capacity", label: "Cupo por salida", type: "number", defaultValue: 40 },
        { name: "duration_hours", label: "Duración (horas)", type: "number" },
        { name: "min_age", label: "Edad mínima", type: "number" },
        { name: "location", label: "Ubicación" },
        { name: "meeting_point", label: "Punto de encuentro" },
        { name: "languages", label: "Idiomas", type: "multiselect", placeholder: "es, en, fr",
          help: "Códigos separados por comas." },
        { name: "sort_order", label: "Orden", type: "number" },
        // Política de cobro (0039). Es lo que hace que cada venta de este tour
        // nazca con su anticipo y su fecha de saldo sin teclear nada.
        { name: "deposit_type", label: "Anticipo al reservar", type: "select", defaultValue: "none",
          options: optionsFrom(DEPOSIT_TYPE),
          help: "Qué se cobra para bloquear la plaza. El resto es el saldo." },
        { name: "deposit_percent", label: "Anticipo (%)", type: "number",
          help: "Solo si el anticipo es un porcentaje del total." },
        { name: "deposit_amount", label: "Anticipo (importe)", type: "number",
          help: "Solo si el anticipo es un importe fijo por reserva." },
        { name: "balance_due_days", label: "Saldo, días antes de la salida", type: "number",
          help: "Con 15, el saldo vence quince días antes de viajar. Una reserva de última hora vence hoy." },
        { name: "cover_image_url", label: "Imagen de portada (URL)", type: "url", span: 2 },
        { name: "short_description", label: "Descripción corta", span: 2 },
        { name: "description", label: "Descripción", type: "textarea", span: 2 },
        { name: "inclusions", label: "Qué incluye", type: "textarea", span: 2 },
        { name: "exclusions", label: "Qué no incluye", type: "textarea", span: 2 },
        { name: "recommendations", label: "Recomendaciones", type: "textarea", span: 2 },
        { name: "restrictions", label: "Restricciones", type: "textarea", span: 2 },
        { name: "status", label: "Estado", type: "select", defaultValue: "active",
          options: optionsFrom(GENERIC_STATUS, ["active", "inactive", "archived"]) },
        // 0047 — el motor público. Apagado de fábrica: hay excursiones que solo
        // se venden a agencias y otras a medio armar, y lo que se publica una
        // vez ya no se despublica de internet.
        { name: "published", label: "Publicar en la web", type: "select", defaultValue: "no",
          options: [{ value: "yes", label: "Sí, se puede reservar en línea" }, { value: "no", label: "No" }],
          help: "Aparece en tu página pública de reservas. Requiere tener la página activada en Configuración." },
        { name: "public_price_from", label: "Precio «desde» para la web", type: "number",
          help: "Lo que ve el cliente en la tarjeta cuando el precio real depende de modalidad o temporada. Vacío usa el precio base." },
      ]}
    />
  );
}
