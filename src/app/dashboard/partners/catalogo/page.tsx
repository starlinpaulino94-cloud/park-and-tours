"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/tf/page-header";
import { EmptyState } from "@/components/tf/empty-state";
import { Icon } from "@/components/tf/icon";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Socio { _id: string; name?: string; commercial_name?: string }
interface Producto { _id: string; name?: string; code?: string; category?: { name?: string } | string }
interface Autorizacion { _id: string; product?: { _id?: string } | string; status?: string }

const idDe = (ref: unknown): string =>
  typeof ref === "string" ? ref : String((ref as { _id?: string })?._id ?? "");

/**
 * QUÉ PUEDE VENDER CADA TOUR CENTER.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA PANTALLA QUE FALTABA DETRÁS DE UNA PROMESA
 *
 * La ficha del socio decía «catálogo autorizado» en su descripción y el
 * catálogo del portal filtraba por `authorized_products`. No existía la tabla,
 * ni el campo escribible, ni el formulario: la lista estaba vacía siempre y el
 * portal, ante una lista vacía, enseñaba el catálogo entero. Un operador que
 * leyera esa pantalla concluiría que su tour center solo ve lo autorizado.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SE QUITA, NO SE AÑADE
 *
 * Todo nace autorizado —la migración siembra el catálogo entero por socio, y un
 * producto nuevo nace autorizado para todos— porque la alternativa apaga la
 * venta de golpe: publicar una excursión dejaría de verse en los tour centers
 * hasta que alguien se acordara de autorizarla uno a uno. Así que esta pantalla
 * es para QUITAR, y por eso lo que enseña es el catálogo completo con su
 * interruptor, no una lista vacía que hay que rellenar.
 */
export default function PartnerCatalogPage() {
  const [socios, setSocios] = useState<Socio[]>([]);
  const [socioId, setSocioId] = useState("");
  const [productos, setProductos] = useState<Producto[]>([]);
  const [autorizaciones, setAutorizaciones] = useState<Record<string, Autorizacion>>({});
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const [s, p] = await Promise.all([
        api.get<Socio[]>("/api/erp/partner?limit=200&filter.status=active&sort=name"),
        api.get<Producto[]>("/api/erp/product?limit=500&sort=name&expand=category"),
      ]);
      if (!vivo) return;
      if (s.ok) {
        setSocios(s.data || []);
        setSocioId((prev) => prev || s.data?.[0]?._id || "");
      }
      if (p.ok) setProductos(p.data || []);
      setCargando(false);
    })();
    return () => { vivo = false; };
  }, []);

  const cargarAutorizaciones = useCallback(async () => {
    if (!socioId) return;
    const res = await api.get<Autorizacion[]>(
      `/api/erp/partner_product?limit=1000&filter.partner=${socioId}`
    );
    if (!res.ok) {
      console.error("[partners/catalogo] no se pudieron leer las autorizaciones:", res.error);
      toast.error(res.error?.message || "No se pudieron leer las autorizaciones");
      return;
    }
    const mapa: Record<string, Autorizacion> = {};
    for (const a of res.data || []) mapa[idDe(a.product)] = a;
    setAutorizaciones(mapa);
  }, [socioId]);

  useEffect(() => { void cargarAutorizaciones(); }, [cargarAutorizaciones]);

  const visibles = useMemo(() => {
    const texto = q.trim().toLowerCase();
    if (!texto) return productos;
    return productos.filter((p) =>
      (p.name || "").toLowerCase().includes(texto) || (p.code || "").toLowerCase().includes(texto));
  }, [productos, q]);

  const autorizados = visibles.filter((p) => autorizaciones[p._id]?.status === "active").length;

  const alternar = async (producto: Producto, autorizar: boolean) => {
    const actual = autorizaciones[producto._id];
    setGuardando(producto._id);
    /**
     * Desautorizar pone la fila INACTIVA, no la borra.
     *
     * Queda el rastro de que ese producto estuvo autorizado, que es lo que se
     * mira cuando un tour center reclama una reserva que «antes sí podía
     * hacer». Borrar la fila deja esa conversación sin datos.
     */
    const res = actual
      ? await api.put(`/api/erp/partner_product/${actual._id}`, { status: autorizar ? "active" : "inactive" })
      : await api.post("/api/erp/partner_product", {
          partner: socioId, product: producto._id, status: autorizar ? "active" : "inactive",
        });
    setGuardando(null);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo guardar la autorización");
      return;
    }
    void cargarAutorizaciones();
  };

  const socio = socios.find((s) => s._id === socioId);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Red de ventas"
        title="Catálogo autorizado por tour center"
        description="Qué puede vender cada canal externo. Todo nace autorizado: aquí se quita."
        actions={
          <Select value={socioId} onValueChange={setSocioId}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Elige un tour center" /></SelectTrigger>
            <SelectContent>
              {socios.map((s) => (
                <SelectItem key={s._id} value={s._id}>{s.commercial_name || s.name || "Partner"}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {cargando ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}</div>
      ) : socios.length === 0 ? (
        <EmptyState icon="Handshake" title="No hay tour centers activos"
          description="Da de alta un canal externo para decidir qué puede vender." />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Input placeholder="Buscar excursión…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
            <p className="text-sm text-muted-foreground">
              {autorizados} de {visibles.length} autorizadas
              {socio ? ` para ${socio.commercial_name || socio.name}` : ""}
            </p>
          </div>

          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {visibles.map((p) => {
              const activo = autorizaciones[p._id]?.status === "active";
              return (
                <li key={p._id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.code ? `${p.code} · ` : ""}
                      {typeof p.category === "object" ? p.category?.name : p.category}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {!activo && <span className="text-xs text-muted-foreground">No autorizada</span>}
                    <Switch
                      checked={activo}
                      disabled={guardando === p._id}
                      onCheckedChange={(v) => alternar(p, v)}
                      aria-label={`Autorizar ${p.name} a ${socio?.commercial_name || socio?.name || "este tour center"}`}
                    />
                  </div>
                </li>
              );
            })}
          </ul>

          {visibles.length === 0 && (
            <EmptyState icon="Search" title="Nada coincide con esa búsqueda" description="Prueba con otro nombre o código." />
          )}
        </>
      )}
    </div>
  );
}
