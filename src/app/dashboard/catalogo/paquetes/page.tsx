"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/tf/page-header";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { ResourcePage } from "@/components/tf/resource-page";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GENERIC_STATUS } from "@/lib/labels";
import { formatDate, formatNumber } from "@/lib/format";
import { optionsFrom } from "@/components/tf/options";
import { hhmm, type Block, type Conflict } from "@/lib/bundles";

/**
 * PAQUETES: VENDER VARIAS ACTIVIDADES COMO UNA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE NO SE PODÍA HACER
 *
 * «Saona + Buggy + Hoyo Azul, tres días, 180 dólares» es el producto que más
 * margen deja y el que una operadora pone en la portada. Hasta aquí se vendía
 * tecleando tres reservas sueltas y cobrando a mano un precio que no es la
 * suma: el descuento del paquete vivía en la cabeza de quien vendió.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTA PANTALLA SIRVE PARA UNA COSA
 *
 * Comprobar que el paquete se puede OPERAR antes de ponerlo a la venta. Se
 * elige un día y un grupo, y se ve el itinerario que le tocaría a ese cliente:
 * qué salida de cada actividad, a qué hora, y si choca con la siguiente.
 *
 * Un paquete que se vende sin haber hecho esta comprobación se descubre roto el
 * día de la salida, con el cliente en el lobby.
 */

interface Plan {
  ok: boolean;
  bundleName: string;
  bufferMin: number;
  blocks: Block[];
  conflicts: Conflict[];
  unresolved: { itemId: string; productName: string; reason: string }[];
  alternatives: Block[][];
  truncated: boolean;
  days: { day: string; blocks: Block[] }[];
  span: number;
  seatsLeft: number | null;
  travelAt: string | null;
  blocker: string | null;
}

const today = () => new Date().toISOString().slice(0, 10);

