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
import { MembegoBenefits } from "./_components/membego-benefits";
import { plazasDeProducto, plazasLibres } from "@/lib/plazas";

interface CatalogDeparture {
  _id: string; departure_at?: string; capacity: number;
  /** null = nadie ha calculado el cupo todavía. NO es agotado. */
  available_pax: number | null; status?: string;
}
interface CatalogModality {
  _id: string; name?: string; modality_type?: string; price?: number; min_pax?: number; max_pax?: number;
}
interface CatalogExtra {
  _id: string; name?: string; description?: string;
  price_type?: string; price: number; currency?: string;
  is_required: boolean; max_quantity?: number | null;
}
interface CatalogProduct {
  _id: string; name?: string; code?: string; product_type?: string; short_description?: string;
  cover_image_url?: string; location?: string; duration_hours?: number;
  base_price: number; currency: string; category?: string; meeting_point?: string;
  modalities: CatalogModality[];
  extras: CatalogExtra[];
  departures: CatalogDeparture[];
}
interface PosContext {
  currency: string; role: string;
  catalog: CatalogProduct[];
  bundles: CatalogBundle[];
  hotels: { _id: string; name?: string; zone?: string }[];
  sellers: { _id: string; name: string; partner?: string | null }[];
  /** La ficha de quien vende, cuando el servidor va a sellar la venta a su nombre. */
  own_seller_id?: string | null;
  seller_locked?: boolean;
  partners: { _id: string; name: string }[];
  branches: { _id: string; name?: string }[];
  cash_session: { _id: string; code?: string; register?: string } | null;
}

/**
 * UN PAQUETE EN EL PUNTO DE VENTA.
 *
 * No tiene salida propia: la tienen sus actividades. Por eso la tarjeta no
 * enseña «próxima salida» ni «plazas», y para añadirlo hace falta primero el
 * día en que empieza — que es lo que el servidor necesita para armar el
 * itinerario con salidas reales.
 */
interface CatalogBundle {
  _id: string;
  name: string;
  code?: string | null;
  base_price: number;
  currency: string;
  category?: string;
  cover_image_url?: string | null;
  activities: { itemId: string; name: string; dayOffset: number; isOptional: boolean }[];
}

/** Un bloque del itinerario que devuelve `/api/bundles`. */
interface BundleBlock {
  itemId: string;
  productName: string;
  departureId: string;
  day: string;
  at: string;
  seatsLeft: number | null;
}

interface BundlePlan {
  bundleId: string;
  bundleName: string;
  startDay: string;
  blocks: BundleBlock[];
  unresolved: { itemId: string; productName: string; reason: string }[];
  blocker: string | null;
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
  /** Extras escogidos: id -> cantidad. Los obligatorios los añade el servidor. */
  extras: Record<string, number>;
  /** Solo en los paquetes: el día en que empieza y el itinerario que sale. */
  bundle_start_day?: string;
  bundle_plan?: BundlePlan | null;
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

  /**
   * La lista de espera, ofrecida en el instante en que la venta no cabe.
   *
   * Es el único momento en que sirve: el cliente está delante del mostrador. Si
   * apuntarlo exige salir del punto de venta, buscar la salida y abrir otra
   * pantalla, el vendedor le dice «lo siento, está lleno» y el cliente se va.
   */
  const [waitlistFor, setWaitlistFor] = useState<{ departureId: string; product: string; pax: number } | null>(null);
  const [waitlistContact, setWaitlistContact] = useState({ name: "", phone: "", notes: "" });

