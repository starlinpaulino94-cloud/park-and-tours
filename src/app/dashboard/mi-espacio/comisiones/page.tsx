"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/tf/page-header";
import { DataTable } from "@/components/tf/data-table";
import { KpiCard } from "@/components/tf/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pill } from "@/components/tf/status-badge";
import { formatMoney, formatDate } from "@/lib/format";
import { SinFicha } from "../_components/sin-ficha";

interface Comision {
  _id: string;
  amount?: number; base_amount?: number; percentage?: number; currency?: string;
  status?: string; service_date?: string | null; generated_at?: string | null;
  booking?: { booking_number?: string; product?: { name?: string } } | string | null;
}

/** Los estados que NO se cobran: se marcan, no se esconden ni se suman. */
const ANULADAS = new Set(["cancelled", "held", "disputed"]);
/** Lo ya cobrado. */
const PAGADAS = new Set(["paid"]);

const ESTADO: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  pending: { label: "Pendiente", tone: "warning" },
  approved: { label: "Aprobada", tone: "neutral" },
  settled: { label: "En liquidación", tone: "neutral" },
  paid: { label: "Pagada", tone: "success" },
  cancelled: { label: "Anulada", tone: "danger" },
  held: { label: "Retenida", tone: "danger" },
  disputed: { label: "En disputa", tone: "danger" },
};

/**
 * MIS COMISIONES.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TRES COSAS QUE LA PANTALLA INTERNA NO SEPARA, Y QUE SON LA DISCUSIÓN ENTERA
 *
 *  1. DEVENGADA, PENDIENTE Y PAGADA no son lo mismo. «Llevo 40 000» sin decir
 *     cuánto está cobrado no le sirve a nadie para saber qué va a ingresar.
 *  2. LA FECHA DEL SERVICIO no es la de la venta. El mercado liquida por el día
 *     del tour —una excursión vendida en marzo para agosto no se cobra en
 *     marzo— y esta pantalla corta por esa fecha, que es la que decide en qué
 *     liquidación entra cada línea.
 *  3. EL PORCENTAJE es el CONGELADO, el que se aplicó a esa venta. Enseñar el
 *     vigente en la ficha convertiría el documento en una cifra que cambia sola
 *     cuando alguien edita una regla.
 *
 * Y una comisión anulada se MARCA. Mostrada como pendiente genera más
 * reclamaciones de las que evita; escondida, el vendedor no entiende por qué
 * falta una venta que sabe que hizo.
 */
