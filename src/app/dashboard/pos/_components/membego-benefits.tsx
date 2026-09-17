"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/tf/icon";
import { formatMoney } from "@/lib/format";
import {
  offerable, notOfferable, reasonMessage, effectOf,
  type EvaluatedBenefit, type EvaluateResult,
} from "@/lib/membego-benefits";

/**
 * LOS BENEFICIOS DE MEMBEGO EN EL MOSTRADOR.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DÓNDE VIVE Y POR QUÉ AQUÍ
 *
 * En el diálogo de cobro, no en el carrito. La razón es de dinero: el beneficio
 * se consume contra una VENTA que ya existe. Ofrecerlo en el carrito
 * significaría gastar un uso del cliente contra algo que puede abandonarse — y
 * ese uso no vuelve solo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SE PREGUNTA SIEMPRE, NO SE GUARDA NUNCA
 *
 * Cada vez que se abre, se le pregunta a MembeGo. Un cliente que gastó su
 * beneficio hace diez minutos en otra sucursal tiene que encontrarse aquí con
 * un «ya no queda». Enseñar una lista guardada sería regalarle al siguiente
 * cliente un descuento que ya no existe.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO NO ELEGIBLE TAMBIÉN SE ENSEÑA
 *
 * Con su motivo. El cajero necesita poder decir «se te venció el 3 de agosto»;
 * si el beneficio simplemente no aparece, parece que el sistema no lo ve y la
 * conversación acaba en una llamada.
 */

interface Props {
  orderId: string;
  customerId: string;
  currency: string;
  /** Las líneas de la venta: el beneficio se aplica a una, no a todas. */
  lines: { id: string; label: string; total: number }[];
  /** Para que el diálogo recargue el importe a cobrar. */
  onApplied: (newTotal: number) => void;
}

interface Payload {
  available: boolean;
  reason: string | null;
  membegoClienteId: string | null;
  evaluation: EvaluateResult | null;
}

interface Applied {
  benefitName: string;
  effectLabel: string;
  discount: number;
  usesLeft: number | null;
  orderTotal: number;
}

export function MembegoBenefits({ orderId, customerId, currency, lines, onApplied }: Props) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [lineId, setLineId] = useState<string>("");

  const cargar = useCallback(async () => {
    if (!customerId) { setLoading(false); return; }
    setLoading(true);
    const res = await api.get<Payload>(`/api/membego/benefits?customer=${encodeURIComponent(customerId)}`);
    setLoading(false);
    if (res.ok === false) {
      // Que MembeGo no conteste no puede impedir cobrar: se calla y el
      // mostrador sigue.
      console.error("[pos] beneficios MembeGo:", res.error);
      setData({ available: false, reason: null, membegoClienteId: null, evaluation: null });
      return;
    }
    setData(res.data ?? null);
  }, [customerId]);

  useEffect(() => { void cargar(); }, [cargar]);

  // La línea por defecto es la más cara: es lo que cualquiera haría a mano y lo
  // que el cliente espera de «tienes una gratis».
  useEffect(() => {
    if (lineId) return;
    const cara = [...lines].filter((l) => l.total > 0).sort((a, b) => b.total - a.total)[0];
    if (cara) setLineId(cara.id);
  }, [lines, lineId]);

  const canjear = async (benefit: EvaluatedBenefit) => {
    if (!data?.evaluation) return;
    setBusy(true);
    const res = await api.post<Applied>("/api/membego/redeem", {
      order_id: orderId,
      booking_id: lineId || null,
      benefit,
      evaluated_at: data.evaluation.evaluatedAt,
    });
    setBusy(false);

    if (res.ok === false) {
      console.error("[pos] canje MembeGo:", res.error);
      const code = (res.error as { code?: string } | undefined)?.code;
      toast.error(res.error?.message || "No se pudo canjear el beneficio");
      // Si MembeGo dice que ya no se puede, la lista que tenemos delante está
      // vieja: se vuelve a preguntar en vez de dejar al cajero insistiendo.
      if (code === "BENEFIT_NOT_ELIGIBLE" || code === "REDEMPTION_CONFLICT") void cargar();
      return;
    }

    const result = res.data as Applied;
    setApplied(result);
    onApplied(result.orderTotal);
    toast.success(
      `${result.benefitName} aplicado · −${formatMoney(result.discount, currency)}` +
      (result.usesLeft === null ? " · usos ilimitados" : ` · le quedan ${result.usesLeft}`)
    );
  };

  // Sin cliente de MembeGo no hay nada que enseñar: una tarjeta vacía en cada
  // venta sería ruido en el noventa por ciento de los cobros.
  if (!customerId) return null;
  if (loading) {
    return (
      <p className="text-xs text-muted-foreground">
        <Icon name="Loader" className="mr-1 inline h-3 w-3 animate-spin" />
        Consultando beneficios en MembeGo…
      </p>
    );
  }
  if (!data) return null;

  if (applied) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
        <p className="font-semibold">
          <Icon name="BadgeCheck" className="mr-1 inline h-4 w-4" />
          {applied.benefitName} · {applied.effectLabel}
        </p>
        <p className="text-xs">
          Se rebajó {formatMoney(applied.discount, currency)}.{" "}
          {applied.usesLeft === null ? "Usos ilimitados." : `Le quedan ${applied.usesLeft} uso(s).`}
        </p>
      </div>
    );
  }

  if (!data.available) {
    // Solo se explica cuando hay algo que explicar. «Este cliente no está en
    // MembeGo» en cada venta de un turista de paso sería ruido.
    if (!data.reason || !data.membegoClienteId) return null;
    return <p className="text-xs text-muted-foreground">MembeGo: {data.reason}</p>;
  }

  const usables = offerable(data.evaluation);
  const bloqueados = notOfferable(data.evaluation);
  if (usables.length === 0 && bloqueados.length === 0) {
    return <p className="text-xs text-muted-foreground">Este cliente no tiene beneficios de MembeGo ahora mismo.</p>;
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 px-3 py-2.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Beneficios MembeGo</p>
        <button type="button" className="text-xs text-primary hover:underline" onClick={() => void cargar()}>
          Volver a consultar
        </button>
      </div>

      {usables.length > 0 && lines.filter((l) => l.total > 0).length > 1 && (
        <label className="block text-xs text-muted-foreground">
          Se aplica a:{" "}
          <select
            className="ml-1 rounded border bg-background px-1.5 py-0.5 text-xs"
            value={lineId}
            onChange={(e) => setLineId(e.target.value)}
          >
            {lines.filter((l) => l.total > 0).map((line) => (
              <option key={line.id} value={line.id}>
                {line.label} · {formatMoney(line.total, currency)}
              </option>
            ))}
          </select>
        </label>
      )}

      <ul className="space-y-1.5">
        {usables.map((benefit) => (
          <li key={benefit.id} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{benefit.nombre}</p>
              <p className="text-xs text-muted-foreground">
                {effectOf(benefit).label}
                {benefit.usesLeft > 0 && ` · ${benefit.usesLeft} uso(s)`}
              </p>
            </div>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void canjear(benefit)}>
              Canjear
            </Button>
          </li>
        ))}
        {bloqueados.map((benefit) => (
          <li key={benefit.id} className="flex items-center justify-between gap-3 opacity-60">
            <div className="min-w-0">
              <p className="truncate text-sm">{benefit.nombre}</p>
              <p className="text-xs text-muted-foreground">{reasonMessage(benefit.reason)}</p>
            </div>
            <Badge variant="outline" className="text-[10px]">No disponible</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}