  // quick customer creation
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ first_name: "", last_name: "", email: "", phone: "", country: "" });

  // payment right after the sale
  const [payFor, setPayFor] = useState<{ order: any; bookings: any[] } | null>(null);
  /** El total después de aplicar un beneficio de MembeGo, si se aplicó alguno. */
  const [benefitTotal, setBenefitTotal] = useState<number | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("cash");
  const [payReceived, setPayReceived] = useState(""); // efectivo entregado, solo para calcular el cambio

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

  /**
   * LOS VENDEDORES QUE ENCAJAN CON EL SOCIO ELEGIDO.
   *
   * Los dos desplegables eran independientes: se podía registrar la venta del
   * tour center A atribuida a un vendedor del B, y detrás del vendedor va la
   * comisión. El servidor lo rechaza desde esta entrega; esto es para que la
   * pantalla no llegue a ofrecerlo, que es distinto de impedirlo.
   *
   * El vendedor de la casa aparece SIEMPRE, también con un socio elegido: el
   * conserje trae al cliente y el vendedor del mostrador remata, y el motor de
   * comisiones reparte las dos. Lo que no aparece nunca es el de otro socio.
   */
  const vendedoresDisponibles = useMemo(() => {
    const todos = ctx?.sellers || [];
    return todos.filter((s) => !s.partner || s.partner === partnerId);
  }, [ctx?.sellers, partnerId]);

  /**
   * Y si el vendedor elegido deja de encajar al cambiar de socio, se suelta.
   *
   * Sin esto queda seleccionado un valor que el desplegable ya no enseña —el
   * control queda en blanco con un identificador dentro— y la venta se manda
   * con él. Es la forma más silenciosa de que la comprobación del servidor
   * salte con un mensaje que quien vende no sabe de dónde sale.
   */
  useEffect(() => {
    if (!sellerId) return;
    if (!vendedoresDisponibles.some((s) => s._id === sellerId)) setSellerId("");
  }, [vendedoresDisponibles, sellerId]);

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

  /**
   * EL PAQUETE SE ARMA ANTES DE AÑADIRLO.
   *
   * Un paquete no se puede meter en la venta «y ya veremos»: si una de sus
   * actividades no tiene salida con plazas, lo que se habría vendido es un
   * precio cerrado por algo que el cliente no va a recibir entero.
   *
   * Así que primero se pide el día, el servidor arma el itinerario con salidas
   * REALES, se le enseña al cajero —qué actividad, qué día, a qué hora— y solo
   * si no hay nada que lo bloquee se deja añadir.
   */
  const [bundleFor, setBundleFor] = useState<CatalogBundle | null>(null);
  const [bundleDay, setBundleDay] = useState("");
  const [bundlePax, setBundlePax] = useState(1);
  const [bundlePlan, setBundlePlan] = useState<BundlePlan | null>(null);
  const [bundleBusy, setBundleBusy] = useState(false);
  const [bundleError, setBundleError] = useState<string | null>(null);

  const planBundleFor = useCallback(async (bundle: CatalogBundle, day: string, pax: number) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { setBundlePlan(null); return; }
    setBundleBusy(true);
    setBundleError(null);
    const res = await api.get<BundlePlan>(
      `/api/bundles?bundle=${encodeURIComponent(bundle._id)}&day=${day}&pax=${Math.max(1, pax)}`
    );
    setBundleBusy(false);
    if (!res.ok) {
      setBundlePlan(null);
      setBundleError(res.error?.message || "No se pudo armar el itinerario");
      return;
    }
    setBundlePlan(res.data ?? null);
  }, []);

  const abrirPaquete = (bundle: CatalogBundle) => {
    const hoy = toDateInput(new Date());
    setBundleFor(bundle);
    setBundleDay(hoy);
    setBundlePax(1);
    setBundlePlan(null);
    setBundleError(null);
    void planBundleFor(bundle, hoy, 1);
  };

  const addBundleToCart = () => {
    if (!bundleFor || !bundlePlan || bundlePlan.blocker) return;
    setCart((c) => [...c, {
      uid: nextUid(),
      // El paquete viaja como producto: el servidor lo expande en cabecera +
      // componentes. Sin salida ni modalidad propias, que las ponen sus
      // actividades.
      product: {
        _id: bundleFor._id, name: bundleFor.name, code: bundleFor.code ?? undefined,
        base_price: bundleFor.base_price, currency: bundleFor.currency,
        category: bundleFor.category, modalities: [], extras: [], departures: [],
      } as unknown as CatalogProduct,
      departure_id: "", modality_id: "",
      adults: bundlePax, children: 0, infants: 0,
      extras: {}, discount_pct: 0,
      pickup_hotel_id: "", room_number: "", pickup_time: "", notes: "",
      bundle_start_day: bundlePlan.startDay,
      bundle_plan: bundlePlan,
    }]);
    toast.success(`${bundleFor.name} añadido a la venta`);
    setBundleFor(null);
  };

  const addToCart = (product: CatalogProduct) => {
    const modality = product.modalities.find((m) => m.modality_type === "adult") || product.modalities[0];
    const departure = product.departures.find((d) => (plazasLibres(d) ?? 1) > 0) || product.departures[0];
    setCart((c) => [...c, {
      uid: nextUid(),
      product,
      departure_id: departure?._id || "",
      modality_id: modality?._id || "",
      adults: 1, children: 0, infants: 0,
      extras: {},
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
        // Sin esto el servidor rechaza el paquete con «Falta el día en que
        // empieza»: es el dato del que cuelga todo el itinerario.
        bundle_start_day: i.bundle_start_day || null,
        // Los obligatorios los añade el servidor: aquí solo viaja lo que el
        // cliente escogió, para que retirar un extra del catálogo no deje
        // vendiéndose algo que ya no existe.
        extras: Object.entries(i.extras)
          .filter(([, quantity]) => quantity > 0)
          .map(([extra_id, quantity]) => ({ extra_id, quantity })),
      })),
    });
    setBusy(false);

    if (!res.ok) {
      console.error("[pos] error creando la venta:", res.error);
      toast.error(res.error?.message || "No se pudo registrar la venta");

      /**
       * Un cupo agotado NO es un fallo: es un cliente que se puede recuperar.
       *
       * El servidor ya distinguía este caso con el código `OVERSELL` desde la
       * ola 4, y lo único que se hacía con él era pintar el mismo mensaje rojo
       * que con cualquier otro error. Aquí se convierte en la única acción que
       * tiene sentido con el cliente delante.
       */
      if (res.code === "OVERSELL") {
        const linea = cart.find((i) => i.departure_id) ?? cart[0];
        const cliente = customers.find((c) => c._id === customerId);
        setWaitlistContact({
          name: cliente ? [cliente.first_name, cliente.last_name].filter(Boolean).join(" ") : "",
          phone: cliente?.phone || cliente?.whatsapp || "",
          notes: "",
        });
        setWaitlistFor({
          departureId: linea?.departure_id || "",
          product: linea?.product.name || "la salida",
          pax: (linea?.adults ?? 0) + (linea?.children ?? 0) + (linea?.infants ?? 0),
        });
      }
      return;
    }

    const { order, bookings = [], commissionsCreated = 0 } = res.data || {};
    toast.success(`Venta ${order?.order_number} registrada · ${bookings.length} reserva${bookings.length === 1 ? "" : "s"}${
      commissionsCreated > 0 ? ` · ${commissionsCreated} comisiones` : ""}`);

    setPayFor({ order, bookings });
    setBenefitTotal(null);
    setPayAmount(String(order?.total ?? quote?.totals.total ?? ""));
    // Sin caja abierta el efectivo se rechaza en el servidor: arranca en tarjeta.
    setPayMethod(ctx?.cash_session ? "cash" : "card");
    setPayReceived("");
    setCart([]);
    setQuote(null);
    setNotes("");
    setOverride(false);
    setOverrideReason("");
    loadContext();
  };

  const joinWaitlist = async () => {
    if (!waitlistFor) return;
    setBusy(true);
    const res = await api.post("/api/waitlist", {
      departure_id: waitlistFor.departureId,
      pax: waitlistFor.pax,
      customer_id: customerId || null,
      contact_name: waitlistContact.name.trim() || null,
      contact_phone: waitlistContact.phone.trim() || null,
      seller_id: sellerId || null,
      partner_id: partnerId || null,
      notes: waitlistContact.notes.trim() || null,
    });
    setBusy(false);
    if (!res.ok) {
      console.error("[pos] error apuntando en la lista de espera:", res.error);
      toast.error(res.error?.message || "No se pudo apuntar en la lista de espera");
      return;
    }
    toast.success(
      `${waitlistFor.pax} pax en lista de espera de ${waitlistFor.product}. ` +
      `Si alguien cancela, la plaza se le aparta automáticamente.`
    );
    setWaitlistFor(null);
  };

  const registerPayment = async () => {
    if (!payFor) return;
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) { toast.error("El importe debe ser mayor que cero"); return; }
    if (payMethod === "cash" && !ctx?.cash_session) {
      toast.error("Abre una caja para cobrar en efectivo, o elige otro método");
      return;
    }
    setBusy(true);
    const res = await api.post<{
      factura?: { id: string; ncf: string | null } | null;
      factura_error?: string | null;
    }>("/api/payments", {
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

    /**
     * El NCF se enseña EN EL ACTO, con el botón para imprimirlo.
     *
     * Es el momento en que el cliente está delante. Decir solo «cobro
     * registrado» obliga al cajero a irse a buscar la factura a otra pantalla
     * mientras el cliente espera, y en la práctica eso significa que no se
     * entrega.
     *
     * Y si la factura NO salió —secuencia de NCF agotada, perfil fiscal sin
     * configurar—, se dice con todas las letras. El cobro está registrado; lo
     * que falta es el comprobante, y quien está en el mostrador es el único que
     * puede resolverlo antes de que el cliente se vaya.
     */
    const factura = res.data?.factura;
    if (factura) {
      toast.success(`Cobro registrado · Factura ${factura.ncf ?? ""}`.trim(), {
        duration: 10_000,
        action: {
          label: "Imprimir",
          onClick: () => window.open(`/api/invoices/${factura.id}/pdf`, "_blank"),
        },
      });
    } else if (res.data?.factura_error) {
      toast.warning("Cobro registrado, pero la factura no salió", {
        description: res.data.factura_error,
        duration: 12_000,
      });
    } else {
      toast.success("Cobro registrado");
    }
    setPayFor(null);
    setBenefitTotal(null);
    setPayReceived("");
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
    const libres = plazasLibres(dep);
    return libres !== null && i.adults + i.children + i.infants > libres;
  });

  // Ayudas del cobro tras la venta.
  const canPayCash = Boolean(ctx?.cash_session);
  // El beneficio de MembeGo rebaja la venta DESPUÉS de crearla, así que el
  // importe a cobrar no puede quedarse con el total del momento de la venta: el
  // cajero cobraría de más un descuento que sí se aplicó.
  const orderTotal = benefitTotal ?? Number(payFor?.order?.total ?? 0);
  const payAmountNum = Number(payAmount) || 0;
  const receivedNum = Number(payReceived) || 0;
  const cashChange = payMethod === "cash" && receivedNum > payAmountNum ? receivedNum - payAmountNum : 0;
  const pendingAfter = orderTotal > 0 && payAmountNum > 0 && payAmountNum < orderTotal ? orderTotal - payAmountNum : 0;

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

          {(ctx?.bundles?.length ?? 0) > 0 && (
            <section className="no-print mb-4 space-y-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Paquetes
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {(ctx?.bundles ?? []).map((b) => (
                  <article key={b._id} className="tf-card tf-rise flex flex-col overflow-hidden border-primary/30">
                    <div className="flex flex-1 flex-col gap-2 p-4">
                      <div>
                        <p className="font-display text-sm font-semibold leading-tight">{b.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {b.activities.length} actividad(es)
                          {b.category ? ` · ${b.category}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Pill tone="accent" className="tf-num">{formatMoney(b.base_price, b.currency)}</Pill>
                        <Pill tone="violet">Paquete</Pill>
                      </div>
                      {/* Qué lleva, sin pedir todavía la fecha: el cajero tiene
                          que poder decírselo al cliente antes de comprometerse. */}
                      <ul className="space-y-0.5 text-xs text-muted-foreground">
                        {b.activities.slice(0, 4).map((a) => (
                          <li key={a.itemId}>
                            Día {a.dayOffset + 1} · {a.name}{a.isOptional ? " (opcional)" : ""}
                          </li>
                        ))}
                      </ul>
                      <Button size="sm" variant="outline" className="mt-auto gap-1.5"
                        onClick={() => abrirPaquete(b)}>
                        <Icon name="CalendarRange" className="size-4" />Armar itinerario
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

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
                const cupo = plazasDeProducto(p.departures);
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
                        <Pill tone="accent" className="tf-num">{formatMoney(p.base_price, p.currency)}</Pill>
                        {p.modalities.length > 0 && <Pill tone="neutral">{p.modalities.length} modalidades</Pill>}
                        {/* Agotado y «no se sabe» son dos cosas distintas, y pintarlas
                            igual —rojo, 0 plazas— hace que el catálogo entero parezca
                            vendido cuando solo falta calcular la caché. */}
                        {cupo.desconocido ? (
                          <Pill tone="neutral">Cupo sin calcular</Pill>
                        ) : (
                          <Pill tone={cupo.libres > 0 ? "success" : "danger"} className="tf-num">
                            {formatNumber(cupo.libres)} {cupo.libres === 1 ? "plaza" : "plazas"}
                          </Pill>
                        )}
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
              {/*
                * Quien vende no elige de quién es su venta: el servidor la
                * sella a su nombre. El desplegable se queda fijo para que la
                * pantalla no ofrezca algo que la API va a ignorar —ofrecer una
                * opción que no se cumple es peor que no ofrecerla—.
                */}
              {ctx?.seller_locked ? (
                <div className="flex h-9 items-center rounded-md border border-input bg-muted/50 px-3 text-sm">
                  {ctx.sellers?.[0]?.name || "Sin ficha vinculada"}
                </div>
              ) : (
                <Select value={sellerId || "__none"} onValueChange={(v) => setSellerId(v === "__none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Venta directa" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Venta directa</SelectItem>
                    {vendedoresDisponibles.map((s) => <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
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
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-base font-semibold">
                Excursiones en la venta {cart.length > 0 && <span className="text-muted-foreground">({cart.length})</span>}
              </h2>
              {cart.length > 0 && (
                <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground"
                  onClick={() => { setCart([]); setQuote(null); }}>
                  <Icon name="Trash2" className="size-3.5" /> Vaciar
                </Button>
              )}
            </div>

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
                const libresSel = departure ? plazasLibres(departure) : null;
                const noSeats = libresSel !== null && pax > libresSel;
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

                    {/* UN PAQUETE NO ELIGE SALIDA NI MODALIDAD: las eligen sus
                        actividades, y ya se decidieron al armar el itinerario.
                        Enseñar aquí dos desplegables vacíos invitaría a tocar
                        algo que no aplica. Se enseña el itinerario, que es lo
                        que el cajero necesita repasar con el cliente. */}
                    {item.bundle_plan ? (
                      <div className="space-y-1.5">
                        <Label className="text-xs">Itinerario</Label>
                        <ul className="divide-y divide-border rounded-md border border-border text-[12.5px]">
                          {item.bundle_plan.blocks.map((b) => (
                            <li key={b.itemId} className="flex items-center justify-between gap-2 px-3 py-1.5">
                              <span className="min-w-0 truncate">{b.productName}</span>
                              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                {formatDate(b.at)} · {formatTime(b.at)}
                              </span>
                            </li>
                          ))}
                        </ul>
                        <p className="text-[11px] text-muted-foreground">
                          Para cambiar el día o los pasajeros, quita el paquete y vuelve a armarlo.
                        </p>
                      </div>
                    ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="min-w-0 space-y-1.5">
                        <Label className="text-xs">Salida</Label>
                        <Select value={item.departure_id} onValueChange={(v) => patchItem(item.uid, { departure_id: v })}>
                          <SelectTrigger><SelectValue placeholder="Selecciona la salida" /></SelectTrigger>
                          <SelectContent>
                            {item.product.departures.map((d) => (
                              <SelectItem key={d._id} value={d._id}>
                                {formatDate(d.departure_at)} · {formatTime(d.departure_at)} · {plazasLibres(d) === null ? "cupo sin calcular" : `${plazasLibres(d)} libres`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="min-w-0 space-y-1.5">
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
                    )}

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

                    {item.product.extras?.length > 0 && (
                      <div className="space-y-1.5">
                        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Extras
                        </Label>
                        <ul className="divide-y divide-border rounded-md border border-border">
                          {item.product.extras.map((extra) => {
                            const chosen = item.extras[extra._id] ?? 0;
                            const perPerson = extra.price_type !== "per_booking";
                            return (
                              <li key={extra._id} className="flex items-center justify-between gap-3 px-3 py-2">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">
                                    {extra.name}
                                    {extra.is_required && (
                                      <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                                        obligatorio
                                      </span>
                                    )}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {formatMoney(extra.price, extra.currency || ctx?.currency)}
                                    {perPerson ? " por persona" : " por reserva"}
                                    {extra.description ? ` · ${extra.description}` : ""}
                                  </p>
                                </div>
                                {extra.is_required ? (
                                  // Una tasa no se marca ni se desmarca: se cobra.
                                  <span className="shrink-0 text-xs font-semibold text-muted-foreground">
                                    Incluido
                                  </span>
                                ) : (
                                  <Counter
                                    label=""
                                    srLabel={extra.name}
                                    value={chosen}
                                    onChange={(v) => patchItem(item.uid, {
                                      extras: { ...item.extras, [extra._id]: Math.max(v, 0) },
                                    })}
                                  />
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}

                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="min-w-0 space-y-1.5">
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
                      <div className="min-w-0 space-y-1.5">
                        <Label className="text-xs">Habitación</Label>
                        <Input value={item.room_number} onChange={(e) => patchItem(item.uid, { room_number: e.target.value })} />
                      </div>
                      <div className="min-w-0 space-y-1.5">
                        <Label className="text-xs">Hora de recogida</Label>
                        <Input value={item.pickup_time} placeholder="07:30"
                          onChange={(e) => patchItem(item.uid, { pickup_time: e.target.value })} />
                      </div>
                    </div>

                    {noSeats && (
                      <p className="flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
                        <Icon name="TriangleAlert" className="size-3.5 shrink-0" />
                        Solo {libresSel === 1 ? "queda 1 plaza" : `quedan ${libresSel ?? 0} plazas`} para {pax} {pax === 1 ? "pasajero" : "pasajeros"}.
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
                        <p className="tf-num text-base">
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
                  <span className="tf-num text-2xl">
                    {formatMoney(quote?.totals.total ?? 0, currency)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {/* Concordancia de verdad: «1 pasajeros en 1 excursion» se lee como
                      un descuido, y en la pantalla donde se cobra eso resta confianza. */}
                  {formatNumber(quote?.totals.pax ?? 0)}{" "}
                  {(quote?.totals.pax ?? 0) === 1 ? "pasajero" : "pasajeros"} en {cart.length}{" "}
                  {cart.length === 1 ? "excursión" : "excursiones"}
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
      {/* ───────────────────────────────────────────────────────────────────
          ARMAR EL PAQUETE ANTES DE VENDERLO

          El cajero ve el itinerario REAL —qué actividad, qué día, a qué hora,
          cuántas plazas quedan— antes de comprometer al cliente. Y si alguna
          actividad no tiene salida servible, el botón no deja añadirlo: un
          paquete a medias es un precio cerrado por algo que no se va a
          entregar entero.
      ─────────────────────────────────────────────────────────────────── */}
      <Dialog open={!!bundleFor} onOpenChange={(o) => { if (!o) setBundleFor(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{bundleFor?.name}</DialogTitle>
            <DialogDescription>
              Elige el día en que empieza y cuántos van. El itinerario se arma con las salidas reales.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-0 flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Empieza el
              <Input
                type="date" className="h-9 w-[160px]" value={bundleDay}
                onChange={(e) => {
                  setBundleDay(e.target.value);
                  if (bundleFor) void planBundleFor(bundleFor, e.target.value, bundlePax);
                }}
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Pasajeros
              <Input
                type="number" min={1} className="h-9 w-[90px] text-center" value={bundlePax}
                onChange={(e) => {
                  const n = Math.max(1, Number(e.target.value) || 1);
                  setBundlePax(n);
                  if (bundleFor) void planBundleFor(bundleFor, bundleDay, n);
                }}
              />
            </label>
            <p className="text-sm font-semibold tabular-nums">
              {formatMoney((bundleFor?.base_price ?? 0) * bundlePax, bundleFor?.currency)}
            </p>
          </div>

          {bundleBusy ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Buscando salidas…</p>
          ) : bundleError ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{bundleError}</p>
          ) : bundlePlan ? (
            <div className="space-y-2">
              {bundlePlan.blocks.length > 0 && (
                <ul className="divide-y divide-border rounded-md border border-border text-[13px]">
                  {bundlePlan.blocks.map((b) => (
                    <li key={b.itemId} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="min-w-0">
                        <span className="block font-medium">{b.productName}</span>
                        <span className="block text-xs text-muted-foreground tabular-nums">
                          {formatDate(b.at)} · {formatTime(b.at)}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {b.seatsLeft === null ? "cupo sin calcular" : `${formatNumber(b.seatsLeft)} libres`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {/* Lo que impide venderlo, dicho con nombre y apellido. «No se
                  pudo» obliga a adivinar; esto dice qué actividad y por qué. */}
              {bundlePlan.blocker && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-[13px]">
                  <p className="font-semibold">{bundlePlan.blocker}</p>
                  {bundlePlan.unresolved.length > 0 && (
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">
                      {bundlePlan.unresolved.map((u) => (
                        <li key={u.itemId}>{u.productName}: {u.reason}</li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-1 text-xs">Prueba con otro día de inicio o con menos pasajeros.</p>
                </div>
              )}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setBundleFor(null)}>Cancelar</Button>
            <Button
              disabled={!bundlePlan || !!bundlePlan.blocker || bundleBusy}
              onClick={addBundleToCart}
            >
              Añadir a la venta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                  <span className="tf-num">{formatMoney(b.total_amount ?? 0, b.currency)}</span>
                </li>
              ))}
            </ul>

            {/* El canje va aquí y no en el carrito: un beneficio se consume
                contra una venta que existe, no contra algo que puede
                abandonarse — y ese uso no vuelve solo. */}
            {payFor?.order?._id && customerId && (
              <MembegoBenefits
                orderId={String(payFor.order._id)}
                customerId={customerId}
                currency={String(payFor.order.currency || currency)}
                lines={(payFor.bookings || []).map((b: any) => ({
                  id: String(b._id),
                  label: String(b.product?.name || b.booking_number || "Excursión"),
                  total: Number(b.total_amount ?? 0),
                }))}
                onApplied={(nuevoTotal) => {
                  setBenefitTotal(nuevoTotal);
                  setPayAmount(String(nuevoTotal));
                }}
              />
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Importe a cobrar</Label>
                  {orderTotal > 0 && payAmountNum !== orderTotal && (
                    <button type="button" className="text-xs font-semibold text-primary hover:underline"
                      onClick={() => setPayAmount(String(orderTotal))}>
                      Total exacto ({formatMoney(orderTotal, payFor?.order?.currency || currency)})
                    </button>
                  )}
                </div>
                <Input type="number" step="0.01" min="0" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Método</Label>
                <Select value={payMethod} onValueChange={setPayMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {optionsFrom(PAYMENT_METHOD).map((o) => (
                      <SelectItem key={o.value} value={o.value} disabled={o.value === "cash" && !canPayCash}>
                        {o.label}{o.value === "cash" && !canPayCash ? " · sin caja" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Cambio en efectivo: el "recibido" es solo para calcular la vuelta. */}
              {payMethod === "cash" && (
                <div className="space-y-1.5">
                  <Label>Efectivo recibido</Label>
                  <Input type="number" step="0.01" min="0" value={payReceived} placeholder="0.00"
                    onChange={(e) => setPayReceived(e.target.value)} />
                </div>
              )}
              {payMethod === "cash" && (
                <div className="flex items-end">
                  <div className="w-full rounded-lg bg-muted/50 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Cambio</span>
                    <span className="tf-num float-right font-semibold">
                      {formatMoney(cashChange, payFor?.order?.currency || currency)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {pendingAfter > 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                Cobro parcial: quedará un saldo pendiente de {formatMoney(pendingAfter, payFor?.order?.currency || currency)}.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPayFor(null); setCustomerId(""); }}>Cobrar más tarde</Button>
            <Button onClick={registerPayment} disabled={busy || (payMethod === "cash" && !canPayCash)}>
              {busy ? "Cobrando…" : "Cobrar ahora"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- lista de espera cuando la salida está llena ------------------ */}
      <Dialog open={!!waitlistFor} onOpenChange={(v) => !v && setWaitlistFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apuntar en la lista de espera</DialogTitle>
            <DialogDescription>
              {waitlistFor
                ? `${waitlistFor.product} está llena. Si alguien cancela, la plaza se aparta automáticamente a nombre de este cliente y se avisa al mostrador para llamarle.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <Line label="Personas" value={String(waitlistFor?.pax ?? 0)} />
              <Line label="Se le guarda" value="24 h, y nunca más allá de la salida" />
            </div>
            <div className="space-y-1.5">
              <Label>Nombre</Label>
              <Input value={waitlistContact.name}
                onChange={(e) => setWaitlistContact((c) => ({ ...c, name: e.target.value }))}
                placeholder="Michael Brennan" />
            </div>
            <div className="space-y-1.5">
              <Label>Teléfono o WhatsApp</Label>
              <Input value={waitlistContact.phone}
                onChange={(e) => setWaitlistContact((c) => ({ ...c, phone: e.target.value }))}
                placeholder="+1 809 555 0101" />
              {/* Se dice por qué hace falta, en vez de dejar que el guardado
                  falle con un mensaje que no lo explica. */}
              <p className="text-xs text-muted-foreground">
                {customerId
                  ? "Opcional: ya hay ficha de cliente y se usará su teléfono."
                  : "Sin cliente seleccionado hace falta un teléfono: es por donde se le avisará."}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Notas</Label>
              <Input value={waitlistContact.notes}
                onChange={(e) => setWaitlistContact((c) => ({ ...c, notes: e.target.value }))}
                placeholder="Se aloja en el Barceló, llega el jueves" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWaitlistFor(null)}>Ahora no</Button>
            <Button onClick={joinWaitlist}
              disabled={busy || !waitlistFor?.departureId || (!customerId && !waitlistContact.phone.trim())}>
              {busy ? "Apuntando…" : "Apuntar en la lista"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Contador de más y menos.
 *
 * `srLabel` existe para los extras, donde el nombre ya se lee al lado y
 * repetirlo encima del contador sería ruido — pero sin él los botones se
 * anunciarían como "Menos" y "Más" a secas, que con seis extras en pantalla no
 * dice a cuál pertenecen.
 */
function Counter({ label, value, onChange, srLabel }: {
  label: string; value: number; onChange: (v: number) => void; srLabel?: string;
}) {
  const name = srLabel || label;
  return (
    <div className="space-y-1">
      {label && <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</Label>}
      <div className="flex items-center rounded-lg border border-border">
        <button type="button" aria-label={`Menos ${name}`}
          className="grid size-8 place-items-center text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => onChange(Math.max(0, value - 1))}>
          <Icon name="Minus" className="size-3.5" />
        </button>
        <span className="tf-num flex-1 text-center text-sm">{value}</span>
        <button type="button" aria-label={`Más ${name}`}
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
      <span className="tf-num font-medium">{value}</span>
    </div>
  );
}
