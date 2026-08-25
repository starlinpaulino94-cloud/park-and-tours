"use client";

import { useEffect, useState } from "react";
import { dueLabel, humanizeElapsed } from "@/lib/time";

const REFRESH_MS = 60_000;

/**
 * Etiqueta temporal que se mantiene al día sin recargar la pantalla.
 *
 * El servidor calcula el texto inicial en la zona horaria de la empresa, así
 * que el primer render coincide exactamente con el HTML servido y no hay
 * desajuste de hidratación. A partir del montaje, el componente recalcula cada
 * minuto con las MISMAS funciones puras de `@/lib/time`, de modo que una tarea
 * no se queda diciendo "Vence en 1 min" durante media hora.
 *
 * La zona horaria viaja como una cadena: es configuración de la empresa, no un
 * dato de identidad del usuario.
 */
export function RelativeTime({
  kind, iso, timeZone, initial, className,
}: {
  /** `due`: etiqueta de vencimiento. `elapsed`: tiempo transcurrido. */
  kind: "due" | "elapsed";
  iso: string | null;
  timeZone: string;
  initial: string;
  className?: string;
}) {
  const [label, setLabel] = useState(initial);

  useEffect(() => {
    // El texto del servidor es válido en el instante del render; solo hace
    // falta recalcular si la fecha existe y la etiqueta puede envejecer.
    if (!iso) return;

    const compute = () =>
      kind === "due"
        ? dueLabel(iso, new Date(), timeZone)
        : humanizeElapsed(iso, new Date()).replace(/^hace /, "");

    setLabel(compute());
    const timer = setInterval(() => setLabel(compute()), REFRESH_MS);
    return () => clearInterval(timer);
  }, [kind, iso, timeZone]);

  return <span className={className}>{label}</span>;
}
