"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/tf/icon";
import { StatusBadge } from "@/components/tf/status-badge";
import { ORDER_STATUS } from "@/lib/labels";
import { formatMoney, formatNumber, formatDate } from "@/lib/format";
import { SinFicha } from "./_components/sin-ficha";

interface Me { user?: { sellerId?: string | null; name?: string } }
interface Panel {
  currency: string;
  period: { label: string };
  kpis: Record<string, number | null>;
}
interface Ficha { _id: string; monthly_goal?: number | null; commission_pct?: number | null; currency?: string | null }
interface Venta {
  _id: string; order_number?: string; total?: number; balance?: number; currency?: string;
  status?: string; order_date?: string; customer?: { first_name?: string; last_name?: string } | string;
}

/**
 * MI ESPACIO — lo que el vendedor viene a mirar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO VALÍA EL PANEL DE SIEMPRE
 *
 * `/dashboard` ya acotaba sus cifras al vendedor, pero lo enseñaba dentro del
 * panel de la empresa: entre ocupación de salidas, canales y alertas de caja.
 * Quien vende a comisión abre el sistema para responder tres preguntas —cuánto
 * llevo, cuánto voy a cobrar y cuánto me falta para la meta— y tenía que
 * encontrarlas entre lo que no es suyo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DE DÓNDE SALEN LOS DATOS, Y POR QUÉ DE AHÍ
 *
 * De `/api/dashboard`, que YA fuerza el ámbito al vendedor del contexto en el
 * servidor. Montar una ruta nueva habría significado un segundo sitio donde
 * equivocarse sobre qué es «lo suyo», y los dos acabarían discrepando.
 *
 * La meta sale de su propia ficha (`/api/erp/seller/:id`), que el recorte de
 * columnas exceptúa para uno mismo: nadie tiene que pedir permiso para ver su
 * propia comisión.
 */
export default function MiEspacioPage() {
  const [sellerId, setSellerId] = useState<string | null | undefined>(undefined);
  const [nombre, setNombre] = useState("");
  const [panel, setPanel] = useState<Panel | null>(null);
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const yo = await api.get<Me>("/api/me");
      if (!vivo) return;
      const id = yo.ok ? yo.data?.user?.sellerId ?? null : null;
      setNombre(yo.data?.user?.name || "");
      setSellerId(id);
      if (!id) { setCargando(false); return; }

      const [p, f, v] = await Promise.all([
        api.get<Panel>("/api/dashboard?period=month"),
        api.get<Ficha>(`/api/erp/seller/${id}`),
        api.get<Venta[]>("/api/orders?limit=8"),
      ]);
      if (!vivo) return;
      if (p.ok) setPanel(p.data ?? null);
      if (f.ok) setFicha(f.data ?? null);
      if (v.ok) setVentas(v.data || []);
      setCargando(false);
    })();
    return () => { vivo = false; };
  }, []);

  if (sellerId === undefined || (cargando && sellerId)) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Mi espacio" title="Tus ventas del mes" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!sellerId) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Mi espacio" title="Tus ventas del mes" />
        <SinFicha />
      </div>
    );
  }

  const moneda = panel?.currency || ficha?.currency || "usd";
  const vendido = panel?.kpis?.net_sales ?? null;
  const meta = ficha?.monthly_goal ?? null;
  // «Sin meta» y «meta de cero» no son lo mismo: con `?? 0` el progreso salía
  // del 100 % para quien no tiene meta puesta.
  const progreso = meta && meta > 0 && vendido != null ? Math.min((vendido / meta) * 100, 999) : null;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Mi espacio"
        title={nombre ? `Hola, ${nombre.split(" ")[0]}` : "Tus ventas del mes"}
        description={panel?.period?.label ? `Cifras de ${panel.period.label.toLowerCase()}, solo tuyas.` : undefined}
        actions={
          <Button asChild variant="outline" className="gap-1.5">
            <Link href="/dashboard/mi-espacio/ventas"><Icon name="Receipt" className="size-4" /> Ver todas mis ventas</Link>
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Vendido este mes" icon="TrendingUp" tone="primary"
          value={vendido == null ? "—" : formatMoney(vendido, moneda)}
          hint={`${formatNumber(panel?.kpis?.bookings ?? 0)} reserva(s) · ${formatNumber(panel?.kpis?.pax ?? 0)} pax`}
        />
        <KpiCard
          label="Comisión del período" icon="BadgeDollarSign" tone="coral"
          value={panel?.kpis?.commissions_pending == null ? "—" : formatMoney(panel.kpis.commissions_pending, moneda)}
          hint={
            panel?.kpis?.commissions_count == null
              ? "Aún no hay comisiones calculadas"
              : `${formatNumber(panel.kpis.commissions_count)} comisión(es) en el período`
          }
          definition="Lo devengado en este período. El detalle por reserva y el estado de pago llegan en la siguiente entrega."
        />
        <KpiCard
          label="Meta del mes" icon="Target" tone="amber"
          value={meta == null ? "Sin meta" : formatMoney(meta, moneda)}
          hint={progreso == null ? "Pídele a tu supervisor que te ponga una" : `Llevas el ${progreso.toFixed(0)} %`}
        />
        <KpiCard
          label="Tu comisión estándar" icon="Percent"
          value={ficha?.commission_pct == null ? "—" : `${ficha.commission_pct} %`}
          hint="La que se aplica cuando no hay una regla específica"
        />
      </div>

      <section className="rounded-xl border border-border/70 bg-card">
        <header className="flex items-center justify-between border-b border-border/70 px-4 py-3">
          <h2 className="font-display text-sm font-semibold">Tus últimas ventas</h2>
          <Link href="/dashboard/mi-espacio/ventas" className="text-xs font-semibold text-primary hover:underline">
            Ver todas
          </Link>
        </header>
        {ventas.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Todavía no hay ventas a tu nombre en el sistema.
          </p>
        ) : (
          <ul className="divide-y divide-border/70">
            {ventas.map((o) => {
              const cliente = typeof o.customer === "object" && o.customer
                ? [o.customer.first_name, o.customer.last_name].filter(Boolean).join(" ")
                : "";
              return (
                <li key={o._id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{o.order_number || "Venta"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {cliente || "Cliente directo"}{o.order_date ? ` · ${formatDate(o.order_date)}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <StatusBadge value={o.status} dict={ORDER_STATUS} />
                    <span className="tabular-nums text-sm font-semibold">
                      {formatMoney(o.total ?? 0, o.currency || moneda)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
