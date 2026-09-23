"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { usePortal } from "../portal-context";
import { PageHeader } from "@/components/tf/page-header";
import { EmptyState } from "@/components/tf/empty-state";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatDateTime, formatMoney, formatNumber, toDateInput } from "@/lib/format";
import { plazasParaMostrar } from "@/lib/plazas";

interface Salida { _id: string; departure_at?: string; available_pax?: number; capacity?: number; status?: string }
interface Producto {
  _id: string; name?: string; short_description?: string; location?: string;
  modalities: { _id: string; name?: string; modality_type?: string }[];
  price: { unit_price: number; total: number; currency: string } | null;
  departures: Salida[];
}
interface Linea {
  key: string;
  product_id: string;
  product_name: string;
  departure_id: string;
  departure_at?: string;
  modality_id?: string;
  adults: number;
  children: number;
  unit_price: number;
}
interface Cliente { _id: string; first_name?: string; last_name?: string; email?: string; phone?: string }
interface Credito { credit_limit: number; credit_available: number; currency: string }

/**
 * EL PORTAL DEJA DE SER SOLO LECTURA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTA PANTALLA NO HACE
 *
 * No calcula precios, no comprueba cupo y no decide si el crédito llega. Las
 * tres cosas vienen del servidor: el neto lo da el motor de precios con el
 * canal `b2b_portal`, las plazas libres las da el catálogo, y el crédito lo
 * vuelve a comprobar `createOrderWithBookings` con los documentos abiertos en
 * el momento de escribir.
 *
 * Lo que se enseña aquí es un ESPEJO de eso, para que quien vende sepa dónde
 * está antes de llegar al final. Un espejo que decidiera por su cuenta sería la
 * segunda verdad que se desincroniza sola — y en este caso, la que le hace
 * prometerle una plaza a un cliente que ya no existe.
 */
