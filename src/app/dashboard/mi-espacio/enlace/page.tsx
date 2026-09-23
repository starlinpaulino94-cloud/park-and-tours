"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/tf/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/tf/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill } from "@/components/tf/status-badge";
import { EmptyState } from "@/components/tf/empty-state";
import { formatNumber } from "@/lib/format";
import { SinFicha } from "../_components/sin-ficha";

interface Enlace {
  _id: string; slug?: string; name?: string | null; channel?: string;
  status?: string; hits?: number | null;
  product?: { name?: string } | string | null;
}
interface Paso { stage: string; label: string; count: number; conversion: number | null }
interface Embudo { steps: Paso[]; baseUrl?: string; days?: number; truncated?: boolean }

/**
 * MI ENLACE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE YA EXISTÍA Y NADIE PODÍA USAR
 *
 * El motor de atribución está entero desde 0058: `/e/[slug]` siembra la cookie,
 * `seller_attribution` guarda cada etapa, `funnelReport` la resume y la venta
 * web se atribuye sola. Lo único que lo cerraba era una guarda de rango — el
 * embudo y el QR pedían gerencia—, así que el vendedor no podía ni ver su
 * enlace ni descargar su cartel. Un QR que no se puede descargar no se pega en
 * ningún mostrador.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL SLUG NO SE ELIGE
 *
 * Esta pantalla no tiene campo para el slug, y no es un olvido: es único en
 * todo el sistema, así que elegirlo permitiría ocupar los nombres del espacio
 * compartido o imitar el de un compañero para llevarse sus visitas. Lo genera
 * el servidor; aquí se pone el NOMBRE, que es para reconocerlo uno mismo
 * («mostrador Macao») y no viaja a ninguna parte.
 */
export default function MiEnlacePage() {
  const [sellerId, setSellerId] = useState<string | null | undefined>(undefined);
  const [enlaces, setEnlaces] = useState<Enlace[]>([]);
  const [embudo, setEmbudo] = useState<Embudo | null>(null);
  const [cargando, setCargando] = useState(true);
  const [nombre, setNombre] = useState("");
  const [creando, setCreando] = useState(false);

  const recargar = useCallback(async () => {
    const [lista, funnel] = await Promise.all([
      api.get<Enlace[]>("/api/attribution/links"),
      api.get<Embudo>("/api/attribution?days=30"),
    ]);
    if (lista.ok) setEnlaces(lista.data || []);
    if (funnel.ok) setEmbudo(funnel.data ?? null);
    setCargando(false);
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const yo = await api.get<{ user?: { sellerId?: string | null } }>("/api/me");
      if (!vivo) return;
      const id = yo.ok ? yo.data?.user?.sellerId ?? null : null;
      setSellerId(id);
      if (!id) { setCargando(false); return; }
      await recargar();
    })();
    return () => { vivo = false; };
  }, [recargar]);

  const crear = async () => {
    setCreando(true);
    const res = await api.post<Enlace>("/api/attribution/links", { name: nombre.trim() || null, channel: "qr" });
    setCreando(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo crear el enlace");
      return;
    }
    setNombre("");
    toast.success("Enlace creado");
    await recargar();
  };

  const copiar = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Enlace copiado");
    } catch {
      // Sin permiso de portapapeles —pasa en algunos navegadores de móvil— se
      // dice qué hacer en vez de fallar en silencio.
      toast.error("Tu navegador no dejó copiar. Mantén pulsado sobre el enlace para copiarlo a mano.");
    }
  };

  if (sellerId === undefined || (cargando && sellerId)) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Mi espacio" title="Mi enlace y mi QR" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (!sellerId) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Mi espacio" title="Mi enlace y mi QR" />
        <SinFicha />
      </div>
    );
  }

  const base = embudo?.baseUrl || "";
  const urlDe = (e: Enlace) => (base && e.slug ? `${base}/e/${e.slug}` : "");

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Mi espacio"
        title="Mi enlace y mi QR"
        description="Repártelo por WhatsApp o imprímelo: las ventas que entren por ahí se te atribuyen solas."
      />

      <section className="rounded-xl border border-border/70 bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1 space-y-1.5">
            <Label htmlFor="nombre-enlace" className="text-[12px] font-semibold">Nombre del enlace</Label>
            <Input
              id="nombre-enlace" value={nombre} onChange={(e) => setNombre(e.target.value)}
              placeholder="Mostrador Macao"
            />
            {/* El slug no se elige: lo pone el servidor. Decirlo evita que
                alguien lo busque y crea que falta algo. */}
            <p className="text-xs text-muted-foreground">
              Es solo para que lo reconozcas tú. La dirección la genera el sistema.
            </p>
          </div>
          <Button onClick={crear} disabled={creando} className="gap-1.5">
            <Icon name={creando ? "Loader2" : "Plus"} className={creando ? "size-4 animate-spin" : "size-4"} />
            Crear enlace
          </Button>
        </div>
      </section>

      {enlaces.length === 0 ? (
        <EmptyState
          icon="QrCode"
          title="Todavía no tienes ningún enlace"
          description="Crea uno y tendrás una dirección y un código QR propios. Cada venta que entre por ahí queda a tu nombre."
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {enlaces.map((e) => {
            const url = urlDe(e);
            const activo = e.status !== "inactive";
            return (
              <li key={e._id} className="space-y-3 rounded-xl border border-border/70 bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{e.name || "Enlace sin nombre"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {typeof e.product === "object" && e.product?.name
                        ? `Lleva a ${e.product.name}`
                        : "Lleva al catálogo completo"}
                    </p>
                  </div>
                  <Pill tone={activo ? "success" : "neutral"}>{activo ? "Activo" : "Retirado"}</Pill>
                </div>

                <code className="block truncate rounded-md bg-muted/60 px-2.5 py-2 text-xs">{url || "—"}</code>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="gap-1.5" disabled={!url} onClick={() => copiar(url)}>
                    <Icon name="Copy" className="size-3.5" /> Copiar
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1.5" asChild>
                    <a href={`/api/attribution/links/${e._id}/qr`} download={`qr-${e.slug ?? e._id}.png`}>
                      <Icon name="QrCode" className="size-3.5" /> Descargar QR
                    </a>
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  {/* «Nunca» y «cero» son lo mismo aquí y aun así se dicen
                      distinto: «0 aperturas» parece un fallo del contador. */}
                  {e.hits ? `${formatNumber(e.hits)} apertura(s)` : "Todavía no lo ha abierto nadie"}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {embudo?.steps?.length ? (
        <section className="rounded-xl border border-border/70 bg-card">
          <header className="border-b border-border/70 px-4 py-3">
            <h2 className="font-display text-sm font-semibold">Tu embudo · últimos 30 días</h2>
          </header>
          <ul className="divide-y divide-border/70">
            {embudo.steps.map((p) => (
              <li key={p.stage} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="text-sm">{p.label}</span>
                <span className="flex items-center gap-3">
                  {/* La conversión es null en la primera etapa y cuando la
                      anterior es cero: pintar «0 %» diría que convierte mal
                      cuando lo que pasa es que aún no ha traído a nadie. */}
                  {p.conversion != null && (
                    <span className="text-xs text-muted-foreground">{p.conversion.toFixed(0)} %</span>
                  )}
                  <span className="tabular-nums font-semibold">{formatNumber(p.count)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
