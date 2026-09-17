"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { DataTable } from "@/components/tf/data-table";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { ResourcePage } from "@/components/tf/resource-page";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GENERIC_STATUS, LINK_CHANNEL } from "@/lib/labels";
import { formatNumber } from "@/lib/format";
import { optionsFrom } from "@/components/tf/options";
import { linkUrl, type FunnelStep, type SellerFunnelRow } from "@/lib/attribution";

/** La fila del cuadro, con el id que la tabla necesita para su clave. */
type Fila = SellerFunnelRow & { _id: string };

/**
 * QUIÉN TRAJO AL CLIENTE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ CONTESTA ESTA PANTALLA
 *
 * Dos preguntas que hasta ahora se contestaban de memoria:
 *
 *   «¿Cuántos clientes me trajo el QR del Bahía Príncipe este mes?»
 *   «Esta venta la cerró el mostrador, pero ¿de quién era el cliente?»
 *
 * La primera se responde con el embudo; la segunda ya no hace falta
 * preguntarla, porque la venta la resuelve sola con la política de la empresa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL EMBUDO CUENTA PERSONAS Y NO CLICS
 *
 * Un turista que recarga la página cinco veces no son cinco visitas. Contarlas
 * como cinco haría que el vendedor con el QR más incómodo —el que obliga a
 * reintentar— pareciera el mejor captador de la casa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA CONVERSIÓN VACÍA SE DICE, NO SE PINTA EN CERO
 *
 * Un vendedor sin visitas tiene la conversión en «—», no en «0 %». Cero por
 * ciento significa que vinieron y no compraron, que es un problema distinto y
 * se arregla de otra manera.
 */

interface Report {
  steps: FunnelStep[];
  leaderboard: SellerFunnelRow[];
  rows: number;
  truncated: boolean;
  days: number;
  policy: string;
  policyLabel: string;
  windowDays: number;
  baseUrl: string;
}

const RANGES = [
  { value: "7", label: "Últimos 7 días" },
  { value: "30", label: "Últimos 30 días" },
  { value: "90", label: "Últimos 90 días" },
  { value: "365", label: "Último año" },
];

const STEP_ICON: Record<string, string> = {
  visit: "Eye",
  signup: "UserPlus",
  booking: "CalendarCheck",
  purchase: "BadgeDollarSign",
};

const pct = (value: number | null) => (value === null ? "—" : `${value} %`);

