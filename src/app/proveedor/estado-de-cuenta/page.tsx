"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/tf/page-header";
import { EmptyState } from "@/components/tf/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney, formatDate } from "@/lib/format";
import { NOMBRE_DEL_TIPO, validarNcf, type TipoDeNcf } from "@/lib/ncf";
import type { AccionesDelProveedor } from "@/lib/conformidad-proveedor";

interface Liquidacion {
  _id: string;
  code: string | null;
  period_from: string | null;
  period_to: string | null;
  currency: string;
  status: string;
  net_total: number;
  pending_total: number;
  paid_at: string | null;
  accepted_at: string | null;
  disputed_at: string | null;
  dispute_reason: string | null;
  supplier_ncf: string | null;
  supplier_invoice_number: string | null;
  acciones: AccionesDelProveedor;
}

const ESTADO: Record<string, { texto: string; tono: string }> = {
  pending: { texto: "Emitida", tono: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  approved: { texto: "Aprobada", tono: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  partially_paid: { texto: "Pagada en parte", tono: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  paid: { texto: "Pagada", tono: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  held: { texto: "Retenida", tono: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  disputed: { texto: "En disputa", tono: "bg-destructive/10 text-destructive" },
  void: { texto: "Anulada", tono: "bg-muted text-muted-foreground" },
};

/**
 * MI ESTADO DE CUENTA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LAS TRES COSAS SON LA MISMA CONVERSACIÓN
 *
 * Ver el corte, contestarlo y facturarlo es lo que hoy pasa por teléfono: la
 * operadora manda un PDF por WhatsApp, el transportista llama si no está de
 * acuerdo, y dicta el número de comprobante para que lo teclee otra persona.
 * De esa llamada no queda nada, y un dígito de más en un NCF es un 606
 * rechazado semanas después.
 *
 * Por eso las tres viven en la misma pantalla y no en tres.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOS BOTONES LOS DECIDE EL SERVIDOR
 *
 * `acciones` viene calculado de arriba. Si cada botón tuviera su condición
 * escrita aquí, el día que cambie una regla habría que acordarse de cambiarla
 * en dos sitios — y el que se quede viejo es el que enseña un botón que el
 * servidor rechaza.
 */
export default function EstadoDeCuentaProveedorPage() {
  const [liquidaciones, setLiquidaciones] = useState<Liquidacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [ocupada, setOcupada] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const res = await api.get<{ liquidaciones: Liquidacion[] }>("/api/proveedor/estado-de-cuenta");
    setCargando(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo cargar tu estado de cuenta");
      setLiquidaciones([]);
      return;
    }
    setLiquidaciones(res.data?.liquidaciones ?? []);
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const aceptar = useCallback(async (liq: Liquidacion) => {
    setOcupada(liq._id);
    const res = await api.post("/api/proveedor/estado-de-cuenta", {
      liquidacion: liq._id, accion: "aceptar",
    });
    setOcupada(null);
    if (!res.ok) toast.error(res.error?.message || "No se pudo registrar tu conformidad");
    else toast.success("Conformidad registrada. Queda constancia de la fecha.");
    void cargar();
  }, [cargar]);

  const disputar = useCallback(async (liq: Liquidacion) => {
    const motivo = (window.prompt("¿Qué es lo que no cuadra? Explícalo en una frase.") || "").trim();
    // Sin motivo no se manda: el servidor lo rechazaría igual, y una disputa
    // sin explicación obliga a llamar para enterarse — que es justo lo que
    // esto viene a quitar.
    if (motivo.length < 10) {
      if (motivo) toast.error("Escribe al menos una frase explicando qué no cuadra");
      return;
    }
    setOcupada(liq._id);
    const res = await api.post(`/api/settlements/${liq._id}/dispute`, { reason: motivo });
    setOcupada(null);
    if (!res.ok) toast.error(res.error?.message || "No se pudo abrir la disputa");
    else toast.success("Disputa abierta. La operadora ya lo tiene.");
    void cargar();
  }, [cargar]);

  const facturar = useCallback(async (liq: Liquidacion) => {
    const ncf = (window.prompt("Número de comprobante fiscal (NCF) de tu factura:") || "").trim();
    if (!ncf) return;
    /**
     * Se valida ANTES de mandarlo, con la misma función que el servidor. No
     * para confiarse —el servidor vuelve a validar—, sino para que el error
     * salga al momento y con un ejemplo, en vez de un viaje de ida y vuelta.
     */
    const comprobado = validarNcf(ncf);
    if (!comprobado.ok) {
      toast.error(comprobado.mensaje ?? "Ese NCF no es válido");
      return;
    }
    const numero = (window.prompt("Número de tu factura (opcional):") || "").trim();
    setOcupada(liq._id);
    const res = await api.post<{ ncf: string }>("/api/proveedor/estado-de-cuenta", {
      liquidacion: liq._id, accion: "facturar", ncf: comprobado.ncf, numero: numero || null,
    });
    setOcupada(null);
    if (!res.ok) toast.error(res.error?.message || "No se pudo registrar la factura");
    else toast.success(`Factura registrada con el NCF ${res.data?.ncf ?? comprobado.ncf}.`);
    void cargar();
  }, [cargar]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mi estado de cuenta"
        description="Lo que la operadora te liquida, con su detalle y tu forma de discutirlo."
      />

      {!cargando && liquidaciones.length === 0 ? (
        <EmptyState
          icon="Receipt"
          title="Todavía no tienes liquidaciones"
          description="Cuando la operadora cierre un período con tus servicios, aparecerá aquí con su detalle."
        />
      ) : null}

      <ul className="space-y-3">
        {liquidaciones.map((liq) => {
          const e = ESTADO[liq.status] ?? { texto: liq.status, tono: "" };
          const tipo = liq.supplier_ncf?.slice(0, 3).toLowerCase() as TipoDeNcf | undefined;
          return (
            <li key={liq._id} className="rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{liq.code || "Liquidación"}</span>
                    <Badge variant="outline" className={e.tono}>{e.texto}</Badge>
                    {liq.accepted_at ? (
                      <span className="text-xs text-muted-foreground">
                        Aceptada el {formatDate(liq.accepted_at)}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {liq.period_from && liq.period_to
                      ? `Del ${formatDate(liq.period_from)} al ${formatDate(liq.period_to)}`
                      : "Período sin declarar"}
                  </div>
                  {liq.dispute_reason ? (
                    <p className="mt-1 text-sm text-destructive">En disputa: {liq.dispute_reason}</p>
                  ) : null}
                  {liq.supplier_ncf ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Tu factura: <span className="font-mono">{liq.supplier_ncf}</span>
                      {tipo && NOMBRE_DEL_TIPO[tipo] ? ` · ${NOMBRE_DEL_TIPO[tipo]}` : ""}
                      {liq.supplier_invoice_number ? ` · nº ${liq.supplier_invoice_number}` : ""}
                    </p>
                  ) : null}
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold tabular-nums">
                    {formatMoney(liq.net_total, liq.currency)}
                  </div>
                  {/* Lo que falta por cobrar, que es lo que de verdad se mira. */}
                  <div className="text-xs text-muted-foreground tabular-nums">
                    Pendiente {formatMoney(liq.pending_total, liq.currency)}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={`/api/settlements/${liq._id}/statement/pdf`}
                  className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium"
                >
                  Ver detalle
                </a>
                {liq.acciones.aceptar ? (
                  <Button size="sm" disabled={ocupada === liq._id} onClick={() => void aceptar(liq)}>
                    Estoy de acuerdo
                  </Button>
                ) : null}
                {liq.acciones.disputar ? (
                  <Button size="sm" variant="outline" disabled={ocupada === liq._id}
                    onClick={() => void disputar(liq)}>
                    No cuadra
                  </Button>
                ) : null}
                {liq.acciones.facturar ? (
                  <Button size="sm" variant="outline" disabled={ocupada === liq._id}
                    onClick={() => void facturar(liq)}>
                    Registrar mi factura
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-muted-foreground">
        El NCF que registres aquí es el que la operadora declara en su 606. Cópialo de tu factura tal
        cual: una vez registrado no se puede cambiar desde aquí.
      </p>
    </div>
  );
}
