"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/tf/icon";

/**
 * El botón que se lleva los datos.
 *
 * Es una descarga que puede tardar medio minuto —recorre ochenta y ocho
 * tablas—, así que el botón dice lo que está pasando mientras pasa. Sin eso, la
 * reacción normal es volver a pulsarlo, y el tercer intento choca con el límite
 * de tres por hora justo cuando el primero iba a terminar.
 */
export function DescargarTodo({ filename }: { filename: string }) {
  const [busy, setBusy] = useState(false);

  const descargar = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/export/company", { credentials: "same-origin" });
      if (!res.ok) {
        // El éxito es un ZIP; el error sigue siendo JSON.
        const detail = await res.json().catch(() => null);
        toast.error(detail?.error?.message || "No se pudo preparar la exportación");
        return;
      }
      const registros = Number(res.headers.get("X-Row-Count") || 0);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`${registros.toLocaleString("es-DO")} registros en tu equipo`);
    } catch {
      toast.error("Se interrumpió la descarga. Vuelve a intentarlo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <Button onClick={descargar} disabled={busy} size="lg">
        <Icon name={busy ? "LoaderCircle" : "Download"} className={busy ? "size-4 animate-spin" : "size-4"} />
        {busy ? "Preparando tu archivo…" : "Descargar todos mis datos"}
      </Button>
      <p className="text-xs text-muted-foreground">
        {busy
          ? "Puede tardar hasta un minuto. No cierres esta pestaña."
          : "Un archivo ZIP con un CSV por tabla. Se prepara en el momento."}
      </p>
    </div>
  );
}
