/**
 * CÓMO GANA DINERO CADA TOUR CENTER. LA DECISIÓN, PURA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS FORMAS EXCLUYENTES QUE EL SISTEMA SOPORTABA A LA VEZ
 *
 *   COMISIÓN — vende al precio de tarifa y la operadora le reconoce un
 *              porcentaje. Lo hace el motor de comisiones.
 *   NETO     — COMPRA a un precio rebajado y revende al que quiera. Su margen
 *              ya está dentro del neto. Lo hace el motor de precios con una
 *              regla para ese socio.
 *
 * `generateCommissionsForBooking` empujaba un beneficiario de tipo socio en
 * cuanto la reserva tenía socio, sin preguntar nada más. Un socio con tarifa
 * neta cobraba su margen DOS VECES: una en el precio y otra en la liquidación.
 *
 * Y no se ve el día de la venta —las dos cifras son correctas por separado—
 * sino un mes después, cuando alguien compara la liquidación con el contrato.
 * Por eso el plan lo llamaba riesgo económico y no de datos.
 */

export type ModeloComercial = "commission" | "net";

/**
 * El modelo declarado, o el de siempre.
 *
 * `commission` por defecto porque es lo que hacía el sistema con todos los
 * socios antes de que esta columna existiera. Entender un valor desconocido
 * como `net` les quitaría la comisión a todos en el despliegue.
 */
export function modeloDe(partner: { pricing_model?: string | null } | null | undefined): ModeloComercial {
  return partner?.pricing_model === "net" ? "net" : "commission";
}

/**
 * ¿Se le liquida comisión a este socio?
 *
 * Con `net`, no: su margen ya viajó en el precio. Devolver `false` aquí es lo
 * que impide la segunda cobranza.
 */
export function devengaComision(partner: { pricing_model?: string | null } | null | undefined): boolean {
  return modeloDe(partner) === "commission";
}

/** Cómo se le dice a quien mira la ficha. */
export const MODELO_ETIQUETA: Record<ModeloComercial, string> = {
  commission: "Vende a tarifa y cobra comisión",
  net: "Compra a precio neto (no se le liquida comisión)",
};
