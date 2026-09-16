"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PublicPage } from "@/lib/public-booking-service";
import { MAX_PUBLIC_PAX } from "@/lib/public-booking";

/**
 * EL MOTOR, DEL LADO DEL CLIENTE FINAL.
 *
 * Tres pasos y ninguno más: elegir excursión, elegir día, dejar los datos. Cada
 * paso adicional en un formulario público cuesta una parte de las reservas, y
 * aquí no hay un vendedor al lado para rescatar a quien se pierde.
 *
 * Sin componentes del panel a propósito: esta página la abre gente con el móvil
 * y la conexión del hotel, así que pesa lo mínimo —nada de tablas, diálogos ni
 * iconos del ERP— y se pinta con los colores de la operadora.
 */

type Product = PublicPage["products"][number];

interface Departure {
  id: string;
  at: string;
  seatsLeft: number | null;
  meetingPoint: string | null;
}

interface Confirmation {
  reference: string;
  product: string;
  date: string | null;
  pax: number;
  total: number;
  currency: string;
  payNote: string;
}

const money = (value: number, currency: string) =>
  `${currency.toUpperCase()} ${value.toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("es-DO", { weekday: "long", day: "numeric", month: "long" });

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" });

export function BookingEngine({ slug, page }: { slug: string; page: PublicPage }) {
  const org = page.org!;
  const [selected, setSelected] = useState<Product | null>(null);
  const [departures, setDepartures] = useState<Departure[] | null>(null);
  const [departureId, setDepartureId] = useState("");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [form, setForm] = useState({ name: "", email: "", phone: "", hotel: "", room: "", notes: "", website: "" });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Confirmation | null>(null);

  // El color de la operadora manda sobre el nuestro: el cliente le está
  // comprando a su marca.
  const brand = org.brandColor || "#0f766e";
  const style = useMemo(() => ({ "--marca": brand } as React.CSSProperties), [brand]);

  const openProduct = useCallback(async (product: Product) => {
    setSelected(product);
    setDepartures(null);
    setDepartureId("");
    setError("");
    const res = await fetch(`/api/public/${slug}/availability?product=${encodeURIComponent(product.id)}`);
    const body = await res.json().catch(() => null);
    setDepartures(res.ok && body?.ok ? body.data : []);
  }, [slug]);

  useEffect(() => {
    if (selected) window.scrollTo({ top: 0, behavior: "smooth" });
  }, [selected, done]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch(`/api/public/${slug}/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: selected.id,
          departureId: departureId || null,
          adults, children,
          ...form,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error?.message || "No pudimos enviar tu solicitud. Inténtalo de nuevo.");
        return;
      }
      setDone(body.data as Confirmation);
    } catch {
      setError("No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setSending(false);
    }
  };

  /* ------------------------------------------------------------ confirmación */
  if (done) {
    return (
      <main style={style} className="mx-auto min-h-screen max-w-2xl px-5 py-12">
        <Header org={org} />
        <div className="mt-8 rounded-2xl border border-black/10 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-neutral-900">
          <p className="text-sm font-semibold uppercase tracking-wider" style={{ color: brand }}>
            Solicitud recibida
          </p>
          <h1 className="mt-2 text-2xl font-bold">Tu referencia es {done.reference}</h1>
          <dl className="mt-5 space-y-2 text-sm">
            <Row label="Excursión" value={done.product} />
            {done.date && <Row label="Fecha" value={`${dayLabel(done.date)} · ${timeLabel(done.date)}`} />}
            <Row label="Personas" value={String(done.pax)} />
            <Row label="Total estimado" value={money(done.total, done.currency)} />
          </dl>
          <p className="mt-5 rounded-xl bg-black/5 p-4 text-sm dark:bg-white/5">{done.payNote}</p>
          <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">
            Guarda tu referencia. Si necesitas cambiar algo, escríbenos
            {org.whatsapp ? ` al ${org.whatsapp}` : org.phone ? ` al ${org.phone}` : ""} con ese número delante.
          </p>
        </div>
      </main>
    );
  }

  /* ------------------------------------------------------------ una excursión */
  if (selected) {
    const pax = adults + children;
    return (
      <main style={style} className="mx-auto min-h-screen max-w-2xl px-5 py-10">
        <Header org={org} />
        <button
          onClick={() => setSelected(null)}
          className="mt-6 text-sm font-medium underline underline-offset-4"
        >
          ← Ver todas las excursiones
        </button>

        <article className="mt-4">
          {selected.image && (
            <img src={selected.image} alt={selected.name} className="aspect-[16/9] w-full rounded-2xl object-cover" />
          )}
          <h1 className="mt-5 text-3xl font-bold leading-tight">{selected.name}</h1>
          {selected.summary && <p className="mt-2 text-neutral-600 dark:text-neutral-400">{selected.summary}</p>}
          <div className="mt-3 flex flex-wrap gap-3 text-sm text-neutral-600 dark:text-neutral-400">
            {selected.durationHours ? <span>⏱ {selected.durationHours} h</span> : null}
            {selected.location ? <span>📍 {selected.location}</span> : null}
            {selected.minAge ? <span>Edad mínima: {selected.minAge}</span> : null}
          </div>
          {selected.description && (
            <p className="mt-4 whitespace-pre-line text-sm leading-relaxed">{selected.description}</p>
          )}
          {selected.inclusions && (
            <div className="mt-4">
              <h2 className="text-sm font-semibold">Incluye</h2>
              <p className="mt-1 whitespace-pre-line text-sm text-neutral-600 dark:text-neutral-400">{selected.inclusions}</p>
            </div>
          )}
        </article>

        <form onSubmit={submit} className="mt-8 space-y-5 rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-neutral-900">
          <h2 className="text-lg font-semibold">Pide tu lugar</h2>

          <div>
            <label className="text-sm font-medium">¿Qué día?</label>
            {departures === null ? (
              <p className="mt-2 text-sm text-neutral-500">Buscando fechas…</p>
            ) : departures.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-500">
                No hay fechas publicadas ahora mismo. Escríbenos y te decimos cuándo sale.
              </p>
            ) : (
              <div className="mt-2 grid gap-2">
                {departures.slice(0, 12).map((d) => (
                  <label
                    key={d.id}
                    className={`flex cursor-pointer items-center justify-between rounded-xl border p-3 text-sm ${
                      departureId === d.id ? "border-[var(--marca)] ring-2 ring-[var(--marca)]/30" : "border-black/10 dark:border-white/10"
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <input
                        type="radio" name="departure" value={d.id} checked={departureId === d.id}
                        onChange={() => setDepartureId(d.id)} className="accent-[var(--marca)]"
                      />
                      <span>
                        <span className="block font-medium capitalize">{dayLabel(d.at)}</span>
                        <span className="text-neutral-500">{timeLabel(d.at)}</span>
                      </span>
                    </span>
                    {/* El cupo se enseña solo cuando queda poco: es cierto y es
                        lo único que de verdad ayuda a decidir hoy. */}
                    {d.seatsLeft !== null && d.seatsLeft <= 6 && (
                      <span className="text-xs font-semibold text-amber-600">Quedan {d.seatsLeft}</span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Counter label="Adultos" value={adults} min={0} max={MAX_PUBLIC_PAX} onChange={setAdults} />
            <Counter label="Niños" value={children} min={0} max={MAX_PUBLIC_PAX} onChange={setChildren} />
          </div>
          {pax > MAX_PUBLIC_PAX && (
            <p className="text-sm text-amber-600">
              Para grupos de más de {MAX_PUBLIC_PAX} personas escríbenos: te preparamos una cotización a medida.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tu nombre" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required autoComplete="name" />
            <Field label="Correo" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} autoComplete="email" />
            <Field label="Teléfono o WhatsApp" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} autoComplete="tel" />
            <Field label="Hotel donde te hospedas" value={form.hotel} onChange={(v) => setForm({ ...form, hotel: v })} />
            <Field label="Habitación (opcional)" value={form.room} onChange={(v) => setForm({ ...form, room: v })} />
            <Field label="Algo que debamos saber" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} className="sm:col-span-2" />
          </div>

          {/* Campo trampa: invisible para una persona, irresistible para un
              robot que rellena todo lo que encuentra. */}
          <input
            type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
            value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })}
            className="absolute left-[-9999px] h-0 w-0 opacity-0"
          />

          {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

          <button
            type="submit"
            disabled={sending || pax === 0 || pax > MAX_PUBLIC_PAX || form.name.trim().length < 3}
            className="w-full rounded-xl px-4 py-3 text-base font-semibold text-white disabled:opacity-50"
            style={{ background: brand }}
          >
            {sending ? "Enviando…" : "Pedir mi lugar"}
          </button>
          <p className="text-center text-xs text-neutral-500">
            No se cobra nada ahora. {org.name} te confirma la plaza y cómo pagar.
          </p>
        </form>
      </main>
    );
  }

  /* ------------------------------------------------------------- el catálogo */
  return (
    <main style={style} className="mx-auto min-h-screen max-w-3xl px-5 py-10">
      <Header org={org} />
      {org.intro && <p className="mt-4 text-neutral-600 dark:text-neutral-400">{org.intro}</p>}

      {page.products.length === 0 ? (
        <p className="mt-10 text-neutral-500">
          Todavía no hay excursiones publicadas. Escríbenos y te contamos qué tenemos.
        </p>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {page.products.map((product) => (
            <li key={product.id}>
              <button
                onClick={() => openProduct(product)}
                className="group w-full overflow-hidden rounded-2xl border border-black/10 bg-white text-left shadow-sm transition hover:shadow-md dark:border-white/10 dark:bg-neutral-900"
              >
                {product.image ? (
                        <img src={product.image} alt={product.name} className="aspect-[4/3] w-full object-cover" />
                ) : (
                  <div className="aspect-[4/3] w-full" style={{ background: `${brand}22` }} />
                )}
                <div className="p-4">
                  <h2 className="font-semibold leading-snug">{product.name}</h2>
                  {product.summary && (
                    <p className="mt-1 line-clamp-2 text-sm text-neutral-600 dark:text-neutral-400">{product.summary}</p>
                  )}
                  <p className="mt-3 text-sm font-semibold" style={{ color: brand }}>
                    {product.priceFrom ? `Desde ${money(product.priceFrom, product.currency)}` : "Consultar precio"}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <footer className="mt-12 border-t border-black/10 pt-6 text-sm text-neutral-500 dark:border-white/10">
        <p className="font-medium text-neutral-700 dark:text-neutral-300">{org.name}</p>
        {org.phone && <p>Tel. {org.phone}</p>}
        {org.whatsapp && <p>WhatsApp {org.whatsapp}</p>}
        {org.email && <p>{org.email}</p>}
      </footer>
    </main>
  );
}

/* --------------------------------------------------------------- piezas */

function Header({ org }: { org: NonNullable<PublicPage["org"]> }) {
  return (
    <header className="flex items-center gap-3">
      {org.logo ? (
        <img src={org.logo} alt={org.name} className="h-10 w-auto" />
      ) : (
        <span className="text-lg font-bold">{org.name}</span>
      )}
    </header>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function Field({
  label, value, onChange, type = "text", required = false, className = "", autoComplete,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; required?: boolean; className?: string; autoComplete?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="text-sm font-medium">{label}</span>
      <input
        type={type} value={value} required={required} autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-base outline-none focus:border-[var(--marca)] focus:ring-2 focus:ring-[var(--marca)]/30 dark:border-white/15 dark:bg-neutral-950"
      />
    </label>
  );
}

function Counter({
  label, value, min, max, onChange,
}: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div>
      <span className="text-sm font-medium">{label}</span>
      <div className="mt-1 flex items-center gap-3 rounded-xl border border-black/15 px-3 py-2 dark:border-white/15">
        <button
          type="button" aria-label={`Menos ${label.toLowerCase()}`}
          onClick={() => onChange(Math.max(min, value - 1))}
          className="size-8 rounded-lg text-lg font-semibold"
        >
          −
        </button>
        <span className="min-w-6 text-center text-base font-semibold tabular-nums">{value}</span>
        <button
          type="button" aria-label={`Más ${label.toLowerCase()}`}
          onClick={() => onChange(Math.min(max, value + 1))}
          className="size-8 rounded-lg text-lg font-semibold"
        >
          +
        </button>
      </div>
    </div>
  );
}
