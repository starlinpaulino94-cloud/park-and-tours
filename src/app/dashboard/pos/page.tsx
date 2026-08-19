"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/tf/page-header";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { EmptyState } from "@/components/tf/empty-state";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CHANNEL, DEPARTURE_STATUS, MODALITY_TYPE, PAYMENT_METHOD } from "@/lib/labels";
import { formatDate, formatMoney, formatNumber, formatTime, toDateInput } from "@/lib/format";
import { optionsFrom } from "@/components/tf/options";

interface CatalogDeparture {
  _id: string; departure_at?: string; capacity: number; available_pax: number; status?: string;
}
interface CatalogModality {
  _id: string; name?: string; modality_type?: string; price?: number; min_pax?: number; max_pax?: number;
}
interface CatalogProduct {
  _id: string; name?: string; code?: string; product_type?: string; short_description?: string;
  cover_image_url?: string; location?: string; duration_hours?: number;
  base_price: number; currency: string; category?: string; meeting_point?: string;
  modalities: CatalogModality[];
  departures: CatalogDeparture[];
}
interface PosContext {
  currency: string; role: string;
  catalog: CatalogProduct[];
  hotels: { _id: string; name?: string; zone?: string }[];
  sellers: { _id: string; name: string }[];
  partners: { _id: string; name: string }[];
  branches: { _id: string; name?: string }[];
  cash_session: { _id: string; code?: string; register?: string } | null;
}

interface CartItem {
  uid: string;
  product: CatalogProduct;
  departure_id: string;
  modality_id: string;
  adults: number;
  children: number;
  infants: number;
  discount_pct: number;
  pickup_hotel_id: string;
  room_number: string;
  pickup_time: string;
  notes: string;
}

interface QuoteLine {
  product_id: string; modality_id: string | null; quantity: number; pax_total: number;
  unit_price: number; gross_amount: number; discount_amount: number;
  tax_amount: number; total_amount: number; currency: string;
  applied_rule: string | null; error: string | null;
}
interface Quote {
  lines: QuoteLine[];
  currency: string;
  totals: { gross: number; discount: number; tax: number; total: number; pax: number };
}

let uidCounter = 0;
const nextUid = () => `item-${++uidCounter}`;

