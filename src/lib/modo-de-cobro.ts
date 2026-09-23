/**
 * QUIÉN SE QUEDA EL DINERO ENTRE LA VENTA Y EL SERVICIO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TRES MODOS, Y EL SISTEMA SOLO CONOCÍA UNO
 *
 *  · **`operator_collects`** — paga todo el cliente al operador. Es lo que hace
 *    hoy el sistema con absolutamente todas las ventas: el cobro entra, el
 *    recibo sale, y la comisión del canal se liquida después.
 *  · **`pos_collects`** — cobra el punto de venta y DEBE el neto. El tour
 *    center se queda el dinero del turista en su mostrador y a la operadora le
 *    debe el precio neto. Su efectivo no es de la operadora ni un día.
 *  · **`seller_retains`** — el vendedor retiene su comisión como depósito y el
 *    cliente paga el resto al subir a la guagua. Es como trabaja el promotor de
 *    playa: cobra su parte en el momento y entrega al cliente con un saldo.
 *
 * Sin declararlo, los tres se parecen bastante en la pantalla de cobro y se
 * distinguen un mes después, cuando alguien intenta cuadrar qué se cobró, quién
 * lo tiene y a quién se le debe.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DÓNDE VIVE CADA UNO, Y POR QUÉ NO EN UN SOLO SITIO
 *
 * Los dos primeros son del CONTRATO con el tour center, así que van en la
 * relación comercial, al lado de `pricing_model` (0078) y `payment_mode`
 * (0080): la misma agencia puede cobrar ella con una operadora y no con otra.
 *
 * El tercero es de la PERSONA: un promotor retiene y el cajero del mostrador
 * no, trabajando los dos para la misma operadora. Va en su ficha de vendedor.
 *
 * Y la VENTA guarda el que se le aplicó. Es la lección de la cancelación del
 * monedero (6.6): un contrato que cambia entre la venta y el cobro dejaría el
 * dinero movido bajo un modo y la liquidación calculada con otro.
 *
 * Todo lo de aquí es puro.
 */

export const MODOS_DE_COBRO = ["operator_collects", "pos_collects", "seller_retains"] as const;
export type ModoDeCobro = (typeof MODOS_DE_COBRO)[number];

export const MODO_DE_COBRO_ETIQUETA: Record<ModoDeCobro, string> = {
  operator_collects: "El cliente paga todo al operador",
  pos_collects: "Cobra el punto de venta y debe el neto",
  seller_retains: "El vendedor retiene su comisión; el cliente paga el resto al subir",
};

function limpio(valor: unknown): ModoDeCobro | null {
  const v = typeof valor === "string" ? valor.trim() : "";
  return (MODOS_DE_COBRO as readonly string[]).includes(v) ? (v as ModoDeCobro) : null;
}

export interface ContratoDeCobro {
  /** De la relación comercial, cuando la venta es de un tour center. */
  relacion?: { collection_mode?: string | null } | null;
  /** De la ficha, cuando la venta la cierra un vendedor. */
  vendedor?: { collection_mode?: string | null } | null;
}

/**
 * El modo que se le aplica a esta venta.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL ORDEN IMPORTA, Y ES EL CONTRARIO DEL QUE PARECE
 *
 * Manda el CONTRATO DEL SOCIO por encima de la ficha del vendedor. Un vendedor
 * de un tour center que retiene puede existir, pero mientras el contrato diga
 * que cobra el punto de venta, el dinero es del mostrador y no suyo: dejar que
 * su ficha gane haría que retuviera de un dinero que la operadora nunca va a
 * ver pasar.
 *
 * La ficha del vendedor solo decide cuando NO hay contrato de socio mandando —
 * que es el caso del promotor de la propia operadora.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y LO DESCONOCIDO ES «PAGA EL CLIENTE AL OPERADOR»
 *
 * Es lo que hace hoy el sistema con todas las ventas. Cualquier otra lectura
 * del hueco cambiaría de golpe, el día del despliegue, dónde está el dinero de
 * todas las ventas existentes.
 */
export function modoDeCobro(contrato: ContratoDeCobro | null | undefined): ModoDeCobro {
  const delSocio = limpio(contrato?.relacion?.collection_mode);
  // `operator_collects` en el contrato es una declaración, no un hueco: si el
  // socio dice que cobra la operadora, la ficha del vendedor no lo cambia.
  if (delSocio) return delSocio;
  return limpio(contrato?.vendedor?.collection_mode) ?? "operator_collects";
}

/** ¿El dinero del turista se queda en el mostrador del socio? */
export function cobraElPuntoDeVenta(modo: ModoDeCobro): boolean {
  return modo === "pos_collects";
}

/** ¿El vendedor se queda su comisión en el acto? */
export function elVendedorRetiene(modo: ModoDeCobro): boolean {
  return modo === "seller_retains";
}

export interface RepartoDelCobro {
  /** Lo que el vendedor retiene en el acto, como depósito. */
  retenido: number;
  /** Lo que el cliente todavía debe y pagará al subir. */
  pendiente: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Cuánto retiene el vendedor y cuánto queda por cobrar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA COMISIÓN NUNCA PASA DEL TOTAL
 *
 * Con una comisión mal configurada —un porcentaje de más, una regla fija por
 * encima del precio— el vendedor retendría más de lo que cobró y el cliente
 * subiría a la guagua con saldo NEGATIVO, es decir, con dinero a devolver por
 * una excursión que aún no ha hecho. Se topa en el total y la diferencia se ve
 * en la comisión, que es donde está el error.
 */
export function repartoDelCobro(total: number, comision: number): RepartoDelCobro {
  const importe = round2(Math.max(num(total), 0));
  const retenido = round2(Math.min(Math.max(num(comision), 0), importe));
  return { retenido, pendiente: round2(importe - retenido) };
}
