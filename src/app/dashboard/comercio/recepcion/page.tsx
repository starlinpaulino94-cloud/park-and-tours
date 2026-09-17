"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { DataTable } from "@/components/tf/data-table";
import { StatusBadge } from "@/components/tf/status-badge";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PO_STATUS } from "@/lib/labels-modules";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import type { LineState } from "@/lib/purchasing";

/**
 * RECIBIR MERCANCÍA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS AGUJEROS QUE SE TAPAN AQUÍ
 *
 *  1. **No había forma de ponerle líneas a una orden de compra.** La tabla
 *     `purchase_order_line` existe desde 0013 y ninguna pantalla la escribía:
 *     una orden solo tenía cabecera y totales tecleados a mano, así que no
 *     había *qué* recibir. Una orden sin líneas no es una orden, es una nota.
 *
 *  2. **Recibir no movía stock.** Se marcaba la orden como recibida y después
 *     alguien metía un ajuste de inventario a ojo. Lo comprado y lo que hay en
 *     el estante nacían separados.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE SE PUEDE TECLEAR Y LO QUE NO
 *
 * Se teclea lo pedido —qué artículo, cuántos, a cuánto— y lo que llega en cada
 * camión. NO se teclea lo recibido: eso lo escribe la recepción, que mueve el
 * stock en el mismo acto.
 */

interface Order {
  _id: string; code?: string; status?: string; currency?: string;
  ordered_at?: string; expected_at?: string; total?: number;
  supplier?: { name?: string } | string; warehouse?: { _id?: string; name?: string } | string;
}

interface OrderState {
  status?: string; code?: string; currency?: string;
  warehouse?: { _id?: string; name?: string } | string;
  supplier?: { name?: string } | string;
  receiptCount?: number;
  lines: LineState[];
  pending: { lines: number; units: number; value: number };
}

const nameOf = (v: unknown) => (typeof v === "object" && v ? (v as { name?: string }).name || "—" : "—");