function Funnel() {
  const [report, setReport] = useState<Report | null>(null);
  const [days, setDays] = useState("30");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.get(`/api/attribution?days=${days}`);
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo cargar el embudo");
      return;
    }
    setReport(res.data as Report);
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  if (loading && !report) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Cargando el embudo…</p>;
  }
  if (!report) return null;

  const nadie = report.rows === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          Esta empresa paga a{" "}
          <span className="font-semibold text-foreground">{report.policyLabel.toLowerCase()}</span>
          {report.windowDays > 0
            ? <> y la atribución caduca a los <span className="font-semibold text-foreground">{report.windowDays} días</span>.</>
            : <> y la atribución <span className="font-semibold text-foreground">no caduca</span>.</>}{" "}
          Se cambia en Configuración.
        </div>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            {RANGES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {report.truncated && (
        <div className="flex items-start gap-2 rounded-lg border border-amber/40 bg-amber/10 p-3 text-sm">
          <Icon name="TriangleAlert" className="mt-0.5 size-4 shrink-0 text-amber" />
          <span>
            El informe llegó al tope de {formatNumber(report.rows)} registros y está recortado.
            Acorta el rango para que las cifras sean del periodo completo.
          </span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {report.steps.map((step) => (
          <KpiCard
            key={step.stage}
            label={step.label}
            value={formatNumber(step.count)}
            icon={STEP_ICON[step.stage]}
            hint={step.conversionPct === null
              ? "Primer paso del embudo"
              : `${pct(step.conversionPct)} de la etapa anterior`}
            definition="Se cuentan personas, no visitas repetidas: el mismo navegador cargando cinco veces es una."
            tone={step.stage === "purchase" ? "primary" : "default"}
          />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quién trae y quién cierra</CardTitle>
          <CardDescription>
            Ordenado por compras y, a igualdad, por clientes captados: dos vendedores con una venta
            cada uno no son lo mismo si uno trajo veinte clientes y el otro dos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {nadie ? (
            <div className="py-10 text-center">
              <Icon name="QrCode" className="mx-auto size-8 text-muted-foreground" />
              <p className="mt-3 font-semibold">Todavía no ha entrado nadie por un enlace</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Crea un enlace en la pestaña «Enlaces y QR», imprime su código y pégalo donde esté
                el cliente. Lo que entre por ahí aparece aquí.
              </p>
            </div>
          ) : (
            <DataTable
              rows={report.leaderboard.map((row) => ({ ...row, _id: row.seller_id }))}
              columns={[
                { key: "seller", header: "Vendedor",
                  render: (r: Fila) => <span className="font-semibold">{r.seller_name}</span> },
                { key: "visits", header: "Visitas", align: "right",
                  render: (r: Fila) => formatNumber(r.visits) },
                { key: "signups", header: "Captados", align: "right",
                  render: (r: Fila) => formatNumber(r.signups) },
                { key: "bookings", header: "Reservas", align: "right", hideOn: "sm",
                  render: (r: Fila) => formatNumber(r.bookings) },
                { key: "purchases", header: "Compras", align: "right",
                  render: (r: Fila) => <span className="font-semibold">{formatNumber(r.purchases)}</span> },
                { key: "close", header: "Cierre", align: "right", hideOn: "md",
                  render: (r: Fila) => (
                    <Pill tone={r.closePct === null ? "neutral" : r.closePct >= 10 ? "success" : "warning"}>
                      {pct(r.closePct)}
                    </Pill>
                  ) },
              ]}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Links({ baseUrl }: { baseUrl: string }) {
  const copy = async (slug: string) => {
    try {
      await navigator.clipboard.writeText(linkUrl(baseUrl, slug));
      toast.success("Enlace copiado");
    } catch {
      // Sin portapapeles —contexto no seguro, permiso denegado— se enseña el
      // enlace para copiarlo a mano en vez de fallar en silencio.
      toast.info(linkUrl(baseUrl, slug));
    }
  };

  return (
    <ResourcePage
      embedded
      resource="seller_link"
      title="Enlaces y QR"
      description="Cada enlace es de un vendedor. Lo que entre por él queda anotado a su nombre, aunque la venta la cierre otra persona días después."
      createLabel="Nuevo enlace"
      searchPlaceholder="Buscar por código, nombre o campaña…"
      emptyIcon="QrCode"
      emptyTitle="Todavía no hay enlaces"
      emptyDescription="Un conserje o un taxista no necesita cuenta en el sistema: necesita un QR."
      columns={[
        {
          key: "slug", header: "Enlace",
          render: (l: any) => (
            <div>
              <p className="font-mono font-semibold">{l.slug}</p>
              <p className="text-xs text-muted-foreground">{l.name || "Sin nombre"}</p>
            </div>
          ),
        },
        { key: "seller", header: "Vendedor",
          render: (l: any) => (typeof l.seller === "object" && l.seller
            ? [l.seller.first_name, l.seller.last_name].filter(Boolean).join(" ") : "—") },
        { key: "channel", header: "Canal", hideOn: "sm",
          render: (l: any) => <StatusBadge value={l.channel} dict={LINK_CHANNEL} dot={false} /> },
        { key: "product", header: "Abre", hideOn: "lg",
          render: (l: any) => (typeof l.product === "object" && l.product ? l.product.name : "El catálogo") },
        { key: "campaign", header: "Campaña", hideOn: "lg",
          render: (l: any) => l.campaign || "—" },
        { key: "status", header: "Estado",
          render: (l: any) => <StatusBadge value={l.status} dict={GENERIC_STATUS} /> },
        {
          key: "actions", header: "", align: "right",
          render: (l: any) => (
            <div className="flex justify-end gap-1">
              <Button size="sm" variant="ghost" onClick={() => copy(l.slug)} title="Copiar el enlace">
                <Icon name="Copy" className="size-4" />
              </Button>
              <Button size="sm" variant="ghost" asChild title="Descargar el QR para imprimir">
                <a href={`/api/attribution/links/${l._id}/qr`} download>
                  <Icon name="QrCode" className="size-4" />
                </a>
              </Button>
            </div>
          ),
        },
      ]}
      fields={[
        { name: "seller", label: "Vendedor", type: "reference", resource: "seller", required: true,
          optionLabel: (s: any) => [s.first_name, s.last_name].filter(Boolean).join(" "),
          help: "Lo que entre por este enlace se le anota a esta persona." },
        { name: "slug", label: "Código del enlace", required: true,
          help: "Va impreso bajo el QR y se teclea a mano cuando la cámara falla: corto, en mayúsculas y sin las letras que se confunden (O, I, L, S, B)." },
        { name: "name", label: "Para qué es", help: "«QR mostrador Bahía Príncipe». Es para ti, no lo ve el cliente." },
        { name: "channel", label: "Canal", type: "select", defaultValue: "qr", options: optionsFrom(LINK_CHANNEL) },
        { name: "product", label: "Abrir directamente", type: "reference", resource: "product",
          help: "Déjalo vacío para que abra el catálogo. Un QR que dice «Saona» debería abrir Saona." },
        { name: "campaign", label: "Campaña", help: "Para separar «Macao agosto» de «Macao septiembre»." },
        { name: "status", label: "Estado", type: "select", defaultValue: "active",
          options: optionsFrom(GENERIC_STATUS, ["active", "inactive"]) },
      ]}
    />
  );
}

export default function AttributionPage() {
  const [baseUrl, setBaseUrl] = useState("");
  useEffect(() => { setBaseUrl(window.location.origin); }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Red de ventas"
        title="Quién trajo al cliente"
        description="El conserje, el taxista y el promotor de playa no tienen cuenta en el sistema — tienen un QR. Lo que entre por él queda anotado a su nombre."
      />
      <Tabs defaultValue="embudo">
        <TabsList>
          <TabsTrigger value="embudo">Embudo</TabsTrigger>
          <TabsTrigger value="enlaces">Enlaces y QR</TabsTrigger>
        </TabsList>
        <TabsContent value="embudo" className="mt-5"><Funnel /></TabsContent>
        <TabsContent value="enlaces" className="mt-5"><Links baseUrl={baseUrl} /></TabsContent>
      </Tabs>
    </div>
  );
}
