"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { usePortal } from "../portal-context";
import { PageHeader } from "@/components/tf/page-header";
import { EmptyState } from "@/components/tf/empty-state";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DEPARTURE_STATUS } from "@/lib/labels";
import { formatDate, formatDateTime, formatMoney, formatNumber, formatTime, toDateInput } from "@/lib/format";

interface CatalogDeparture {
  _id: string; departure_at?: string; available_pax?: number; capacity?: number; status?: string;
}

interface CatalogProduct {
  _id: string; name?: string; short_description?: string; description?: string;
  duration_hours?: number; location?: string; meeting_point?: string;
  cover_image_url?: string; images?: any; category?: string;
  modalities: { _id: string; name?: string; modality_type?: string }[];
  price: { unit_price: number; total: number; currency: string; rule?: string | null } | null;
  departures: CatalogDeparture[];
  next_departure?: string;
}

/** Free seats colour-coded so a reseller sees at a glance what they can still sell. */
function availabilityTone(available: number, capacity: number) {
  if (available <= 0) return "danger" as const;
  if (capacity > 0 && available / capacity <= 0.2) return "warning" as const;
  return "success" as const;
}

export default function PortalCatalogPage() {
  const { query } = usePortal();
  const [date, setDate] = useState("");
  const [q, setQ] = useState("");
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [restricted, setRestricted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<CatalogProduct | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.get<{ products: CatalogProduct[]; restricted: boolean }>(
      `/api/portal/catalog${query({ date: date || undefined })}`
    );
    setLoading(false);
    if (!res.ok) {
      console.error("[portal/catalogo] error cargando el catálogo:", res.error);
      toast.error(res.error?.message || "No se pudo cargar el catálogo");
      setProducts([]);
      return;
    }
    setProducts(res.data?.products || []);
    setRestricted(!!res.data?.restricted);
  }, [query, date]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return products;
    return products.filter((p) =>
      [p.name, p.category, p.location, p.short_description].filter(Boolean).join(" ").toLowerCase().includes(term)
    );
  }, [products, q]);

  const seats = (p: CatalogProduct) => p.departures.reduce((s, d) => s + (d.available_pax ?? 0), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Portal B2B"
        title="Catálogo y disponibilidad"
        description="Precios netos ya calculados para tu acuerdo comercial y plazas libres en tiempo real."
        actions={
          <>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-[170px]"
              min={toDateInput(new Date())} />
            {date && (
              <Button variant="outline" onClick={() => setDate("")} className="gap-1.5">
                <Icon name="X" className="size-4" /> Próximos 30 días
              </Button>
            )}
            <Button variant="outline" size="icon" onClick={load} aria-label="Actualizar">
              <Icon name="RefreshCw" className="size-4" />
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Icon name="Search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar excursión, zona o categoría…" className="pl-9" />
        </div>
        {restricted && <Pill tone="info"><Icon name="ShieldCheck" className="size-3" /> Catálogo autorizado para tu acuerdo</Pill>}
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[300px] rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="Ticket"
          title="No hay excursiones disponibles"
          description={date
            ? "No hay salidas programadas para la fecha elegida. Prueba con otro día."
            : "El operador todavía no ha autorizado ninguna excursión para tu cuenta."}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => {
            const free = seats(p);
            return (
              <article key={p._id} className="tf-card tf-rise flex flex-col overflow-hidden">
                <div className="relative h-40 bg-muted">
                  {p.cover_image_url ? (
                    <img src={p.cover_image_url} alt={p.name || "Excursión"} className="size-full object-cover" />
                  ) : (
                    <div className="grid size-full place-items-center text-muted-foreground">
                      <Icon name="Image" className="size-7" />
                    </div>
                  )}
                  {p.category && (
                    <span className="absolute left-3 top-3 rounded-full bg-background/90 px-2.5 py-1 text-[11px] font-semibold backdrop-blur">
                      {p.category}
                    </span>
                  )}
                  <span className="absolute right-3 top-3">
                    <Pill tone={availabilityTone(free, p.departures.reduce((s, d) => s + (d.capacity ?? 0), 0))}>
                      {free > 0 ? `${formatNumber(free)} plazas` : "Sin plazas"}
                    </Pill>
                  </span>
                </div>

                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div className="min-w-0">
                    <h3 className="font-display text-base font-semibold leading-tight">{p.name}</h3>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {p.short_description || p.description || "Sin descripción"}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    {p.duration_hours ? <Pill tone="neutral"><Icon name="Clock" className="size-3" /> {p.duration_hours} h</Pill> : null}
                    {p.location ? <Pill tone="neutral"><Icon name="MapPin" className="size-3" /> {p.location}</Pill> : null}
                    {p.next_departure ? <Pill tone="info"><Icon name="CalendarDays" className="size-3" /> {formatDate(p.next_departure)}</Pill> : null}
                  </div>

                  <div className="mt-auto flex items-end justify-between gap-3 border-t border-border pt-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Tu precio neto</p>
                      <p className="font-display text-xl font-semibold tabular-nums">
                        {p.price ? formatMoney(p.price.unit_price, p.price.currency) : "A consultar"}
                      </p>
                      {p.price?.rule && <p className="text-[11px] text-muted-foreground">Tarifa: {p.price.rule}</p>}
                    </div>
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setDetail(p)}>
                      <Icon name="CalendarRange" className="size-4" /> Salidas
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Sheet open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <SheetContent className="w-full overflow-y-auto tf-scroll sm:max-w-lg">
          {detail && (
            <>
              <SheetHeader>
                <SheetTitle className="font-display text-xl">{detail.name}</SheetTitle>
                <SheetDescription>
                  {detail.price
                    ? `Precio neto por adulto: ${formatMoney(detail.price.unit_price, detail.price.currency)}`
                    : "Precio pendiente de acordar con el operador."}
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-5 px-4 pb-8">
                {detail.cover_image_url && (
                  <img src={detail.cover_image_url} alt={detail.name || ""} className="h-44 w-full rounded-xl object-cover" />
                )}

                {(detail.description || detail.meeting_point) && (
                  <section className="space-y-2 text-sm">
                    {detail.description && <p className="text-muted-foreground">{detail.description}</p>}
                    {detail.meeting_point && (
                      <p className="flex items-start gap-2 text-xs text-muted-foreground">
                        <Icon name="MapPin" className="mt-0.5 size-3.5 shrink-0" /> Punto de encuentro: {detail.meeting_point}
                      </p>
                    )}
                  </section>
                )}

                {detail.modalities.length > 0 && (
                  <section>
                    <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Modalidades</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {detail.modalities.map((m) => <Pill key={m._id} tone="accent">{m.name}</Pill>)}
                    </div>
                  </section>
                )}

                <section>
                  <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Próximas salidas
                  </h4>
                  {detail.departures.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No hay salidas programadas en el rango consultado.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {detail.departures.map((d) => (
                        <li key={d._id} className="flex items-center justify-between gap-3 py-2.5">
                          <div>
                            <p className="text-sm font-medium">{formatDateTime(d.departure_at)}</p>
                            <p className="text-xs text-muted-foreground">Salida a las {formatTime(d.departure_at)}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Pill tone={availabilityTone(d.available_pax ?? 0, d.capacity ?? 0)}>
                              {formatNumber(d.available_pax ?? 0)}/{formatNumber(d.capacity ?? 0)}
                            </Pill>
                            <StatusBadge value={d.status} dict={DEPARTURE_STATUS} dot={false} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <p className="rounded-lg border border-dashed border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                  Para reservar plazas contacta con tu gestor del operador. Las reservas confirmadas
                  aparecerán automáticamente en <strong>Mis reservas</strong>.
                </p>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
