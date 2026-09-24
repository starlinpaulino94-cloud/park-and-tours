"use client";

import { useState } from "react";

/**
 * Los dos botones.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL MOTIVO NO ES OBLIGATORIO
 *
 * Exigir que escriba por qué no puede para dejarle decir que no es la forma de
 * que no diga nada y la operadora se entere cuando no aparezca el autobús. Se
 * le pide, no se le exige.
 */
export function RespuestaForm({ token }: { token: string }) {
  const [enviando, setEnviando] = useState<"accepted" | "rejected" | null>(null);
  const [nota, setNota] = useState("");
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);

  async function contestar(respuesta: "accepted" | "rejected") {
    setEnviando(respuesta);
    try {
      const res = await fetch(`/api/servicio/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ respuesta, nota: nota.trim() || null }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setResultado({ ok: false, texto: json?.error?.message || "No se pudo registrar tu respuesta." });
        return;
      }
      setResultado({
        ok: true,
        texto: respuesta === "accepted"
          ? `Gracias. Tu número de confirmación es ${json.data?.confirmation_number ?? "—"}.`
          : "Gracias por avisar. Le buscamos otro proveedor.",
      });
    } catch {
      // Y el error de red se dice. Un botón que no hace nada y no explica nada
      // acaba en cuatro pulsaciones más y una llamada de teléfono.
      setResultado({ ok: false, texto: "No hay conexión. Inténtalo otra vez en un momento." });
    } finally {
      setEnviando(null);
    }
  }

  if (resultado) {
    return (
      <p className={`rounded-lg border p-4 text-sm ${resultado.ok ? "bg-card" : "border-destructive/40 text-destructive"}`}>
        {resultado.texto}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <label className="block space-y-1.5">
        <span className="text-sm text-muted-foreground">Si no puedes, cuéntanos por qué (opcional)</span>
        <textarea
          id="nota-de-respuesta"
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          rows={2}
          maxLength={500}
          className="w-full rounded-md border bg-background p-2 text-sm"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={enviando !== null}
          onClick={() => void contestar("accepted")}
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {enviando === "accepted" ? "Enviando…" : "Sí, lo presto"}
        </button>
        <button
          type="button"
          disabled={enviando !== null}
          onClick={() => void contestar("rejected")}
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md border px-4 text-sm font-semibold disabled:opacity-60"
        >
          {enviando === "rejected" ? "Enviando…" : "No puedo"}
        </button>
      </div>
    </div>
  );
}
