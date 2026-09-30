"use client";

import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/format";

/**
 * EL ENLACE DE CONFORMIDAD DEL PROVEEDOR, QUE NO SE PODÍA EMITIR.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TODO EL CICLO ESTABA MENOS ESTE BOTÓN
 *
 * `POST /api/proveedor/enlace` no la llamaba nadie, y es la ÚNICA forma de crear
 * la credencial. Lo que hay al otro lado sí estaba entero y enchufado: la página
 * pública `/servicio/[token]` abre el enlace sin cuenta, y su ruta acepta o
 * rechaza con él.
 *
 * O sea que el camino sin cuenta —el que existe porque la mayoría de los
 * transportistas pequeños no van a entrar a un portal con contraseña— estaba
 * construido de punta a punta y **sin manera de empezarlo**. El proveedor que no
 * tiene cuenta no podía contestar de ninguna forma, y la operadora se enteraba de
 * que no había respuesta cuando llegaba el autobús.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTE DIÁLOGO TIENE QUE DECIR
 *
 * 1. **La dirección se ve UNA vez.** En la base solo queda su huella; no hay
 *    pantalla que la vuelva a mostrar. Si se cierra sin copiarla, hay que emitir
 *    otra — y eso invalida esta.
 * 2. **Emitir revoca el anterior.** Un servicio tiene UN enlace vivo. Con dos,
 *    «de un solo uso» dejaría de ser verdad por la vía de tener dos usos.
 * 3. **Cuándo caduca**, que no es el plazo a secas: el motor lo recorta a la hora
 *    del servicio, porque un enlace que sobrevive al viaje es un enlace con el que
 *    alguien acepta el martes lo que pasó el lunes.
 */

export type TipoDeServicio = "departure_resource" | "pickup_route";

interface Emitido {
  url: string;
  expiresAt: string;
}

export function EnlaceDeRespuesta({
  tipo, servicioId, titulo, onClose,
}: {
  tipo: TipoDeServicio;
  /** `null` cierra el diálogo. */
  servicioId: string | null;
  /** Cómo se llama el servicio, para que quien lo manda sepa qué está mandando. */
  titulo: string;
  onClose: () => void;
}) {
  const [emitiendo, setEmitiendo] = useState(false);
  const [enlace, setEnlace] = useState<Emitido | null>(null);

  const cerrar = () => { setEnlace(null); onClose(); };

  const emitir = async () => {
    if (!servicioId) return;
    setEmitiendo(true);
    const res = await api.post<Emitido>("/api/proveedor/enlace", { tipo, id: servicioId });
    setEmitiendo(false);
    if (!res.ok || !res.data?.url) {
      // El motor rechaza con motivo —sin proveedor, ya contestado, fuera de
      // plazo— y ese texto es más útil que cualquiera que se ponga aquí.
      toast.error(res.error?.message || "No se pudo emitir el enlace");
      return;
    }
    setEnlace(res.data);
  };

  const copiar = async () => {
    if (!enlace) return;
    try {
      await navigator.clipboard.writeText(enlace.url);
      toast.success("Enlace copiado");
    } catch {
      // Sin permiso de portapapeles —pasa en algunos navegadores de móvil— se
      // dice qué hacer en vez de fallar en silencio.
      toast.error("Tu navegador no dejó copiar. Mantén pulsado sobre el enlace para copiarlo a mano.");
    }
  };

  return (
    <Dialog open={Boolean(servicioId)} onOpenChange={(o) => { if (!o) cerrar(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enlace de conformidad</DialogTitle>
          <DialogDescription>
            Para que el proveedor acepte o rechace <span className="font-semibold">{titulo}</span> sin
            necesidad de cuenta ni contraseña. Se le manda por WhatsApp o correo.
          </DialogDescription>
        </DialogHeader>

        {!enlace ? (
          <>
            <p className="text-sm text-muted-foreground">
              Al emitirlo, cualquier enlace anterior de este servicio <span className="font-semibold">deja
              de valer</span>: solo hay uno vivo a la vez. La dirección se muestra una sola vez.
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={cerrar}>Cancelar</Button>
              <Button onClick={emitir} disabled={emitiendo}>
                {emitiendo ? "Emitiendo…" : "Emitir enlace"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            {/* La dirección, una sola vez: en la base solo queda su huella. */}
            <div className="space-y-2 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4">
              <p className="text-sm font-semibold">Cópialo ahora: no se vuelve a mostrar</p>
              <code className="block break-all rounded-lg bg-background p-3 font-mono text-xs">{enlace.url}</code>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={copiar}>
                  <Icon name="Copy" className="size-3.5" /> Copiar
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={`https://wa.me/?text=${encodeURIComponent(
                    `Confirma el servicio ${titulo}: ${enlace.url}`
                  )}`} target="_blank" rel="noreferrer">
                    <Icon name="Send" className="size-3.5" /> Mandar por WhatsApp
                  </a>
                </Button>
              </div>
              <p className="tf-num text-xs text-muted-foreground">
                Caduca el {formatDateTime(enlace.expiresAt)} — o antes, si el servicio sale antes.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={cerrar}>Listo</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
