/**
 * QUÉ PUEDE HACER EL PROVEEDOR CON SU CORTE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ACEPTAR ES LA OTRA MITAD DE DISPUTAR
 *
 * `disputed` se puede poner desde 0076: el beneficiario dice «esto no cuadra» y
 * queda el motivo, la fecha y a quién le toca mirarlo. Lo que no se podía poner
 * es lo contrario —«esto está bien»—, y sin eso el silencio de un proveedor y
 * su conformidad se parecen demasiado.
 *
 * No son lo mismo y la diferencia es dinero: una liquidación aceptada se paga
 * sin volver a preguntar; una que nadie contestó es una llamada pendiente.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y ACEPTAR NO ES APROBAR
 *
 * `approved_at` es la operadora diciendo «esto es lo que pago». `accepted_at`
 * es el proveedor diciendo «de acuerdo». Confundirlas convierte una aprobación
 * interna en un finiquito firmado por quien no lo firmó.
 */

export type EstadoDeLiquidacion =
  | "pending" | "approved" | "partially_paid" | "paid" | "held" | "disputed" | "void";

export interface LiquidacionParaElProveedor {
  status?: string | null;
  accepted_at?: string | null;
  supplier_ncf?: string | null;
  paid_at?: string | null;
}

export type VetoDeConformidad = { mensaje: string; status: number };

/**
 * ¿Puede aceptarla? `null` cuando sí.
 *
 * Una liquidación ANULADA no: no hay nada que aceptar. Una en DISPUTA tampoco
 * —primero se resuelve la disputa, o la conformidad taparía el desacuerdo sin
 * resolverlo—. Y una ya aceptada no se vuelve a aceptar, que no es un error
 * pero tampoco es una acción: se dice y ya está.
 *
 * Una PAGADA sí se puede aceptar, igual que se puede disputar: «me pagaste lo
 * correcto» es una conformidad que llega después del pago, y cerrarla sería
 * convertir el pago en un finiquito unilateral — la misma razón por la que
 * `vetoDeDisputa` deja disputar lo ya pagado.
 */
export function vetoDeAceptacion(liq: LiquidacionParaElProveedor): VetoDeConformidad | null {
  const estado = String(liq.status ?? "").toLowerCase();
  if (estado === "void") return { mensaje: "Esta liquidación está anulada: no hay nada que aceptar", status: 409 };
  if (estado === "disputed") {
    return { mensaje: "Esta liquidación está en disputa. Primero hay que resolverla", status: 409 };
  }
  if (liq.accepted_at) return { mensaje: "Ya diste tu conformidad a esta liquidación", status: 409 };
  return null;
}

/**
 * ¿Puede registrar su factura? `null` cuando sí.
 *
 * Una vez registrada NO se puede cambiar desde el portal. Un NCF es un
 * documento fiscal emitido: corregirlo no es editar un campo, es emitir una
 * nota de crédito y otra factura. Dejar que se sobrescriba haría que el 606 de
 * la operadora dijera un número y el papel del proveedor otro — y el que se
 * queda con el problema es quien declara.
 */
export function vetoDeFactura(liq: LiquidacionParaElProveedor): VetoDeConformidad | null {
  const estado = String(liq.status ?? "").toLowerCase();
  if (estado === "void") return { mensaje: "Esta liquidación está anulada", status: 409 };
  if (liq.supplier_ncf) {
    return {
      mensaje: "Ya registraste una factura para esta liquidación. Si el número es incorrecto, habla con la operadora",
      status: 409,
    };
  }
  return null;
}

export interface AccionesDelProveedor {
  aceptar: boolean;
  disputar: boolean;
  facturar: boolean;
}

/**
 * Lo que la pantalla puede ofrecerle, calculado una vez.
 *
 * La pantalla NO decide: pregunta. Si cada botón tuviera su propia condición
 * escrita en el navegador, el día que cambie una regla habría que acordarse de
 * cambiarla en dos sitios — y el que se quede viejo es el que enseña un botón
 * que el servidor rechaza.
 */
export function accionesPara(liq: LiquidacionParaElProveedor): AccionesDelProveedor {
  const estado = String(liq.status ?? "").toLowerCase();
  return {
    aceptar: vetoDeAceptacion(liq) === null,
    // Disputar lo decide `vetoDeDisputa`, que es de donde sale la regla para
    // socio y proveedor por igual; aquí solo se anticipa para pintar el botón.
    disputar: estado !== "void" && estado !== "disputed",
    facturar: vetoDeFactura(liq) === null,
  };
}