function Simulator() {
  const [bundles, setBundles] = useState<{ _id: string; name?: string }[]>([]);
  const [bundleId, setBundleId] = useState("");
  const [startDay, setStartDay] = useState(today);
  const [pax, setPax] = useState("2");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await api.get<{ _id: string; name?: string }[]>("/api/erp/product?filter.is_bundle=true&limit=100");
      if (res.ok) setBundles(res.data || []);
    })();
  }, []);

  const run = useCallback(async () => {
    if (!bundleId) return;
    setBusy(true);
    const query = new URLSearchParams({
      bundle: bundleId, day: startDay, pax: String(Number(pax || 1)),
    });
    const res = await api.get<Plan>(`/api/bundles?${query}`);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo armar el itinerario");
      setPlan(null);
      return;
    }
    setPlan(res.data as Plan);
  }, [bundleId, startDay, pax]);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">¿Se puede operar este paquete?</CardTitle>
          <CardDescription>
            Elige un día y un grupo. Se buscan las salidas reales de cada actividad, con las plazas
            que quedan de verdad, y se comprueba que el itinerario cabe con el margen del paquete.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Paquete</Label>
              <Select value={bundleId} onValueChange={setBundleId}>
                <SelectTrigger><SelectValue placeholder="Elige un paquete…" /></SelectTrigger>
                <SelectContent>
                  {bundles.map((b) => <SelectItem key={b._id} value={b._id}>{b.name || "Sin nombre"}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="start-day">Empieza el</Label>
              <Input id="start-day" type="date" value={startDay} onChange={(e) => setStartDay(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pax">Personas</Label>
              <Input id="pax" type="number" min="1" value={pax} onChange={(e) => setPax(e.target.value)} />
            </div>
          </div>
          <Button className="mt-4 gap-1.5" onClick={run} disabled={!bundleId || busy}>
            <Icon name="Route" className="size-4" /> {busy ? "Armando…" : "Armar el itinerario"}
          </Button>
        </CardContent>
      </Card>

      {bundles.length === 0 && (
        <div className="py-8 text-center">
          <Icon name="Package" className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 font-semibold">Todavía no hay ningún paquete</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Crea un producto y márcalo como paquete en la pestaña «Componentes», después elige de
            qué actividades se compone.
          </p>
        </div>
      )}

      {plan && (
        <div className="space-y-4">
          {plan.blocker ? (
            <div className="flex items-start gap-2 rounded-lg border border-coral/40 bg-coral/10 p-3 text-sm">
              <Icon name="CircleAlert" className="mt-0.5 size-4 shrink-0 text-coral" />
              <div>
                <p className="font-semibold">Este paquete no se puede vender ese día</p>
                {/* El motivo, no un «no se puede»: decir que no sin enseñar qué
                    choca no le deja a nadie arreglarlo. */}
                <p className="mt-1">{plan.blocker}</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
              <Icon name="CircleCheck" className="size-4 text-primary" />
              <span className="font-semibold">El itinerario cabe.</span>
              <span>{plan.span} {plan.span === 1 ? "día" : "días"}</span>
              <span>·</span>
              <span>
                {plan.seatsLeft === null
                  ? "Sin aforo declarado en ninguna actividad"
                  : `Hasta ${formatNumber(plan.seatsLeft)} personas (la actividad más ajustada)`}
              </span>
            </div>
          )}

          {plan.unresolved.length > 0 && (
            <div className="space-y-1 rounded-lg border border-amber/40 bg-amber/10 p-3 text-sm">
              {plan.unresolved.map((u) => (
                <p key={u.itemId}>{u.reason}</p>
              ))}
            </div>
          )}

          {plan.days.map((day) => (
            <Card key={day.day}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{formatDate(day.day)}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {day.blocks.map((b) => (
                  <div key={b.departureId} className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2">
                    <Pill tone="neutral">{hhmm(b.start)} – {hhmm(b.end)}</Pill>
                    <span className="font-medium">{b.productName}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {b.seatsLeft === null ? "Sin aforo declarado" : `${formatNumber(b.seatsLeft)} plazas libres`}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}

          {plan.conflicts.length > 0 && (
            <div className="space-y-1 rounded-lg border border-coral/40 bg-coral/10 p-3 text-sm">
              {plan.conflicts.map((c, i) => <p key={i}>{c.message}</p>)}
            </div>
          )}

          {plan.alternatives.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Hay {plan.alternatives.length} {plan.alternatives.length === 1 ? "combinación" : "combinaciones"} más
              que también encajan. Se eligió la que deja menos tiempo de espera entre actividades.
              {plan.truncated && " No se miraron todas: el paquete tiene demasiadas salidas posibles."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Components() {
  return (
    <ResourcePage
      embedded
      resource="product_bundle_item"
      title="Componentes"
      description="De qué se compone cada paquete. El día 0 es el primero del paquete; el día 1, el siguiente. Marca el producto padre como «paquete» en su ficha."
      createLabel="Añadir actividad a un paquete"
      searchPlaceholder="Buscar…"
      emptyIcon="Package"
      emptyTitle="Todavía no hay paquetes armados"
      emptyDescription="Un paquete no puede contener otro paquete: la base lo impide, porque un paquete de paquetes multiplica el itinerario por combinaciones que nadie puede revisar antes de cobrar."
      columns={[
        { key: "bundle", header: "Paquete",
          render: (i: any) => <span className="font-semibold">{typeof i.bundle === "object" && i.bundle ? i.bundle.name : "—"}</span> },
        { key: "product", header: "Actividad",
          render: (i: any) => (typeof i.product === "object" && i.product ? i.product.name : "—") },
        { key: "day", header: "Día", align: "center",
          render: (i: any) => <Pill tone="neutral">Día {(i.day_offset ?? 0) + 1}</Pill> },
        { key: "time", header: "Hora fija", hideOn: "sm",
          render: (i: any) => i.fixed_time || <span className="text-xs text-muted-foreground">La que encaje</span> },
        { key: "flags", header: "", hideOn: "lg",
          render: (i: any) => (
            <div className="flex gap-1">
              {i.allow_overlap && <Pill tone="info">Puede solaparse</Pill>}
              {i.is_optional && <Pill tone="neutral">Opcional</Pill>}
            </div>
          ) },
      ]}
      fields={[
        { name: "bundle", label: "Paquete", type: "reference", resource: "product", required: true,
          help: "El producto que hace de paquete. Márcalo antes como «paquete» en su ficha." },
        { name: "product", label: "Actividad que incluye", type: "reference", resource: "product", required: true },
        { name: "modality", label: "Modalidad", type: "reference", resource: "product_modality" },
        { name: "day_offset", label: "Día del paquete", type: "number", defaultValue: 0,
          help: "0 = el primer día. 1 = el siguiente. Es lo que hace posible un combo de tres días." },
        { name: "sort_order", label: "Orden dentro del día", type: "number", defaultValue: 0 },
        { name: "fixed_time", label: "Hora fija", placeholder: "09:00",
          help: "Solo si esta actividad únicamente sale a esa hora dentro del paquete. Vacío = se elige la salida que encaje." },
        { name: "allow_overlap", label: "Puede solaparse", type: "select", defaultValue: "no",
          options: [{ value: "no", label: "No" }, { value: "yes", label: "Sí" }],
          help: "Un pase de día a un parque no compite con una excursión de dos horas dentro de ese mismo parque." },
        { name: "is_optional", label: "Es opcional", type: "select", defaultValue: "no",
          options: [{ value: "no", label: "No" }, { value: "yes", label: "Sí" }],
          help: "Si no hay salida para una opcional, el paquete se vende igual y se dice que se quedó fuera." },
      ]}
    />
  );
}

export default function BundlesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Catálogo"
        title="Paquetes"
        description="Varias actividades vendidas como una. Cada una conserva su salida, su cupo y su check-in: el autobús del jueves sabe que lleva a esa gente."
      />
      <Tabs defaultValue="simulador">
        <TabsList>
          <TabsTrigger value="simulador">Probar un paquete</TabsTrigger>
          <TabsTrigger value="componentes">Componentes</TabsTrigger>
        </TabsList>
        <TabsContent value="simulador" className="mt-5"><Simulator /></TabsContent>
        <TabsContent value="componentes" className="mt-5"><Components /></TabsContent>
      </Tabs>
    </div>
  );
}
