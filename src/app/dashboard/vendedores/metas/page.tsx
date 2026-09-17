"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/tf/page-header";
import { DataTable } from "@/components/tf/data-table";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { ResourcePage } from "@/components/tf/resource-page";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GENERIC_STATUS } from "@/lib/labels";
import { formatMoney, formatNumber, formatDate } from "@/lib/format";
import { CURRENCY_OPTIONS, optionsFrom } from "@/components/tf/options";
import {
  GOAL_PERIODS, PERIOD_LABEL, PAYOUT_KINDS, PAYOUT_KIND_LABEL,
  type ProgressLine,
} from "@/lib/seller-goals";

/**
 * METAS COMERCIALES.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA META QUE HABÍA ERA UN NÚMERO
 *
 * `monthly_goal`: un número suelto, sin unidad declarada y sin más periodo que
 * «el mes». Lo que una operadora pone de verdad en una reunión de lunes es
 * otra cosa:
 *
 *   «Este mes, el equipo de playa: 40 ventas y 150 pasajeros.»
 *   «Los hoteles: 30 clientes nuevos captados, el resto me da igual.»
 *   «Rafael, en la excursión a Saona, 20 reservas de aquí al 15.»
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SOLO SE PINTA LO QUE LA META PIDE
 *
 * Una meta de pasajeros no enseña una barra de ingresos en cero. Esa barra no
 * significa nada y hace que el vendedor lea que va fatal en algo que nadie le
 * pidió.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL PREMIO LO DA UNA PERSONA
 *
 * Nada se otorga solo. Un bono automático sobre una meta que alguien bajó el
 * día 30 se pagaría sin que nadie lo mirara, y esa es la clase de premio que
 * acaba en una discusión.
 */

interface GoalProgress {
  goal: {
    _id: string;
    name?: string | null;
    period?: string | null;
    reward?: string | null;
    currency?: string | null;
    seller?: any;
    seller_type?: any;
    product?: any;
  };
  range: { from: string; to: string };
  lines: ProgressLine[];
  achieved: boolean;
  overall: number | null;
}