export default function PosPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<PosContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState(toDateInput(new Date()));
  const [productSearch, setProductSearch] = useState("");

  const [cart, setCart] = useState<CartItem[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);

  // sale header
  const [customerId, setCustomerId] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customers, setCustomers] = useState<any[]>([]);
  const [channel, setChannel] = useState("pos");
  const [sellerId, setSellerId] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [notes, setNotes] = useState("");
  const [override, setOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  // quick customer creation
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ first_name: "", last_name: "", email: "", phone: "", country: "" });

  // payment right after the sale
  const [payFor, setPayFor] = useState<{ order: any; bookings: any[] } | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("cash");

  const loadContext = useCallback(async () => {
    setLoading(true);
    const res = await api.get<PosContext>(`/api/pos/context?date=${date}`);
    setLoading(false);
    if (!res.ok) {
      console.error("[pos] error cargando el catálogo:", res.error);
      toast.error(res.error?.message || "No se pudo cargar el punto de venta");
      return;
    }
    setCtx(res.data || null);
  }, [date]);

  useEffect(() => { loadContext(); }, [loadContext]);

  // Customer search — debounced, server-side.
  useEffect(() => {
    const t = setTimeout(async () => {
      const params = new URLSearchParams({ limit: "20" });
      if (customerQuery.trim()) params.set("q", customerQuery.trim());
      const res = await api.get<any[]>(`/api/erp/customer?${params}`);
      if (!res.ok) {
        console.error("[pos] error buscando clientes:", res.error);
        return;
      }
      setCustomers(res.data || []);
    }, 300);
    return () => clearTimeout(t);
  }, [customerQuery]);

  // Every cart change is re-priced by the server; the browser never computes a price.
  useEffect(() => {
    const priceable = cart.filter((i) => i.product?._id);
    if (priceable.length === 0) { setQuote(null); return; }

    let cancelled = false;
    setQuoting(true);
    const t = setTimeout(async () => {
      const res = await api.post<Quote>("/api/pricing/quote", {
        partner_id: partnerId || null,
        seller_id: sellerId || null,
        channel,
        items: priceable.map((i) => ({
          product_id: i.product._id,
          modality_id: i.modality_id || null,
          adults: i.adults,
          children: i.children,
          infants: i.infants,
          discount_pct: i.discount_pct,
          travel_date: i.departure_id
            ? i.product.departures.find((d) => d._id === i.departure_id)?.departure_at || null
            : null,
        })),
      });
      if (cancelled) return;
      setQuoting(false);
      if (!res.ok) {
        console.error("[pos] error calculando el precio:", res.error);
        toast.error(res.error?.message || "No se pudo calcular el precio");
        return;
      }
      setQuote(res.data || null);
    }, 350);

    return () => { cancelled = true; clearTimeout(t); };
  }, [cart, partnerId, sellerId, channel]);

  const addToCart = (product: CatalogProduct) => {
    const modality = product.modalities.find((m) => m.modality_type === "adult") || product.modalities[0];
    const departure = product.departures.find((d) => (d.available_pax ?? 0) > 0) || product.departures[0];
    setCart((c) => [...c, {
      uid: nextUid(),
      product,
      departure_id: departure?._id || "",
      modality_id: modality?._id || "",
      adults: 1, children: 0, infants: 0,
      discount_pct: 0,
      pickup_hotel_id: "", room_number: "", pickup_time: "", notes: "",
    }]);
    toast.success(`${product.name} añadido a la venta`);
  };

  const patchItem = (uid: string, patch: Partial<CartItem>) =>
    setCart((c) => c.map((i) => (i.uid === uid ? { ...i, ...patch } : i)));

  const removeItem = (uid: string) => setCart((c) => c.filter((i) => i.uid !== uid));

  const createCustomer = async () => {
    if (!newCustomer.first_name.trim()) { toast.error("El nombre del cliente es obligatorio"); return; }
    setBusy(true);
    const res = await api.post<any>("/api/erp/customer", { ...newCustomer, status: "active", source: "walk_in" });
    setBusy(false);
    if (!res.ok) {
      console.error("[pos] error creando el cliente:", res.error);
      toast.error(res.error?.message || "No se pudo crear el cliente");
      return;
    }
    const created = res.data;
    toast.success("Cliente creado");
    setCustomerId(created._id);
    setCustomers((c) => [created, ...c]);
    setNewCustomerOpen(false);
    setNewCustomer({ first_name: "", last_name: "", email: "", phone: "", country: "" });
  };

  const confirmSale = async () => {
    if (!customerId) { toast.error("Selecciona o crea el cliente de la venta"); return; }
    if (cart.length === 0) { toast.error("Añade al menos una excursión a la venta"); return; }
    const missingDeparture = cart.find((i) => !i.departure_id);
    if (missingDeparture) { toast.error(`Selecciona la salida de ${missingDeparture.product.name}`); return; }

    setBusy(true);
    const res = await api.post<{ order: any; bookings: any[]; commissionsCreated: number }>("/api/orders", {
      customer_id: customerId,
      branch_id: branchId || null,
      seller_id: sellerId || null,
      partner_id: partnerId || null,
      channel,
      notes: notes || null,
      capacity_override: override,
      override_reason: override ? overrideReason || "Autorizado en el punto de venta" : null,
      items: cart.map((i) => ({
        product_id: i.product._id,
        departure_id: i.departure_id || null,
        modality_id: i.modality_id || null,
        adults: i.adults,
        children: i.children,
        infants: i.infants,
        discount_pct: i.discount_pct,
        pickup_hotel_id: i.pickup_hotel_id || null,
        pickup_time: i.pickup_time || null,
        room_number: i.room_number || null,
        notes: i.notes || null,
      })),
    });
    setBusy(false);

    if (!res.ok) {
      console.error("[pos] error creando la venta:", res.error);
      toast.error(res.error?.message || "No se pudo registrar la venta");
      return;
    }

    const { order, bookings = [], commissionsCreated = 0 } = res.data || {};
    toast.success(`Venta ${order?.order_number} registrada · ${bookings.length} reserva${bookings.length === 1 ? "" : "s"}${
      commissionsCreated > 0 ? ` · ${commissionsCreated} comisiones` : ""}`);

    setPayFor({ order, bookings });
    setPayAmount(String(order?.total ?? quote?.totals.total ?? ""));
    setCart([]);
    setQuote(null);
    setNotes("");
    setOverride(false);
    setOverrideReason("");
    loadContext();
  };

  const registerPayment = async () => {
    if (!payFor) return;
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) { toast.error("El importe debe ser mayor que cero"); return; }
    setBusy(true);
    const res = await api.post("/api/payments", {
      order_id: payFor.order._id,
      amount,
      method: payMethod,
      payment_type: "payment",
    });
    setBusy(false);
    if (!res.ok) {
      console.error("[pos] error cobrando la venta:", res.error);
      toast.error(res.error?.message || "No se pudo registrar el cobro");
      return;
    }
    toast.success("Cobro registrado");
    setPayFor(null);
    setCustomerId("");
  };

  const filteredCatalog = useMemo(() => {
    const term = productSearch.trim().toLowerCase();
    if (!term) return ctx?.catalog || [];
    return (ctx?.catalog || []).filter((p) =>
      [p.name, p.code, p.category, p.location].filter(Boolean).some((v) => String(v).toLowerCase().includes(term))
    );
  }, [ctx, productSearch]);

  const currency = quote?.currency || ctx?.currency || "usd";
  const selectedCustomer = customers.find((c) => c._id === customerId);
  const hasBlockingError = (quote?.lines || []).some((l) => l.error);
  const overCapacity = cart.some((i) => {
    const dep = i.product.departures.find((d) => d._id === i.departure_id);
    if (!dep) return false;
    return i.adults + i.children + i.infants > (dep.available_pax ?? 0);
  });

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Comercial"
        title="Punto de venta"
        description="Una orden puede llevar varias excursiones. El precio, el coste y las comisiones los calcula el servidor con las reglas activas."
        actions={
          <>
            <div className="flex items-center gap-1.5">
              <Label className="text-xs text-muted-foreground">Salidas desde</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-[150px]" />
            </div>
            <Button variant="outline" size="icon" onClick={loadContext} aria-label="Actualizar">
              <Icon name="RefreshCw" className="size-4" />
            </Button>
          </>
        }
      />

      {ctx && !ctx.cash_session && (
        <p className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          <Icon name="Wallet" className="size-4 shrink-0" />
          No tienes ninguna caja abierta: podrás registrar la venta, pero no cobrarla en efectivo.
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => router.push("/dashboard/caja")}>
            Abrir caja
          </Button>
        </p>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        {/* ---- catalogue ------------------------------------------------- */}
        <section className="space-y-3">
          <div className="relative">
            <Icon name="Search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={productSearch} onChange={(e) => setProductSearch(e.target.value)} className="pl-9"
              placeholder="Buscar excursión por nombre, código, categoría o ubicación…" />
          </div>

          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36 w-full rounded-xl" />)}
            </div>
          ) : filteredCatalog.length === 0 ? (
            <div className="tf-card p-2">
              <EmptyState icon="Ticket" title="No hay excursiones disponibles"
                description="Crea excursiones activas y genera su calendario de salidas para poder vender." />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {filteredCatalog.map((p) => {
                const next = p.departures[0];
                const seats = p.departures.reduce((s, d) => s + (d.available_pax ?? 0), 0);
                return (
                  <article key={p._id} className="tf-card tf-rise flex flex-col overflow-hidden">
                    {p.cover_image_url && (
                      <img src={p.cover_image_url} alt={p.name || "Excursión"} className="h-24 w-full object-cover" />
                    )}
                    <div className="flex flex-1 flex-col gap-2 p-4">
                      <div>
                        <p className="font-display text-sm font-semibold leading-tight">{p.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {[p.category, p.location, p.duration_hours ? `${p.duration_hours} h` : null].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Pill tone="accent">{formatMoney(p.base_price, p.currency)}</Pill>
                        {p.modalities.length > 0 && <Pill tone="neutral">{p.modalities.length} modalidades</Pill>}
                        <Pill tone={seats > 0 ? "success" : "danger"}>{formatNumber(seats)} plazas</Pill>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {next ? `Próxima salida ${formatDate(next.departure_at)} · ${formatTime(next.departure_at)}` : "Sin salidas programadas"}
                      </p>
                      <Button size="sm" className="mt-auto gap-1.5" onClick={() => addToCart(p)}
                        disabled={p.departures.length === 0}>
                        <Icon name="Plus" className="size-4" /> Añadir a la venta
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* ---- cart ------------------------------------------------------ */}
        <section className="space-y-4">
          {/* customer */}
          <div className="tf-card space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-base font-semibold">Cliente</h2>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setNewCustomerOpen(true)}>
                <Icon name="UserPlus" className="size-3.5" /> Nuevo
              </Button>
            </div>
            <Input value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)}
              placeholder="Buscar por nombre, email, teléfono o documento…" />
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger><SelectValue placeholder="Selecciona el cliente" /></SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c._id} value={c._id}>
                    {[c.first_name, c.last_name].filter(Boolean).join(" ") || "Sin nombre"}
                    {c.email ? ` · ${c.email}` : c.phone ? ` · ${c.phone}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedCustomer && (
              <p className="text-xs text-muted-foreground">
                {[selectedCustomer.email, selectedCustomer.phone, selectedCustomer.country].filter(Boolean).join(" · ") || "Sin datos de contacto"}
              </p>
            )}
          </div>

          {/* sale attribution */}
          <div className="tf-card grid gap-3 p-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Canal</Label>
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {optionsFrom(CHANNEL).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Vendedor</Label>
              <Select value={sellerId || "__none"} onValueChange={(v) => setSellerId(v === "__none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Venta directa" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Venta directa</SelectItem>
                  {(ctx?.sellers || []).map((s) => <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Partner</Label>
              <Select value={partnerId || "__none"} onValueChange={(v) => setPartnerId(v === "__none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Venta propia" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Venta propia</SelectItem>
                  {(ctx?.partners || []).map((p) => <SelectItem key={p._id} value={p._id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Sucursal</Label>
              <Select value={branchId || "__none"} onValueChange={(v) => setBranchId(v === "__none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Sin sucursal" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Sin sucursal</SelectItem>
                  {(ctx?.branches || []).map((b) => <SelectItem key={b._id} value={b._id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* items */}
          <div className="space-y-3">
            <h2 className="font-display text-base font-semibold">
              Excursiones en la venta {cart.length > 0 && <span className="text-muted-foreground">({cart.length})</span>}
            </h2>

            {cart.length === 0 ? (
              <div className="tf-card p-2">
                <EmptyState icon="ShoppingCart" title="La venta está vacía"
                  description="Añade excursiones desde el catálogo para empezar." />
              </div>
            ) : (
              cart.map((item, idx) => {
                const line = quote?.lines[idx];
                const departure = item.product.departures.find((d) => d._id === item.departure_id);
                const pax = item.adults + item.children + item.infants;
                const noSeats = departure && pax > (departure.available_pax ?? 0);
                return (
                  <article key={item.uid} className="tf-card space-y-3 p-4">
                    <header className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-display text-sm font-semibold">{item.product.name}</p>
                        <p className="text-xs text-muted-foreground">{item.product.meeting_point || item.product.location || ""}</p>
                      </div>
                      <Button variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive"
                        onClick={() => removeItem(item.uid)} aria-label="Quitar de la venta">
                        <Icon name="Trash2" className="size-3.5" />
                      </Button>
                    </header>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Salida</Label>
                        <Select value={item.departure_id} onValueChange={(v) => patchItem(item.uid, { departure_id: v })}>
                          <SelectTrigger><SelectValue placeholder="Selecciona la salida" /></SelectTrigger>
                          <SelectContent>
                            {item.product.departures.map((d) => (
                              <SelectItem key={d._id} value={d._id}>
                                {formatDate(d.departure_at)} · {formatTime(d.departure_at)} · {d.available_pax} libres
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Modalidad</Label>
                        <Select value={item.modality_id || "__none"}
                          onValueChange={(v) => patchItem(item.uid, { modality_id: v === "__none" ? "" : v })}>
                          <SelectTrigger><SelectValue placeholder="Precio base" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">Precio base</SelectItem>
                            {item.product.modalities.map((m) => (
                              <SelectItem key={m._id} value={m._id}>
                                {m.name || MODALITY_TYPE[m.modality_type || ""]?.label || "Modalidad"}
                                {m.price ? ` · ${formatMoney(m.price, item.product.currency)}` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-2">
                      <Counter label="Adultos" value={item.adults} onChange={(v) => patchItem(item.uid, { adults: v })} />
                      <Counter label="Niños" value={item.children} onChange={(v) => patchItem(item.uid, { children: v })} />
                      <Counter label="Infantes" value={item.infants} onChange={(v) => patchItem(item.uid, { infants: v })} />
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Dto. %</Label>
                        <Input type="number" min={0} max={100} value={item.discount_pct} className="h-9 text-center"
                          onChange={(e) => patchItem(item.uid, { discount_pct: Number(e.target.value) || 0 })} />
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Hotel de recogida</Label>
                        <Select value={item.pickup_hotel_id || "__none"}
                          onValueChange={(v) => patchItem(item.uid, { pickup_hotel_id: v === "__none" ? "" : v })}>
                          <SelectTrigger><SelectValue placeholder="Sin recogida" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">Sin recogida</SelectItem>
                            {(ctx?.hotels || []).map((h) => (
                              <SelectItem key={h._id} value={h._id}>{h.name}{h.zone ? ` · ${h.zone}` : ""}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Habitación</Label>
                        <Input value={item.room_number} onChange={(e) => patchItem(item.uid, { room_number: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Hora de recogida</Label>
                        <Input value={item.pickup_time} placeholder="07:30"
                          onChange={(e) => patchItem(item.uid, { pickup_time: e.target.value })} />
                      </div>
                    </div>

                    {noSeats && (
                      <p className="flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
                        <Icon name="TriangleAlert" className="size-3.5 shrink-0" />
                        Solo quedan {departure?.available_pax ?? 0} plazas para {pax} pasajeros.
                      </p>
                    )}

                    {line?.error ? (
                      <p className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
                        {line.error}
                      </p>
                    ) : line ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2">
                        <div className="text-xs text-muted-foreground">
                          {formatMoney(line.unit_price, line.currency)} × {line.quantity} pax de pago
                          {line.applied_rule ? ` · ${line.applied_rule}` : ""}
                          {item.infants > 0 ? ` · ${item.infants} infante${item.infants === 1 ? "" : "s"} sin coste` : ""}
                        </div>
                        <p className="font-display text-base font-semibold tabular-nums">
                          {formatMoney(line.total_amount, line.currency)}
                        </p>
                      </div>
                    ) : null}
                  </article>
                );
              })
            )}
          </div>

          {/* totals + confirm */}
          {cart.length > 0 && (
            <div className="tf-card space-y-3 p-4">
              <div className="space-y-1.5 text-sm">
                <Line label="Subtotal" value={formatMoney(quote?.totals.gross ?? 0, currency)} />
                <Line label="Descuentos" value={`− ${formatMoney(quote?.totals.discount ?? 0, currency)}`} />
                <Line label="Impuestos" value={formatMoney(quote?.totals.tax ?? 0, currency)} />
                <div className="flex items-baseline justify-between border-t border-border pt-2">
                  <span className="font-semibold">Total {quoting && <Icon name="LoaderCircle" className="ml-1 inline size-3 animate-spin" />}</span>
                  <span className="font-display text-2xl font-semibold tabular-nums">
                    {formatMoney(quote?.totals.total ?? 0, currency)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatNumber(quote?.totals.pax ?? 0)} pasajeros en {cart.length} excursion{cart.length === 1 ? "" : "es"}
                </p>
              </div>

              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Notas de la venta (opcional)" />

              {overCapacity && (
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
                  <Checkbox checked={override} onCheckedChange={(v) => setOverride(!!v)} className="mt-0.5" />
                  <span className="text-[13px] text-amber-900 dark:text-amber-100">
                    Exceder el cupo disponible. Requiere permisos de gerencia y queda registrado en la auditoría.
                  </span>
                </label>
              )}
              {override && (
                <Input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Motivo de la autorización" />
              )}

              <Button className="w-full gap-1.5" size="lg" onClick={confirmSale}
                disabled={busy || quoting || hasBlockingError || !customerId}>
                <Icon name="Check" className="size-4" />
                {busy ? "Registrando…" : `Confirmar venta · ${formatMoney(quote?.totals.total ?? 0, currency)}`}
              </Button>
              {!customerId && <p className="text-center text-xs text-muted-foreground">Selecciona un cliente para continuar.</p>}
            </div>
          )}
        </section>
      </div>

      {/* ---- quick customer --------------------------------------------- */}
      <Dialog open={newCustomerOpen} onOpenChange={setNewCustomerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo cliente</DialogTitle>
            <DialogDescription>Solo el nombre es obligatorio: puedes completar la ficha más tarde.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Nombre</Label>
              <Input value={newCustomer.first_name} autoFocus
                onChange={(e) => setNewCustomer((c) => ({ ...c, first_name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Apellidos</Label>
              <Input value={newCustomer.last_name}
                onChange={(e) => setNewCustomer((c) => ({ ...c, last_name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={newCustomer.email}
                onChange={(e) => setNewCustomer((c) => ({ ...c, email: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Teléfono</Label>
              <Input value={newCustomer.phone}
                onChange={(e) => setNewCustomer((c) => ({ ...c, phone: e.target.value }))} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>País</Label>
              <Input value={newCustomer.country}
                onChange={(e) => setNewCustomer((c) => ({ ...c, country: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewCustomerOpen(false)}>Cancelar</Button>
            <Button onClick={createCustomer} disabled={busy}>{busy ? "Creando…" : "Crear cliente"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- collect right after the sale -------------------------------- */}
      <Dialog open={!!payFor} onOpenChange={(v) => !v && setPayFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Venta {payFor?.order?.order_number} registrada</DialogTitle>
            <DialogDescription>
              Se han creado {payFor?.bookings?.length ?? 0} reserva{(payFor?.bookings?.length ?? 0) === 1 ? "" : "s"} con
              su voucher. Puedes cobrar ahora o dejarlo pendiente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <ul className="tf-card divide-y divide-border">
              {(payFor?.bookings || []).map((b: any) => (
                <li key={b._id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="font-mono text-[12px] font-semibold">{b.booking_number}</p>
                    <p className="text-xs text-muted-foreground">Voucher {b.voucher_code}</p>
                  </div>
                  <span className="font-semibold tabular-nums">{formatMoney(b.total_amount ?? 0, b.currency)}</span>
                </li>
              ))}
            </ul>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Importe a cobrar</Label>
                <Input type="number" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Método</Label>
                <Select value={payMethod} onValueChange={setPayMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {optionsFrom(PAYMENT_METHOD).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPayFor(null); setCustomerId(""); }}>Cobrar más tarde</Button>
            <Button onClick={registerPayment} disabled={busy}>{busy ? "Cobrando…" : "Cobrar ahora"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Counter({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      <div className="flex items-center rounded-lg border border-border">
        <button type="button" aria-label={`Menos ${label}`}
          className="grid size-8 place-items-center text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => onChange(Math.max(0, value - 1))}>
          <Icon name="Minus" className="size-3.5" />
        </button>
        <span className="flex-1 text-center text-sm font-semibold tabular-nums">{value}</span>
        <button type="button" aria-label={`Más ${label}`}
          className="grid size-8 place-items-center text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => onChange(value + 1)}>
          <Icon name="Plus" className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
