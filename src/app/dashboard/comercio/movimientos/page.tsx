"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge } from "@/components/tf/status-badge";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MOVEMENT_TYPE } from "@/lib/labels-modules";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";
import { formatDateTime, formatNumber } from "@/lib/format";

/**
 * KARDEX, Y AHORA SÍ INMUTABLE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LO QUE PASABA ANTES, Y ERA LO PEOR DE TODA LA AUDITORÍA
 *
 * Esta pantalla se titula «Kardex inmutable» y tenía un formulario genérico
 * «Nuevo movimiento» con `quantity`, `movement_type` y almacén destino, que
 * escribía a `/api/erp/stock_movement`. Con lápiz y papelera en cada fila.
 *
 * El problema no era que faltara un botón: **el botón estaba y hacía lo que no
 * era**. Escribir un `stock_movement` por el CRUD genérico **no mueve el
 * saldo** — nada lo mantiene desde esa tabla, ni en la aplicación ni con un
 * disparador en Postgres—. Así que registrar una merma de 10 dejaba el kardex
 * diciendo «merma de 10» y la existencia intacta en 50. Y de paso se saltaba
 * todo lo que vive en `postMovement`:
 *
 *   · el bloqueo de stock negativo,
 *   · el recálculo del costo promedio ponderado,
 *   · la segunda pata de una transferencia —una transferencia a medias es el
 *     peor resultado posible—,
 *   · y el aviso de existencias bajas.
 *
 * Un motor sin puerta se nota: el módulo sale vacío. Esto no se notaba, porque
 * la fila SÍ aparecía en la lista. La diferencia entre el kardex y la existencia
 * no salía hasta el conteo físico, que es literalmente lo que el comentario de
 * `stock_level` en `resources.ts` avisaba desde 0052 — una tabla más arriba.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AHORA
 *
 * El movimiento se registra por `POST /api/inventory/movement`, y
 * `stock_movement` salió de la lista blanca de escritura del CRUD genérico. No
 * hay lápiz ni papelera: un kardex del que se borra una línea no es un kardex.
 */

interface Movimiento {
  _id: string;
  moved_at?: string;
  movement_type?: string;
  inventory_item?: { name?: string; sku?: string } | string;
  warehouse?: { name?: string } | string;
  quantity?: number;
  balance_after?: number;
  unit_cost?: number;
  reference?: string;
  reason?: string;
}

interface Articulo { _id: string; name?: string; sku?: string; unit?: string }
interface Almacen { _id: string; name?: string; allows_negative?: boolean }

/**
 * LOS TIPOS QUE TECLEA UNA PERSONA.
 *
 * De los nueve, tres no se piden nunca a mano y por motivos distintos:
 *
 *  · `sale` y `consumption` los escribe la venta (`stock-commitment-service`).
 *    Teclear a mano una salida «por venta» que ninguna venta respalda deja el
 *    kardex sin poder contrastarse con la operación — el mismo motivo por el que
 *    el asiento manual del libro diario no se puede firmar como «venta».
 *  · `transfer_in` **la escribe el propio motor** como segunda pata de una
 *    transferencia. Ofrecerla aquí haría que una transferencia entrara dos
 *    veces.
 *
 * `receipt` sí se ofrece: además de la recepción de una orden de compra, hay
 * entradas sin orden —una compra de contado, una donación, un sobrante—.
 */
const TIPOS_MANUALES = ["receipt", "waste", "adjustment", "count", "transfer_out", "return"] as const;

/** Lo que cada tipo le hace al saldo, dicho donde se teclea. */
const EFECTO: Record<string, string> = {
  receipt: "Suma al saldo del almacén.",
  waste: "Resta del saldo. Es la pérdida que no se vendió: roto, vencido, derramado.",
  adjustment: "Suma o resta según el signo: escribe una cantidad negativa para bajar el saldo.",
  count: "El saldo QUEDA en esta cantidad, no se le suma. Es el conteo físico.",
  transfer_out: "Resta del almacén de origen y suma al destino, en un solo paso.",
  return: "Suma al saldo: mercancía que vuelve.",
};

const VACIO = {
  inventory_item: "", warehouse: "", movement_type: "receipt", quantity: "",
  unit_cost: "", currency: "dop", to_warehouse: "", lot_code: "", reference: "", reason: "",
};

