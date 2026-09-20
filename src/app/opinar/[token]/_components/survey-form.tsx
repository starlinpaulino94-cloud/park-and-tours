"use client";

import { useState } from "react";
import { SURVEY_DICTIONARY, translator, type Locale } from "@/lib/i18n";

/**
 * LA ENCUESTA, DEL LADO DEL PASAJERO.
 *
 * Once botones grandes y nada más hasta que toque uno. Las tres valoraciones y
 * el comentario aparecen DESPUÉS de la nota, porque un formulario largo desde
 * el principio se cierra sin contestar nada — y la nota es lo único que de
 * verdad hace falta.
 *
 * Sin componentes del panel a propósito: esto lo abre alguien con el móvil y la
 * conexión del hotel.
 */

type Step = "review" | "thanks" | "recover";

interface Props {
  token: string;
  locale: Locale;
  companyName: string;
  productName: string;
  travelDate: string;
  customerName: string;
}

const NOTAS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export function SurveyForm({ token, locale, companyName, productName, travelDate, customerName }: Props) {
  const t = translator(SURVEY_DICTIONARY, locale);

  const [nps, setNps] = useState<number | null>(null);
  const [guide, setGuide] = useState<number | null>(null);
  const [transport, setTransport] = useState<number | null>(null);
  const [value, setValue] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ step: Step; reviewUrl: string | null } | null>(null);
  const [optedOut, setOptedOut] = useState(false);

  async function enviar() {
    if (nps === null || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/opinar/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nps,
          ratingGuide: guide, ratingTransport: transport, ratingValue: value,
          comment: comment.trim() || null,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(String(json?.error?.message || t("survey.error")));
        return;
      }
      setDone({ step: json.data.step as Step, reviewUrl: json.data.reviewUrl ?? null });
    } catch {
      setError(t("survey.error"));
    } finally {
      setSending(false);
    }
  }

  async function darseDeBaja() {
    setOptedOut(true); // optimista: lo que no puede pasar es que parezca que no se hizo
    try {
      await fetch(`/api/opinar/${encodeURIComponent(token)}/baja`, { method: "POST" });
    } catch {
      // Se reintenta con el siguiente clic; el estado local ya lo refleja.
    }
  }

  if (done) {
    return (
      <Marco empresa={companyName}>
        {done.step === "review" && done.reviewUrl ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">{t("survey.reviewTitle")}</h1>
            <p className="text-muted-foreground">{t("survey.reviewBody")}</p>
            {/*
              Va por nuestra ruta y no directo al sitio de reseñas: es la única
              forma de saber cuántos de los que dicen «un 10» llegan a
              escribirla, que es lo que dice si este embudo sirve.
            */}
            <a
              href={`/opinar/${encodeURIComponent(token)}/resena`}
              className="mt-2 inline-flex w-full items-center justify-center rounded-xl bg-foreground px-6 py-4 text-lg font-medium text-background"
            >
              {t("survey.reviewCta")}
            </a>
          </>
        ) : done.step === "recover" ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">{t("survey.recoverTitle")}</h1>
            <p className="text-muted-foreground">{t("survey.recoverBody")}</p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">{t("survey.thanksTitle")}</h1>
            <p className="text-muted-foreground">{t("survey.thanksBody")}</p>
          </>
        )}
        <Baja token={token} t={t} optedOut={optedOut} onOptOut={darseDeBaja} />
      </Marco>
    );
  }

  return (
    <Marco empresa={companyName}>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {customerName ? `${customerName}, ${t("survey.title").toLowerCase()}` : t("survey.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("survey.intro", { product: productName, date: travelDate })}
        </p>
      </header>

      <section className="space-y-3">
        <p className="font-medium">{t("survey.question")}</p>
        <div className="grid grid-cols-6 gap-2 sm:grid-cols-11">
          {NOTAS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setNps(n)}
              aria-pressed={nps === n}
              aria-label={String(n)}
              className={[
                // Grande de verdad: se toca con el pulgar, en la cama del hotel.
                "h-12 rounded-lg border text-base font-medium transition",
                nps === n ? "border-foreground bg-foreground text-background" : "border-border bg-background",
              ].join(" ")}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{t("survey.scaleLow")}</span>
          <span>{t("survey.scaleHigh")}</span>
        </div>
      </section>

      {nps !== null ? (
        <section className="space-y-4 border-t pt-5">
          <p className="font-medium">{t("survey.detailsTitle")}</p>
          <Estrellas etiqueta={t("survey.guide")} valor={guide} onChange={setGuide} />
          <Estrellas etiqueta={t("survey.transport")} valor={transport} onChange={setTransport} />
          <Estrellas etiqueta={t("survey.value")} valor={value} onChange={setValue} />

          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">{t("survey.comment")}</span>
            <textarea
              id="survey-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder={t("survey.commentPlaceholder")}
              className="w-full rounded-lg border border-border bg-background p-3 text-base"
            />
          </label>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <button
            type="button"
            onClick={enviar}
            disabled={sending}
            className="w-full rounded-xl bg-foreground px-6 py-4 text-lg font-medium text-background disabled:opacity-60"
          >
            {sending ? t("survey.sending") : t("survey.send")}
          </button>
        </section>
      ) : null}

      <Baja token={token} t={t} optedOut={optedOut} onOptOut={darseDeBaja} />
    </Marco>
  );
}

function Marco({ empresa, children }: { empresa: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-10">
      {children}
      <footer className="pt-2 text-center text-sm text-muted-foreground">{empresa}</footer>
    </main>
  );
}

function Estrellas({
  etiqueta, valor, onChange,
}: { etiqueta: string; valor: number | null; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm">{etiqueta}</span>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-label={`${etiqueta}: ${n}`}
            aria-pressed={valor === n}
            className={[
              "h-10 w-10 rounded-lg border text-lg transition",
              (valor ?? 0) >= n ? "border-foreground bg-foreground text-background" : "border-border bg-background",
            ].join(" ")}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  );
}

function Baja({
  t, optedOut, onOptOut,
}: {
  token: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
  optedOut: boolean;
  onOptOut: () => void;
}) {
  if (optedOut) {
    return (
      <p className="pt-4 text-center text-xs text-muted-foreground">
        {t("survey.optOutDone")} {t("survey.optOutNote")}
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={onOptOut}
      className="pt-4 text-center text-xs text-muted-foreground underline underline-offset-4"
    >
      {t("survey.optOut")}
    </button>
  );
}
