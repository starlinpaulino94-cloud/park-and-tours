"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { brandColor, readableOn } from "@/lib/branding";
import { PUBLIC_DICTIONARY, SUPPORTED_LOCALES, LOCALE_LABEL, translator, type Locale } from "@/lib/i18n";
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

export function BookingEngine({
  slug, page, locale: initial, preselect = null,
}: { slug: string; page: PublicPage; locale: Locale; preselect?: string | null }) {
  const org = page.org!;
  /**
   * El idioma se decide en el SERVIDOR y aquí solo se puede cambiar a mano.
   *
   * Al revés —detectar en el navegador— el huésped ve la página en español
   * durante el primer pintado y salta al inglés después, que es exactamente el
   * segundo en el que decide si se queda.
   */
  const [locale, setLocale] = useState<Locale>(initial);
  const t = translator(PUBLIC_DICTIONARY, locale);
  const [selected, setSelected] = useState<Product | null>(null);
  const [departures, setDepartures] = useState<Departure[] | null>(null);
  const [departureId, setDepartureId] = useState("");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [form, setForm] = useState({ name: "", email: "", phone: "", hotel: "", room: "", notes: "", website: "" });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Confirmation | null>(null);

  /**
   * El color de la operadora manda sobre el nuestro: el cliente le está
   * comprando a su marca.
   *
   * Pasa por `brandColor` (0055) y no por un `||` a secas: hasta esa migración
   * `brand_color` no existía como columna y este valor era SIEMPRE undefined,
   * así que el respaldo tapaba el problema. Ahora que llega de verdad, un valor
   * inválido guardado antes de la validación pintaría `background: verde` y
   * dejaría media página sin color, sin que nada avisara.
   */
  const brand = brandColor(org.brandColor);
  const onBrand = readableOn(brand);
  const style = useMemo(
    () => ({ "--marca": brand, "--sobre-marca": onBrand } as React.CSSProperties),
    [brand, onBrand]
  );

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

  /**
   * El enlace del vendedor traía un producto: se abre solo, una vez.
   *
   * La guarda `!selected` importa más de lo que parece: sin ella, volver al
   * catálogo desde la ficha reabriría el mismo producto al instante y no se
   * podría salir de él.
   */
  useEffect(() => {
    if (!preselect || selected || done) return;
    const product = page.products.find((p) => p.id === preselect);
    if (product) void openProduct(product);
    // Solo al montar: reaccionar a `selected` volvería a abrirlo al cerrarlo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          // El idioma en el que reservó viaja con la solicitud: los avisos de
          // la víspera salen cuando ya no hay navegador del que deducirlo.
          language: locale,
          ...form,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error?.message || t("engine.errorSend"));
        return;
      }
      setDone(body.data as Confirmation);
    } catch {
      setError(t("engine.errorNetwork"));
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
            {t("engine.received")}
          </p>
          <h1 className="mt-2 text-2xl font-bold">{t("engine.yourReference")} {done.reference}</h1>
          <dl className="mt-5 space-y-2 text-sm">
            <Row label={t("engine.product")} value={done.product} />
            {done.date && <Row label={t("engine.date")} value={`${dayLabel(done.date)} · ${timeLabel(done.date)}`} />}
            <Row label={t("engine.people")} value={String(done.pax)} />
            <Row label={t("engine.estimatedTotal")} value={money(done.total, done.currency)} />
          </dl>
          <p className="mt-5 rounded-xl bg-black/5 p-4 text-sm dark:bg-white/5">{done.payNote}</p>
          <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">
            {t("engine.keepReference")}
            {org.whatsapp ? ` ${org.whatsapp}` : org.phone ? ` ${org.phone}` : ""} {t("engine.keepReferenceEnd")}
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
            {selected.minAge ? <span>{t("engine.minAge")}: {selected.minAge}</span> : null}
          </div>
          {selected.description && (
            <p className="mt-4 whitespace-pre-line text-sm leading-relaxed">{selected.description}</p>
          )}
          {selected.inclusions && (
            <div className="mt-4">
              <h2 className="text-sm font-semibold">{t("engine.included")}</h2>
              <p className="mt-1 whitespace-pre-line text-sm text-neutral-600 dark:text-neutral-400">{selected.inclusions}</p>
            </div>
          )}
        </article>

        <form onSubmit={submit} className="mt-8 space-y-5 rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-neutral-900">
          <h2 className="text-lg font-semibold">{t("engine.cta")}</h2>

          <div>
            <label className="text-sm font-medium">¿Qué día?</label>
            {departures === null ? (
              <p className="mt-2 text-sm text-neutral-500">{t("engine.loadingDates")}</p>
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
            <Counter label={t("engine.adults")} value={adults} min={0} max={MAX_PUBLIC_PAX} onChange={setAdults} />
            <Counter label={t("engine.children")} value={children} min={0} max={MAX_PUBLIC_PAX} onChange={setChildren} />
          </div>
          {pax > MAX_PUBLIC_PAX && (
            <p className="text-sm text-amber-600">
              Para grupos de más de {MAX_PUBLIC_PAX} personas escríbenos: te preparamos una cotización a medida.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("engine.name")} value={form.name} onChange={(v) => setForm({ ...form, name: v })} required autoComplete="name" />
            <Field label={t("engine.email")} type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} autoComplete="email" />
            <Field label={t("engine.phone")} value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} autoComplete="tel" />
            <Field label={t("engine.hotel")} value={form.hotel} onChange={(v) => setForm({ ...form, hotel: v })} />
            <Field label={t("engine.room")} value={form.room} onChange={(v) => setForm({ ...form, room: v })} />
            <Field label={t("engine.notes")} value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} className="sm:col-span-2" />
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
            style={{ background: brand, color: onBrand }}
          >
            {sending ? t("engine.sending") : t("engine.submit")}
          </button>
          <p className="text-center text-xs text-neutral-500">
            No se cobra nada ahora. {org.name} te confirma la plaza y cómo pagar.
          </p>
        </form>
      </main>
    );
  }

  /* ------------------------------------------------------------- el catálogo */

  /**
   * Cambiar de idioma recarga con `?lang=`.
   *
   * No se hace solo en el cliente a propósito: la página se pinta en el
   * servidor, y un cambio que solo viva en el estado dejaría el HTML inicial
   * —el que ve un buscador y el que se lee el primer segundo— en el otro
   * idioma.
   */
  const cambiarIdioma = (next: Locale) => {
    setLocale(next);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("lang", next);
    window.location.href = url.toString();
  };

  const selectorIdioma = (
    <div className="flex items-center gap-1 text-xs" aria-label={t("lang.switch")}>
      {SUPPORTED_LOCALES.map((one) => (
        <button
          key={one}
          type="button"
          onClick={() => cambiarIdioma(one)}
          aria-current={one === locale ? "true" : undefined}
          className={
            one === locale
              ? "rounded-full px-2.5 py-1 font-semibold"
              : "rounded-full px-2.5 py-1 opacity-60 hover:opacity-100"
          }
          style={one === locale ? { background: brand, color: onBrand } : undefined}
        >
          {LOCALE_LABEL[one]}
        </button>
      ))}
    </div>
  );

  return (
    <main style={style} className="mx-auto min-h-screen max-w-3xl px-5 py-10">
      <div className="flex items-start justify-between gap-4">
        <Header org={org} />
        {selectorIdioma}
      </div>
      {org.intro && <p className="mt-4 text-neutral-600 dark:text-neutral-400">{org.intro}</p>}

      {page.products.length === 0 ? (
        <p className="mt-10 text-neutral-500">{t("page.noProducts")}</p>
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
                    {product.priceFrom ? t("engine.priceFrom", { price: money(product.priceFrom, product.currency) }) : t("engine.quote")}
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