export default function MovimientosPage() {
  const [version, setVersion] = useState(0);
  const [abierto, setAbierto] = useState(false);
  const [form, setForm] = useState(VACIO);
  const [articulos, setArticulos] = useState<Articulo[] | null>(null);
  const [almacenes, setAlmacenes] = useState<Almacen[] | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const cargarCatalogos = useCallback(async () => {
    const [a, w] = await Promise.all([
      api.get<Articulo[]>("/api/erp/inventory_item?limit=500&sort=name"),
      api.get<Almacen[]>("/api/erp/warehouse?limit=200&sort=name"),
    ]);
    if (!a.ok || !w.ok) {
      toast.error("No se pudieron cargar artículos y almacenes");
      setArticulos([]); setAlmacenes([]);
      return;
    }
    setArticulos(a.data || []);
    setAlmacenes(w.data || []);
  }, []);

  useEffect(() => { if (abierto && articulos === null) void cargarCatalogos(); },
    [abierto, articulos, cargarCatalogos]);

  const esTransferencia = form.movement_type === "transfer_out";
  const esConteo = form.movement_type === "count";
  const esAjuste = form.movement_type === "adjustment";
  const cantidad = Number(form.quantity);

  /**
   * Las mismas reglas que el servidor, adelantadas.
   *
   * No las sustituyen: `postMovement` las vuelve a comprobar y además sabe cosas
   * que el navegador no —si el almacén admite negativos, cuál es el saldo—. Aquí
   * se dicen antes para que nadie descubra por un 400 que a una transferencia le
   * falta el destino.
   */
  const problema =
    !form.inventory_item ? "Elige el artículo."
    : !form.warehouse ? "Elige el almacén."
    : !Number.isFinite(cantidad) || cantidad === 0
      ? (esAjuste ? "La cantidad debe ser distinta de cero (puede ser negativa)." : "Indica la cantidad.")
    : !esAjuste && cantidad < 0 ? "Solo un ajuste puede llevar cantidad negativa."
    : esConteo && cantidad < 0 ? "Un conteo no puede ser negativo."
    : esTransferencia && !form.to_warehouse ? "Una transferencia necesita almacén destino."
    : esTransferencia && form.to_warehouse === form.warehouse ? "El destino debe ser distinto del origen."
    : null;

  const registrar = async () => {
    setTrabajando(true);
    const res = await api.post<{ legs: { before: number; after: number }[] }>("/api/inventory/movement", {
      inventory_item: form.inventory_item,
      warehouse: form.warehouse,
      movement_type: form.movement_type,
      quantity: cantidad,
      unit_cost: form.unit_cost ? Number(form.unit_cost) : undefined,
      currency: form.unit_cost ? form.currency : undefined,
      to_warehouse: esTransferencia ? form.to_warehouse : undefined,
      lot_code: form.lot_code || undefined,
      reference: form.reference || undefined,
      reason: form.reason || undefined,
    });
    setTrabajando(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo registrar el movimiento");
      return;
    }
    // El saldo resultante lo dice el motor. Enseñarlo cierra el lazo: quien
    // registra una merma quiere ver en cuánto se quedó.
    const pata = res.data?.legs?.[0];
    toast.success(pata
      ? `Movimiento registrado · saldo ${formatNumber(pata.before)} → ${formatNumber(pata.after)}`
      : "Movimiento registrado");
    setAbierto(false);
    setForm(VACIO);
    setVersion((v) => v + 1);
  };

  const nombreDe = (r: Movimiento["inventory_item"]) =>
    typeof r === "object" && r ? (r.name || r.sku || "—") : "—";

  return (
    <>
      <ResourcePage
        key={version}
        resource="stock_movement"
        eyebrow="Comercio"
        title="Movimientos de inventario"
        description="Kardex inmutable: entradas, salidas, consumos, transferencias, mermas y ajustes con el saldo resultante. Cada línea la escribe el motor de inventario; ninguna se teclea ni se borra."
        emptyIcon="ArrowRightLeft"
        emptyTitle="Sin movimientos de inventario"
        emptyDescription="Las ventas y las recepciones escriben aquí solas. Una merma, un ajuste, un conteo o una transferencia se registran con el botón de arriba."
        searchPlaceholder="Buscar por referencia, motivo o lote…"
        initialSort="-moved_at"
        // Una línea del kardex no se edita ni se borra: se corrige con un ajuste
        // o un conteo, que dejan su propio rastro.
        canWrite={false}
        extraActions={
          <Button onClick={() => setAbierto(true)}>
            <Icon name="Plus" className="size-4" /> Registrar movimiento
          </Button>
        }
        filters={[{ name: "movement_type", label: "Tipo", options: optionsFrom(MOVEMENT_TYPE) }]}
        columns={[
          { key: "moved_at", header: "Fecha",
            render: (m: Movimiento) => <span className="tf-num text-xs">{formatDateTime(m.moved_at)}</span> },
          { key: "movement_type", header: "Tipo",
            render: (m: Movimiento) => <StatusBadge value={m.movement_type} dict={MOVEMENT_TYPE} /> },
          { key: "inventory_item", header: "Artículo",
            render: (m: Movimiento) => <span className="text-sm">{nombreDe(m.inventory_item)}</span> },
          { key: "warehouse", header: "Almacén", hideOn: "md",
            render: (m: Movimiento) => <span className="text-sm">{nombreDe(m.warehouse as never)}</span> },
          { key: "quantity", header: "Cantidad", align: "right",
            render: (m: Movimiento) => (
              <span className={`tf-num font-semibold ${Number(m.quantity ?? 0) < 0 ? "text-destructive" : ""}`}>
                {formatNumber(m.quantity ?? 0, 2)}
              </span>
            ) },
          { key: "balance_after", header: "Saldo", align: "right",
            render: (m: Movimiento) => <span className="tf-num">{formatNumber(m.balance_after ?? 0, 2)}</span> },
          { key: "reference", header: "Referencia", hideOn: "lg",
            render: (m: Movimiento) => (
              <span className="text-xs text-muted-foreground">{m.reference || m.reason || "—"}</span>
            ) },
        ]}
        fields={[]}
      />

      <Dialog open={abierto} onOpenChange={(o) => { if (!o) { setAbierto(false); setForm(VACIO); } }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Registrar movimiento</DialogTitle>
            <DialogDescription>
              El saldo del almacén lo mueve este registro. Una salida que dejaría la existencia en
              negativo se rechaza, salvo que el almacén lo admita.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="mv-tipo">Tipo</Label>
              <Select value={form.movement_type} onValueChange={(v) => setForm({ ...form, movement_type: v })}>
                <SelectTrigger id="mv-tipo"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPOS_MANUALES.map((t) => (
                    <SelectItem key={t} value={t}>{MOVEMENT_TYPE[t]?.label ?? t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Qué le hace al saldo, dicho aquí y no en un manual. */}
              <p className="text-xs text-muted-foreground">{EFECTO[form.movement_type]}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mv-articulo">Artículo</Label>
              <Select value={form.inventory_item} onValueChange={(v) => setForm({ ...form, inventory_item: v })}>
                <SelectTrigger id="mv-articulo">
                  <SelectValue placeholder={articulos === null ? "Cargando…" : "Elige el artículo"} />
                </SelectTrigger>
                <SelectContent>
                  {(articulos || []).map((a) => (
                    <SelectItem key={a._id} value={a._id}>
                      {a.name}{a.sku ? ` · ${a.sku}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mv-almacen">{esTransferencia ? "Almacén de origen" : "Almacén"}</Label>
              <Select value={form.warehouse} onValueChange={(v) => setForm({ ...form, warehouse: v })}>
                <SelectTrigger id="mv-almacen">
                  <SelectValue placeholder={almacenes === null ? "Cargando…" : "Elige el almacén"} />
                </SelectTrigger>
                <SelectContent>
                  {(almacenes || []).map((w) => (
                    <SelectItem key={w._id} value={w._id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {esTransferencia && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="mv-destino">Almacén destino</Label>
                <Select value={form.to_warehouse} onValueChange={(v) => setForm({ ...form, to_warehouse: v })}>
                  <SelectTrigger id="mv-destino"><SelectValue placeholder="Elige el destino" /></SelectTrigger>
                  <SelectContent>
                    {(almacenes || []).filter((w) => w._id !== form.warehouse).map((w) => (
                      <SelectItem key={w._id} value={w._id}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="mv-cantidad">
                {esConteo ? "Cantidad contada" : "Cantidad"}
              </Label>
              <Input id="mv-cantidad" type="number" step="0.01" className="tf-num"
                min={esAjuste ? undefined : "0"}
                value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mv-costo">Costo unitario</Label>
              <Input id="mv-costo" type="number" min="0" step="0.01" className="tf-num"
                value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} />
              {/* El costo promedio solo se recalcula con las entradas que lo traen. */}
              <p className="text-xs text-muted-foreground">
                {form.movement_type === "receipt" || form.movement_type === "return"
                  ? "Con el costo, la entrada recalcula el promedio ponderado del artículo."
                  : "Opcional: solo las entradas con costo mueven el promedio ponderado."}
              </p>
            </div>

            {Boolean(form.unit_cost) && (
              <div className="space-y-1.5">
                <Label htmlFor="mv-moneda">Moneda</Label>
                <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                  <SelectTrigger id="mv-moneda"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="mv-lote">Lote</Label>
              <Input id="mv-lote" value={form.lot_code}
                onChange={(e) => setForm({ ...form, lot_code: e.target.value })} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mv-ref">Referencia</Label>
              <Input id="mv-ref" value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
                placeholder="Factura, acta de merma…" />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="mv-motivo">Motivo</Label>
              <Textarea id="mv-motivo" rows={2} value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder="Por qué se mueve. En una merma o un ajuste es lo único que lo explica." />
            </div>
          </div>

          {problema && (
            <p className="flex items-start gap-2 text-sm text-destructive">
              <Icon name="TriangleAlert" className="mt-0.5 size-4 shrink-0" /> {problema}
            </p>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => { setAbierto(false); setForm(VACIO); }}>Cancelar</Button>
            <Button onClick={registrar} disabled={Boolean(problema) || trabajando}>
              {trabajando ? "Registrando…" : "Registrar movimiento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