export default function MisComisionesPage() {
  const [sellerId, setSellerId] = useState<string | null | undefined>(undefined);
  const [filas, setFilas] = useState<Comision[]>([]);
  const [cargando, setCargando] = useState(true);
  const [periodo, setPeriodo] = useState("90");

  useEffect(() => {
    let vivo = true;
    (async () => {
      const yo = await api.get<{ user?: { sellerId?: string | null } }>("/api/me");
      if (!vivo) return;
      setSellerId(yo.ok ? yo.data?.user?.sellerId ?? null : null);
      if (!yo.data?.user?.sellerId) setCargando(false);
    })();
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (!sellerId) return;
    let vivo = true;
    setCargando(true);
    (async () => {
      const desde = new Date();
      desde.setDate(desde.getDate() - Number(periodo));
      const hasta = new Date();
      hasta.setDate(hasta.getDate() + 365);
      // Se corta por FECHA DE SERVICIO, no por la de venta. El filtro no lleva
      // vendedor: eso lo pone el servidor, y un filtro que decide qué ve cada
      // quien y viaja en la dirección se puede quitar.
      const qs = new URLSearchParams({
        limit: "200",
        dateField: "service_date",
        from: desde.toISOString().slice(0, 10),
        to: hasta.toISOString().slice(0, 10),
        sort: "-service_date",
      });
      const res = await api.get<Comision[]>(`/api/erp/commission?${qs}`);
      if (!vivo) return;
      if (res.ok) setFilas(res.data || []);
      setCargando(false);
    })();
    return () => { vivo = false; };
  }, [sellerId, periodo]);

  if (sellerId === undefined) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Mi espacio" title="Mis comisiones" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (!sellerId) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Mi espacio" title="Mis comisiones" />
        <SinFicha />
      </div>
    );
  }

  const moneda = filas[0]?.currency || "usd";
  let devengada = 0, pagada = 0, anulada = 0;
  for (const c of filas) {
    const importe = c.amount ?? 0;
    const estado = String(c.status ?? "");
    if (ANULADAS.has(estado)) anulada += importe;
    else if (PAGADAS.has(estado)) { pagada += importe; devengada += importe; }
    else devengada += importe;
  }
  const pendiente = devengada - pagada;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Mi espacio"
        title="Mis comisiones"
        description="Por fecha del servicio, que es la que decide en qué liquidación entra cada línea."
        actions={
          <Select value={periodo} onValueChange={setPeriodo}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="30">Últimos 30 días</SelectItem>
              <SelectItem value="90">Últimos 90 días</SelectItem>
              <SelectItem value="365">Último año</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard
          label="Devengada" icon="TrendingUp" tone="primary"
          value={formatMoney(devengada, moneda)}
          hint="Todo lo que has generado en el período"
          definition="No incluye lo anulado por cancelación o no-show."
        />
        <KpiCard
          label="Pendiente de cobro" icon="Clock" tone="amber"
          value={formatMoney(pendiente, moneda)}
          hint="Aprobado o en liquidación, todavía sin pagar"
        />
        <KpiCard
          label="Ya pagada" icon="BadgeCheck" tone="coral"
          value={formatMoney(pagada, moneda)}
          hint={anulada > 0 ? `Además, ${formatMoney(anulada, moneda)} anulado` : "Sin comisiones anuladas"}
        />
      </div>

      <DataTable
        rows={filas}
        loading={cargando}
        emptyIcon="BadgeDollarSign"
        emptyTitle="Todavía no hay comisiones tuyas en este período"
        emptyDescription="Se generan al confirmarse la venta y se liquidan por la fecha del servicio."
        columns={[
          {
            key: "venta", header: "Venta",
            render: (c: Comision) => {
              const b = typeof c.booking === "object" ? c.booking : null;
              return (
                <div>
                  <p className="font-semibold">{b?.booking_number || "—"}</p>
                  <p className="text-xs text-muted-foreground">{b?.product?.name || "Servicio"}</p>
                </div>
              );
            },
          },
          {
            // Las dos fechas, a propósito: son las que explican por qué una
            // venta de marzo se cobra en septiembre.
            key: "fechas", header: "Vendida / Servicio", hideOn: "md",
            render: (c: Comision) => (
              <div className="text-xs">
                <p>{c.generated_at ? formatDate(c.generated_at) : "—"}</p>
                <p className="font-semibold">{c.service_date ? formatDate(c.service_date) : "Sin fecha"}</p>
              </div>
            ),
          },
          {
            key: "base", header: "Base", align: "right", hideOn: "lg",
            render: (c: Comision) => (c.base_amount == null ? "—" : formatMoney(c.base_amount, c.currency || moneda)),
          },
          {
            // El congelado. Con `?? 0` un porcentaje ausente se leería como 0 %,
            // que es una afirmación sobre el trato y no una ausencia.
            key: "pct", header: "%", align: "right", hideOn: "sm",
            render: (c: Comision) => (c.percentage == null ? "—" : `${c.percentage} %`),
          },
          {
            key: "estado", header: "Estado",
            render: (c: Comision) => {
              const e = ESTADO[String(c.status ?? "")] ?? { label: c.status ?? "—", tone: "neutral" as const };
              return <Pill tone={e.tone}>{e.label}</Pill>;
            },
          },
          {
            key: "importe", header: "Comisión", align: "right",
            render: (c: Comision) => (
              <span className={ANULADAS.has(String(c.status ?? "")) ? "text-muted-foreground line-through" : "font-semibold"}>
                {formatMoney(c.amount ?? 0, c.currency || moneda)}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}