export default function PortalBookingPage() {
  const router = useRouter();
  const { query } = usePortal();

  const [fecha, setFecha] = useState(toDateInput(new Date()));
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [credito, setCredito] = useState<Credito | null>(null);

  const [lineas, setLineas] = useState<Linea[]>([]);
  const [eligiendo, setEligiendo] = useState<Producto | null>(null);

  const [buscaCliente, setBuscaCliente] = useState("");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [altaCliente, setAltaCliente] = useState(false);
  const [nuevo, setNuevo] = useState({ first_name: "", last_name: "", email: "", phone: "" });

  const [confirmando, setConfirmando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    const [cat, resumen] = await Promise.all([
      api.get<{ products: Producto[] }>(`/api/portal/catalog${query({ date: fecha || undefined })}`),
      api.get<{ credit?: Credito }>(`/api/portal/summary${query()}`),
    ]);
    setCargando(false);
    if (!cat.ok) {
      console.error("[portal/reservar] catálogo:", cat.error);
      toast.error(cat.error?.message || "No se pudo cargar el catálogo");
      setProductos([]);
    } else {
      setProductos(cat.data?.products || []);
    }
    if (resumen.ok) setCredito(resumen.data?.credit ?? null);
  }, [fecha, query]);

  useEffect(() => { void cargar(); }, [cargar]);

  // Búsqueda de clientes, con freno. Solo los del tour center: `customer` está
  // en su ámbito como propia desde 0075, así que la API ya acota.
  useEffect(() => {
    const t = setTimeout(async () => {
      const params = new URLSearchParams({ limit: "15" });
      if (buscaCliente.trim()) params.set("q", buscaCliente.trim());
      const res = await api.get<Cliente[]>(`/api/erp/customer?${params}`);
      if (!res.ok) {
        console.error("[portal/reservar] búsqueda de clientes:", res.error);
        return;
      }
      setClientes(res.data || []);
    }, 300);
    return () => clearTimeout(t);
  }, [buscaCliente]);

  const total = useMemo(
    () => lineas.reduce((a, l) => a + l.unit_price * (l.adults + l.children), 0),
    [lineas]
  );
  const moneda = credito?.currency || productos[0]?.price?.currency || "usd";

  /**
   * Cuánto se pasa del crédito, o cero.
   *
   * Es una ESTIMACIÓN y se dice así en pantalla: el saldo vivo cambia con cada
   * cobro, y quien decide de verdad es el servidor al escribir. Enseñarla como
   * un veto haría que el socio dejara de vender por un número viejo.
   */
  const exceso = credito && credito.credit_limit > 0
    ? Math.max(total - credito.credit_available, 0)
    : 0;

  const anadir = (p: Producto, salida: Salida, adults: number, children: number) => {
    setLineas((prev) => [...prev, {
      key: `${p._id}:${salida._id}:${Date.now()}`,
      product_id: p._id,
      product_name: p.name || "Excursión",
      departure_id: salida._id,
      departure_at: salida.departure_at,
      modality_id: p.modalities.find((m) => m.modality_type === "adult")?._id || p.modalities[0]?._id,
      adults, children,
      unit_price: p.price?.unit_price ?? 0,
    }]);
    setEligiendo(null);
  };

  const crearCliente = async () => {
    if (!nuevo.first_name.trim()) { toast.error("El nombre es obligatorio"); return; }
    const res = await api.post<Cliente>("/api/portal/customers", nuevo);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo dar de alta al cliente");
      return;
    }
    toast.success("Cliente dado de alta");
    setCliente(res.data ?? null);
    setAltaCliente(false);
    setNuevo({ first_name: "", last_name: "", email: "", phone: "" });
  };

  const confirmar = async () => {
    if (!cliente) { toast.error("Elige o da de alta al cliente"); return; }
    if (lineas.length === 0) { toast.error("Añade al menos una excursión"); return; }
    setConfirmando(true);
    /**
     * No se manda `partner_id`: lo pone el servidor desde el contexto. Mandarlo
     * daría la impresión de que la pantalla lo decide, y el día que alguien
     * cambiara ese valor en la petición se descubriría que no servía de nada
     * —o, peor, que sí—.
     */
    const res = await api.post<{ order: { _id: string; order_number?: string } }>("/api/orders", {
      customer_id: cliente._id,
      channel: "b2b_portal",
      items: lineas.map((l) => ({
        product_id: l.product_id,
        departure_id: l.departure_id,
        modality_id: l.modality_id,
        adults: l.adults,
        children: l.children,
      })),
    });
    setConfirmando(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo completar la reserva");
      return;
    }
    toast.success(`Reserva ${res.data?.order.order_number ?? ""} confirmada`);
    setLineas([]);
    setCliente(null);
    router.push("/portal/reservas");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reservar"
        description="Precio neto, plazas reales y tu crédito disponible, en la misma pantalla."
        actions={
          <Input
            type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
            className="w-44" aria-label="Día de la excursión"
          />
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          {cargando ? (
            <>{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}</>
          ) : productos.length === 0 ? (
            <EmptyState
              icon="Ticket"
              title="No hay nada que vender ese día"
              description="Prueba con otra fecha o consulta con tu operador qué excursiones tienes autorizadas."
            />
          ) : (
            productos.map((p) => (
              <div key={p._id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">{p.name}</div>
                    {p.location && <div className="text-xs text-muted-foreground">{p.location}</div>}
                    <div className="mt-1 text-sm">
                      {p.price
                        ? <><span className="font-semibold">{formatMoney(p.price.unit_price, p.price.currency)}</span>
                            <span className="text-muted-foreground"> neto por persona</span></>
                        : <span className="text-muted-foreground">Sin tarifa para ti en esta fecha</span>}
                    </div>
                  </div>
                  <Button
                    size="sm" variant="outline"
                    disabled={!p.price || p.departures.length === 0}
                    onClick={() => setEligiendo(p)}
                  >
                    Añadir
                  </Button>
                </div>
                {p.departures.length === 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">No hay salidas ese día.</p>
                )}
              </div>
            ))
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="font-display text-sm font-semibold">Tu reserva</h2>
            {lineas.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Todavía no has añadido nada.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {lineas.map((l) => (
                  <li key={l.key} className="flex items-start justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{l.product_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {l.departure_at ? formatDateTime(l.departure_at) : "Sin fecha"} ·{" "}
                        {formatNumber(l.adults)} ad.{l.children > 0 ? ` · ${formatNumber(l.children)} niños` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums">{formatMoney(l.unit_price * (l.adults + l.children), moneda)}</span>
                      <button
                        type="button"
                        onClick={() => setLineas((prev) => prev.filter((x) => x.key !== l.key))}
                        className="text-muted-foreground transition-colors hover:text-destructive"
                        aria-label={`Quitar ${l.product_name}`}
                      >
                        <Icon name="X" className="size-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-sm font-semibold">
              <span>Total neto</span>
              <span className="tabular-nums">{formatMoney(total, moneda)}</span>
            </div>
          </div>

          {credito && credito.credit_limit > 0 && (
            <div className="rounded-xl border border-border bg-card p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Crédito disponible</span>
                <span className="tabular-nums">{formatMoney(credito.credit_available, moneda)}</span>
              </div>
              {exceso > 0 && (
                <p className="mt-2 text-xs text-amber-600">
                  Esta reserva supera tu crédito en {formatMoney(exceso, moneda)}. Tu operador tendrá que
                  autorizarla o tendrás que abonar antes.
                </p>
              )}
            </div>
          )}

          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="font-display text-sm font-semibold">Cliente</h2>
            {cliente ? (
              <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {[cliente.first_name, cliente.last_name].filter(Boolean).join(" ")}
                  </div>
                  {cliente.email && <div className="truncate text-xs text-muted-foreground">{cliente.email}</div>}
                </div>
                <Button variant="ghost" size="sm" onClick={() => setCliente(null)}>Cambiar</Button>
              </div>
            ) : (
              <div className="mt-2 space-y-2">
                <Input
                  placeholder="Buscar por nombre, correo o teléfono"
                  value={buscaCliente}
                  onChange={(e) => setBuscaCliente(e.target.value)}
                />
                <ul className="max-h-40 space-y-1 overflow-y-auto">
                  {clientes.map((c) => (
                    <li key={c._id}>
                      <button
                        type="button"
                        onClick={() => setCliente(c)}
                        className="w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                      >
                        {[c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || "Cliente"}
                      </button>
                    </li>
                  ))}
                </ul>
                <Button variant="outline" size="sm" className="w-full" onClick={() => setAltaCliente(true)}>
                  <Icon name="UserPlus" className="mr-2 size-4" /> Dar de alta un cliente
                </Button>
              </div>
            )}
          </div>

          <Button className="w-full" disabled={confirmando || !cliente || lineas.length === 0} onClick={confirmar}>
            {confirmando ? "Confirmando…" : "Confirmar reserva"}
          </Button>
        </aside>
      </div>

      <ElegirSalida producto={eligiendo} onCerrar={() => setEligiendo(null)} onAnadir={anadir} moneda={moneda} />

      <Sheet open={altaCliente} onOpenChange={setAltaCliente}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Dar de alta un cliente</SheetTitle>
            <SheetDescription>Queda en TU cartera, no en la de tu operador.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="cli-nombre">Nombre</Label>
              <Input id="cli-nombre" value={nuevo.first_name} onChange={(e) => setNuevo({ ...nuevo, first_name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cli-apellido">Apellidos</Label>
              <Input id="cli-apellido" value={nuevo.last_name} onChange={(e) => setNuevo({ ...nuevo, last_name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cli-email">Correo</Label>
              <Input id="cli-email" type="email" value={nuevo.email} onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cli-tel">Teléfono</Label>
              <Input id="cli-tel" value={nuevo.phone} onChange={(e) => setNuevo({ ...nuevo, phone: e.target.value })} />
            </div>
          </div>
          <SheetFooter>
            <Button onClick={crearCliente}>Dar de alta</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** Elegir salida y pasajeros, con las plazas que quedan de verdad delante. */
function ElegirSalida({
  producto, onCerrar, onAnadir, moneda,
}: {
  producto: Producto | null;
  onCerrar: () => void;
  onAnadir: (p: Producto, s: Salida, adults: number, children: number) => void;
  moneda: string;
}) {
  const [salidaId, setSalidaId] = useState("");
  const [adultos, setAdultos] = useState(1);
  const [ninos, setNinos] = useState(0);

  useEffect(() => {
    setSalidaId(producto?.departures[0]?._id ?? "");
    setAdultos(1);
    setNinos(0);
  }, [producto]);

  if (!producto) return null;
  const salida = producto.departures.find((d) => d._id === salidaId);
  const pax = adultos + ninos;
  /**
   * Las plazas son las del servidor, y se avisa ANTES de añadir.
   *
   * El botón no se bloquea por esto: la capacidad la decide `assertCapacity` al
   * escribir, y un bloqueo aquí con un número de hace dos minutos le impediría
   * vender una plaza que acaba de liberarse. Se avisa, que es lo honesto.
   *
   * Y por `plazasParaMostrar`, no por `?? 0`: un cupo que nadie ha calculado
   * —una salida creada por SQL, una importación— no es un agotado, y pintarlo
   * como tal le dice al tour center que no puede vender una salida vacía. Lo
   * cazó la guarda que nació de esa misma captura.
   */
  const { libres, desconocido } = plazasParaMostrar(salida);

  return (
    <Sheet open onOpenChange={(v) => { if (!v) onCerrar(); }}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{producto.name}</SheetTitle>
          <SheetDescription>
            {producto.price ? `${formatMoney(producto.price.unit_price, moneda)} neto por persona` : ""}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="salida">Salida</Label>
            <Select value={salidaId} onValueChange={setSalidaId}>
              <SelectTrigger id="salida"><SelectValue placeholder="Elige una salida" /></SelectTrigger>
              <SelectContent>
                {producto.departures.map((d) => {
                  const cupo = plazasParaMostrar(d);
                  return (
                    <SelectItem key={d._id} value={d._id}>
                      {d.departure_at ? formatDateTime(d.departure_at) : "Sin fecha"}
                      {" · "}
                      {cupo.desconocido ? "cupo sin definir" : `${formatNumber(cupo.libres)} plazas`}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="adultos">Adultos</Label>
              <Input id="adultos" type="number" min={1} value={adultos}
                onChange={(e) => setAdultos(Math.max(1, Number(e.target.value) || 1))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ninos">Niños</Label>
              <Input id="ninos" type="number" min={0} value={ninos}
                onChange={(e) => setNinos(Math.max(0, Number(e.target.value) || 0))} />
            </div>
          </div>
          {!desconocido && pax > libres && (
            <p className="text-xs text-amber-600">
              Quedaban {formatNumber(libres)} plazas cuando se cargó esta pantalla. Puedes intentarlo:
              el cupo real se comprueba al confirmar.
            </p>
          )}
        </div>
        <SheetFooter>
          <Button
            disabled={!salida}
            onClick={() => salida && onAnadir(producto, salida, adultos, ninos)}
          >
            Añadir a la reserva
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