export default function RecepcionPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [current, setCurrent] = useState<Order | null>(null);
  const [state, setState] = useState<OrderState | null>(null);
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [costes, setCostes] = useState<Record<string, string>>({});
  const [permitirExceso, setPermitirExceso] = useState(false);

  const [nuevaLinea, setNuevaLinea] = useState(false);
  const [articulos, setArticulos] = useState<{ _id: string; name?: string }[]>([]);
  const [linea, setLinea] = useState({ description: "", inventory_item: "", quantity: "", unit_cost: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.get<Order[]>(
      "/api/erp/purchase_order?limit=100&filter.status.in=approved,sent,partially_received"
    );
    setLoading(false);
    if (res.ok === false) {
      console.error("[recepcion] error cargando órdenes:", res.error);
      toast.error(res.error?.message || "No se pudieron cargar las órdenes");
      setOrders([]);
      return;
    }
    setOrders(res.data || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!nuevaLinea) return;
    api.get<{ _id: string; name?: string }[]>("/api/erp/inventory_item?limit=300").then((r) => {
      if (r.ok === false) {
        console.error("[recepcion] error cargando artículos:", r.error);
        return;
      }
      setArticulos(r.data || []);
    });
  }, [nuevaLinea]);

  const abrir = async (order: Order) => {
    setCurrent(order);
    setCantidades({});
    setCostes({});
    setPermitirExceso(false);
    const res = await api.get<OrderState>(`/api/purchase-orders/${order._id}/receive`);
    if (res.ok === false) {
      console.error("[recepcion] error cargando el estado:", res.error);
      toast.error(res.error?.message || "No se pudo abrir la orden");
      setState(null);
      return;
    }
    setState(res.data ?? null);
  };

  /** Rellena cada línea con lo que falta: lo normal es que llegue todo. */
  const recibirTodo = () => {
    if (!state) return;
    const next: Record<string, string> = {};
    for (const l of state.lines) if (l.pending > 0) next[l.lineId] = String(l.pending);
    setCantidades(next);
  };

  const agregarLinea = async () => {
    if (!current) return;
    const cantidad = Number(linea.quantity);
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      toast.error("La cantidad tiene que ser mayor que cero.");
      return;
    }
    setBusy(true);
    const res = await api.post("/api/erp/purchase_order_line", {
      purchase_order: current._id,
      description: linea.description || null,
      inventory_item: linea.inventory_item || null,
      quantity: cantidad,
      unit_cost: Number(linea.unit_cost) || 0,
      line_total: cantidad * (Number(linea.unit_cost) || 0),
    });
    setBusy(false);
    if (res.ok === false) {
      toast.error(res.error?.message || "No se pudo añadir la línea");
      return;
    }
    setNuevaLinea(false);
    setLinea({ description: "", inventory_item: "", quantity: "", unit_cost: "" });
    await abrir(current);
  };

  const recibir = async () => {
    if (!current || !state) return;
    const lines = Object.entries(cantidades)
      .map(([lineId, q]) => ({
        lineId,
        quantity: Number(q),
        unitCost: costes[lineId] === undefined || costes[lineId] === "" ? null : Number(costes[lineId]),
      }))
      .filter((l) => Number.isFinite(l.quantity) && l.quantity > 0);

    if (lines.length === 0) {
      toast.error("Indica cuánto llegó de al menos una línea.");
      return;
    }

    setBusy(true);
    const res = await api.post<{
      received: { description: string; quantity: number; movedStock: boolean }[];
      problems: { description: string; reason: string }[];
      status: string;
    }>(`/api/purchase-orders/${current._id}/receive`, { lines, allow_over: permitirExceso });
    setBusy(false);

    if (res.ok === false) {
      toast.error(res.error?.message || "No se pudo registrar la recepción");
      // Los problemas por línea vienen en el detalle del error.
      for (const p of (res.error?.details as { description: string; reason: string }[] | undefined) ?? []) {
        toast.warning(`${p.description}: ${p.reason}`);
      }
      return;
    }

    const movidas = res.data?.received.filter((r) => r.movedStock).length ?? 0;
    toast.success(
      `Recibidas ${res.data?.received.length ?? 0} líneas` +
      (movidas > 0 ? `, ${movidas} entraron al almacén` : "")
    );
    for (const p of res.data?.problems ?? []) toast.warning(`${p.description}: ${p.reason}`);
    await Promise.all([load(), abrir(current)]);
  };

  const totalPendiente = orders.length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Comercio"
        title="Recepción de mercancía"
        description="Lo que llega del proveedor entra al almacén aquí, línea por línea. Una orden puede llegar en varios camiones."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="Órdenes por recibir" value={formatNumber(totalPendiente)} icon="FileInput" />
        <KpiCard label="Pendiente en esta orden" value={formatNumber(state?.pending.units ?? 0)} icon="Package"
          hint="Unidades que el proveedor todavía debe." />
        <KpiCard label="Valor pendiente" value={formatMoney(state?.pending.value ?? 0, state?.currency || "usd")} icon="Banknote" />
      </div>

      <DataTable
        rows={orders}
        loading={loading}
        onRowClick={abrir}
        emptyIcon="FileInput"
        emptyTitle="No hay órdenes por recibir"
        emptyDescription="Solo aparecen las aprobadas, enviadas o a medio recibir: contra un borrador no se recibe."
        columns={[
          { key: "code", header: "Orden", render: (o: Order) => <span className="font-semibold">{o.code || o._id.slice(0, 8)}</span> },
          { key: "supplier", header: "Proveedor", render: (o: Order) => nameOf(o.supplier) },
          { key: "warehouse", header: "Almacén", hideOn: "md", render: (o: Order) => nameOf(o.warehouse) },
          { key: "expected", header: "Llegada prevista", hideOn: "sm", render: (o: Order) => formatDate(o.expected_at) },
          { key: "total", header: "Total", align: "right", render: (o: Order) => formatMoney(o.total ?? 0, o.currency || "usd") },
          { key: "status", header: "Estado", render: (o: Order) => <StatusBadge value={o.status} dict={PO_STATUS} /> },
        ]}
      />

      {/* ───────────────────────────── la orden ───────────────────────────── */}
      <Sheet open={Boolean(current)} onOpenChange={(v) => !v && (setCurrent(null), setState(null))}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
          {current && (
            <>
              <SheetHeader>
                <SheetTitle>{current.code || "Orden de compra"}</SheetTitle>
                <SheetDescription>
                  {nameOf(current.supplier)} · almacén {nameOf(state?.warehouse ?? current.warehouse)}
                  {(state?.receiptCount ?? 0) > 0 && ` · ${state!.receiptCount} recepciones anteriores`}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-5">
                {state && state.lines.length === 0 && (
                  <Card className="border-amber-500/40 bg-amber-500/5">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Esta orden no tiene líneas</CardTitle>
                      <CardDescription>
                        Sin líneas no hay nada que recibir. Añade qué se pidió, cuánto y a qué precio.
                      </CardDescription>
                    </CardHeader>
                  </Card>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setNuevaLinea(true)}>
                    <Icon name="Plus" className="mr-2 h-4 w-4" />
                    Añadir línea
                  </Button>
                  <Button size="sm" variant="ghost" onClick={recibirTodo} disabled={!state?.lines.some((l) => l.pending > 0)}>
                    Recibir todo lo pendiente
                  </Button>
                </div>

                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-2 text-left font-semibold">Línea</th>
                        <th className="p-2 text-right font-semibold">Pedido</th>
                        <th className="p-2 text-right font-semibold">Recibido</th>
                        <th className="p-2 text-right font-semibold">Falta</th>
                        <th className="p-2 text-right font-semibold">Llega ahora</th>
                        <th className="p-2 text-right font-semibold">Costo real</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(state?.lines ?? []).map((l) => (
                        <tr key={l.lineId} className="border-t">
                          <td className="p-2">
                            <p className="font-medium">{l.description}</p>
                            <p className="text-xs text-muted-foreground">
                              {l.movesStock ? "Entra al almacén" : "Servicio: no mueve stock"}
                            </p>
                          </td>
                          <td className="p-2 text-right tabular-nums">{formatNumber(l.ordered)}</td>
                          <td className="p-2 text-right tabular-nums">{formatNumber(l.received)}</td>
                          <td className="p-2 text-right tabular-nums font-semibold">{formatNumber(l.pending)}</td>
                          <td className="p-2 text-right">
                            <Input
                              type="number" min="0" step="0.001" className="h-8 w-24 text-right"
                              value={cantidades[l.lineId] ?? ""}
                              onChange={(e) => setCantidades((c) => ({ ...c, [l.lineId]: e.target.value }))}
                            />
                          </td>
                          <td className="p-2 text-right">
                            <Input
                              type="number" min="0" step="0.01" className="h-8 w-24 text-right"
                              placeholder={String(l.unitCost)}
                              value={costes[l.lineId] ?? ""}
                              onChange={(e) => setCostes((c) => ({ ...c, [l.lineId]: e.target.value }))}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox" className="h-4 w-4"
                    checked={permitirExceso}
                    onChange={(e) => setPermitirExceso(e.target.checked)}
                  />
                  El proveedor mandó de más y lo acepto
                </label>
                <p className="text-xs text-muted-foreground">
                  Sin marcar esta casilla, recibir más de lo pedido se rechaza: esas unidades de más también se pagan,
                  y colarse sin que nadie las vea es exactamente lo que hay que evitar. Si dejas el costo en blanco se
                  usa el del pedido; si el proveedor facturó otro precio, ponlo — el costo promedio del artículo se
                  recalcula con lo que de verdad se pagó.
                </p>

                <Button onClick={recibir} disabled={busy} className="w-full">
                  <Icon name="PackageCheck" className="mr-2 h-4 w-4" />
                  {busy ? "Registrando…" : "Registrar recepción"}
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ───────────────────────────── nueva línea ─────────────────────────── */}
      <Dialog open={nuevaLinea} onOpenChange={setNuevaLinea}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Añadir línea a la orden</DialogTitle>
            <DialogDescription>
              Con artículo, lo recibido entra al almacén. Sin artículo es un servicio —flete, montaje— que se
              recibe pero no mueve existencias.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="desc">Descripción</Label>
              <Input id="desc" value={linea.description}
                onChange={(e) => setLinea((l) => ({ ...l, description: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Artículo del almacén</Label>
              <Select value={linea.inventory_item} onValueChange={(v) => setLinea((l) => ({ ...l, inventory_item: v }))}>
                <SelectTrigger><SelectValue placeholder="Sin artículo (servicio)" /></SelectTrigger>
                <SelectContent>
                  {articulos.map((a) => (
                    <SelectItem key={a._id} value={a._id}>{a.name || a._id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="qty">Cantidad</Label>
                <Input id="qty" type="number" min="0" step="0.001" value={linea.quantity}
                  onChange={(e) => setLinea((l) => ({ ...l, quantity: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cost">Costo unitario</Label>
                <Input id="cost" type="number" min="0" step="0.01" value={linea.unit_cost}
                  onChange={(e) => setLinea((l) => ({ ...l, unit_cost: e.target.value }))} />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setNuevaLinea(false)}>Cancelar</Button>
            <Button onClick={agregarLinea} disabled={busy}>{busy ? "Guardando…" : "Añadir"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