function scopeOf(g: GoalProgress["goal"]): string {
  const parts = [
    typeof g.seller === "object" && g.seller
      ? [g.seller.first_name, g.seller.last_name].filter(Boolean).join(" ")
      : null,
    typeof g.seller_type === "object" && g.seller_type ? g.seller_type.name : null,
    typeof g.product === "object" && g.product ? g.product.name : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Toda la red comercial";
}

function Board() {
  const [rows, setRows] = useState<GoalProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [awarding, setAwarding] = useState<GoalProgress | null>(null);
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState("cash");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.get<{ goals: GoalProgress[] }>("/api/seller-goals");
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudieron cargar las metas");
      return;
    }
    setRows(res.data?.goals || []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const award = async () => {
    if (!awarding) return;
    const sellerId = typeof awarding.goal.seller === "object" ? awarding.goal.seller?._id : awarding.goal.seller;
    if (!sellerId) {
      // Una meta de grupo no tiene a quién pagarle: hay que dar el bono a mano,
      // persona por persona, desde la pestaña de bonos.
      toast.error("Esta meta es de un grupo. Da el bono a cada persona desde «Bonos».");
      return;
    }
    setBusy(true);
    const res = await api.post("/api/seller-goals", {
      goal_id: awarding.goal._id,
      seller_id: sellerId,
      amount: Number(amount || 0),
      payout_kind: kind,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo otorgar el bono");
      return;
    }
    toast.success("Bono otorgado. Queda pendiente de aprobar en «Bonos».");
    setAwarding(null);
    setAmount("");
    load();
  };

  if (loading) return <p className="py-10 text-center text-sm text-muted-foreground">Midiendo el progreso…</p>;

  if (rows.length === 0) {
    return (
      <div className="py-12 text-center">
        <Icon name="Target" className="mx-auto size-8 text-muted-foreground" />
        <p className="mt-3 font-semibold">Todavía no hay metas activas</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Créalas en la pestaña «Metas». Una meta puede pedir varias cosas a la vez —«40 ventas y
          150 pasajeros»— y solo se da por cumplida cuando se cumplen todas.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map((row) => (
          <Card key={row.goal._id} className={row.achieved ? "border-primary/50" : undefined}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="text-base">{row.goal.name || "Meta sin nombre"}</CardTitle>
                  <CardDescription>
                    {scopeOf(row.goal)} · {PERIOD_LABEL[(row.goal.period || "monthly") as keyof typeof PERIOD_LABEL]}
                    {" · "}{formatDate(row.range.from)} → {formatDate(row.range.to)}
                  </CardDescription>
                </div>
                {row.achieved
                  ? <Pill tone="success">Cumplida</Pill>
                  : <Pill tone="neutral">{row.overall ?? 0} %</Pill>}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {row.lines.map((line) => (
                <div key={line.metric}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span>{line.label}</span>
                    <span className={line.met ? "font-semibold text-primary" : "text-muted-foreground"}>
                      {line.isMoney
                        ? `${formatMoney(line.actual, row.goal.currency || "usd")} / ${formatMoney(line.target, row.goal.currency || "usd")}`
                        : `${formatNumber(line.actual)} / ${formatNumber(line.target)}`}
                    </span>
                  </div>
                  <Progress value={line.pct} className="mt-1.5 h-2" />
                  {!line.met && (
                    // Lo que falta, en la unidad de la línea: es el número que
                    // el vendedor puede convertir en una llamada esta tarde.
                    <p className="mt-1 text-xs text-muted-foreground">
                      Faltan {line.isMoney
                        ? formatMoney(line.remaining, row.goal.currency || "usd")
                        : formatNumber(line.remaining)}
                    </p>
                  )}
                </div>
              ))}

              {row.goal.reward && (
                <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs">
                  <strong>Premio:</strong> {row.goal.reward}
                </p>
              )}

              {row.achieved && (
                <Button size="sm" className="w-full gap-1.5" onClick={() => setAwarding(row)}>
                  <Icon name="Gift" className="size-4" /> Otorgar el bono
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!awarding} onOpenChange={(v) => !v && setAwarding(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Otorgar el bono de «{awarding?.goal.name || "esta meta"}»</DialogTitle>
            <DialogDescription>
              Se guarda congelado lo que la meta pedía y lo que se alcanzó. Dentro de seis meses la
              meta puede estar editada o borrada; esto no.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="bonus-amount">Importe</Label>
              <Input id="bonus-amount" type="number" step="0.01" value={amount}
                onChange={(e) => setAmount(e.target.value)} placeholder="100.00" />
            </div>
            <div className="space-y-1.5">
              <Label>Cómo se paga</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYOUT_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>{PAYOUT_KIND_LABEL[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Un premio en especie —dos pases, una noche de hotel— tiene su valor en el expediente
                pero <strong>no se transfiere</strong>: sumarlo haría pagar dinero por algo ya entregado.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAwarding(null)}>Cancelar</Button>
            <Button onClick={award} disabled={busy}>{busy ? "Otorgando…" : "Otorgar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Goals() {
  return (
    <ResourcePage
      embedded
      resource="seller_goal"
      title="Metas"
      description="Una meta puede pedir varias cosas a la vez, y solo se da por cumplida cuando se cumplen todas. Lo que dejes vacío no se mide ni se pinta."
      createLabel="Nueva meta"
      searchPlaceholder="Buscar meta…"
      emptyIcon="Target"
      emptyTitle="Todavía no hay metas"
      columns={[
        { key: "name", header: "Meta",
          render: (g: any) => (
            <div>
              <p className="font-semibold">{g.name || "Sin nombre"}</p>
              <p className="text-xs text-muted-foreground">{scopeOf(g)}</p>
            </div>
          ) },
        { key: "period", header: "Periodo", hideOn: "sm",
          render: (g: any) => PERIOD_LABEL[(g.period || "monthly") as keyof typeof PERIOD_LABEL] },
        { key: "targets", header: "Pide", hideOn: "md",
          render: (g: any) => {
            const partes = [
              g.target_signups ? `${g.target_signups} captados` : null,
              g.target_bookings ? `${g.target_bookings} reservas` : null,
              g.target_sales ? `${g.target_sales} ventas` : null,
              g.target_pax ? `${g.target_pax} pax` : null,
              g.target_revenue ? formatMoney(g.target_revenue, g.currency || "usd") : null,
            ].filter(Boolean);
            return <span className="text-xs">{partes.join(" · ") || "—"}</span>;
          } },
        { key: "reward", header: "Premio", hideOn: "lg", render: (g: any) => g.reward || "—" },
        { key: "status", header: "Estado", render: (g: any) => <StatusBadge value={g.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "name", label: "Nombre de la meta", required: true,
          help: "Como se dice en la reunión: «Playa · septiembre»." },
        { name: "seller", label: "A un vendedor", type: "reference", resource: "seller",
          optionLabel: (s: any) => [s.first_name, s.last_name].filter(Boolean).join(" "),
          help: "Déjalo vacío para que sea de un grupo o de toda la red." },
        { name: "seller_type", label: "A un tipo de vendedor", type: "reference", resource: "seller_type" },
        { name: "branch", label: "A una sucursal", type: "reference", resource: "branch" },
        { name: "product", label: "Sobre un producto", type: "reference", resource: "product",
          help: "Para empujar una salida concreta que no se llena." },
        { name: "category", label: "Sobre una categoría", type: "reference", resource: "product_category" },
        { name: "period", label: "Periodo", type: "select", defaultValue: "monthly",
          options: GOAL_PERIODS.map((p) => ({ value: p, label: PERIOD_LABEL[p] })) },
        { name: "period_from", label: "Desde", type: "date", help: "Solo si el periodo es «entre dos fechas»." },
        { name: "period_to", label: "Hasta", type: "date" },
        { name: "target_signups", label: "Clientes captados", type: "number" },
        { name: "target_bookings", label: "Reservas", type: "number" },
        { name: "target_sales", label: "Ventas cerradas", type: "number" },
        { name: "target_pax", label: "Pasajeros", type: "number" },
        { name: "target_revenue", label: "Ingresos", type: "number" },
        { name: "currency", label: "Moneda", type: "select", options: CURRENCY_OPTIONS },
        { name: "reward", label: "Qué se lleva si llega", type: "textarea",
          help: "«Un fin de semana en Samaná» no es un número, y por eso es texto." },
        { name: "status", label: "Estado", type: "select", defaultValue: "active",
          options: optionsFrom(GENERIC_STATUS, ["active", "inactive"]) },
      ]}
    />
  );
}

export default function GoalsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Red de ventas"
        title="Metas y premios"
        description="Lo que se pide, lo que se lleva y cuánto falta. El progreso se mide de las reservas y del embudo, no de un contador que alguien tenga que mantener."
      />
      <Tabs defaultValue="tablero">
        <TabsList>
          <TabsTrigger value="tablero">Cómo van</TabsTrigger>
          <TabsTrigger value="metas">Metas</TabsTrigger>
        </TabsList>
        <TabsContent value="tablero" className="mt-5"><Board /></TabsContent>
        <TabsContent value="metas" className="mt-5"><Goals /></TabsContent>
      </Tabs>
    </div>
  );
}
