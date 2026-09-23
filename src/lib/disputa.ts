/**
 * LA DISPUTA DE UNA LIQUIDACIÓN. LA DECISIÓN, PURA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL ESTADO EXISTÍA Y NO SE PODÍA ALCANZAR
 *
 * `settlement.status` admite `disputed` desde la primera migración de finanzas
 * y la interfaz lo sabe traducir. Nadie podía ponerlo: no había ninguna ruta
 * que lo escribiera. Un tour center que no está de acuerdo con su corte del mes
 * llama por teléfono, y lo que pasa después no queda en ningún sitio — ni el
 * motivo, ni la fecha, ni quién se comprometió a mirarlo.
 */

/** Estados desde los que NO se puede abrir una disputa, y por qué. */
const CERRADOS: Record<string, string> = {
  void: "Esta liquidación está anulada: no hay nada que discutir",
  disputed: "Esta liquidación ya está en disputa",
};

export interface VetoDisputa {
  mensaje: string;
  status: number;
}

/**
 * ¿Se puede disputar? `null` cuando sí.
 *
 * Una liquidación PAGADA sí se puede disputar, y es el caso que más importa:
 * «me pagaste menos de lo acordado» solo se descubre cobrando. Cerrarlo al
 * pagar convertiría el pago en un finiquito unilateral.
 */
export function vetoDeDisputa(estado: string | null | undefined, motivo: string): VetoDisputa | null {
  const cerrado = CERRADOS[String(estado ?? "").toLowerCase()];
  if (cerrado) return { mensaje: cerrado, status: 409 };

  const texto = (motivo || "").trim();
  // Sin motivo, `disputed` es una etiqueta que obliga a llamar para enterarse
  // —o sea, exactamente lo que esto viene a quitar—.
  if (texto.length < 10) {
    return { mensaje: "Explica en una frase qué es lo que no cuadra", status: 400 };
  }
  return null;
}

/**
 * A QUIÉN LE TOCA RESOLVERLA.
 *
 * Por orden: quien la aprobó, quien la confirmó, y si no hay ninguno, nadie
 * —y entonces el aviso cae en la audiencia de gerencia—. Ese último caso es
 * el que hay que evitar, no el que hay que esconder: la respuesta dice si la
 * disputa tiene destinatario para que la pantalla lo pueda decir también.
 */
export function destinatarioDeDisputa(settlement: {
  approved_by?: unknown;
  confirmed_by?: unknown;
}): string | null {
  const id = (ref: unknown): string | null => {
    if (typeof ref === "string") return ref || null;
    if (ref && typeof ref === "object") {
      const fila = ref as { _id?: unknown; id?: unknown };
      const valor = fila._id ?? fila.id;
      return typeof valor === "string" ? valor : null;
    }
    return null;
  };
  return id(settlement.approved_by) ?? id(settlement.confirmed_by);
}
