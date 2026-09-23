"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/tf/icon";

/**
 * EL AVISO DE CONDICIONES SIN ACEPTAR.
 *
 * Avisa; no tapa. Bloquear el portal entero hasta que alguien acepte pararía
 * las reservas de un tour center porque la operadora corrigió una coma en su
 * texto —un cambio de condiciones invalida la aceptación anterior, que es lo
 * que se quiere, pero no puede convertirse en un corte de servicio—.
 *
 * La operadora sí ve en la ficha del socio si están aceptadas y de qué
 * versión: la palanca para insistir es comercial, no técnica.
 */
export function CondicionesPendientes({ version }: { version: number }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);

  const aceptar = async () => {
    setEnviando(true);
    const res = await api.post<{ version: number }>("/api/portal/terms", {});
    setEnviando(false);
    if (!res.ok) {
      toast.error(res.error || "No se pudo registrar la aceptación");
      return;
    }
    toast.success("Condiciones aceptadas");
    router.refresh();
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
      <Icon name="FileText" className="size-4 shrink-0 text-amber-600" />
      <p className="flex-1 text-sm">
        {version > 1
          ? "El operador ha actualizado las condiciones comerciales. Revísalas y acéptalas."
          : "Todavía no has aceptado las condiciones comerciales de tu acuerdo."}
      </p>
      <Button size="sm" onClick={aceptar} disabled={enviando}>
        {enviando ? "Registrando…" : "Aceptar condiciones"}
      </Button>
    </div>
  );
}
