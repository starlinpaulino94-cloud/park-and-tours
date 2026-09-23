import "server-only";
import { supabaseService } from "@/lib/supabase/service";
import { tenantQuery } from "@/lib/tenant";
import { repartoDelCobro } from "@/lib/modo-de-cobro";

/**
 * LA COMISIÓN QUE EL VENDEDOR SE QUEDA EN EL ACTO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LAS DOS COSAS O NINGUNA
 *
 * El criterio del plan: «una venta con comisión retenida deja la comisión en
 * “cobrada” y el movimiento de caja, o ninguna de las dos».
 *
 * Eso NO se consigue desde aquí. El cliente de Supabase habla por HTTP y cada
 * inserción es su propia transacción: entre marcar la comisión y apuntar el
 * movimiento cabe un fallo de red, un reinicio y un despliegue. Y una
 * compensación —«si falla la segunda, deshaz la primera»— es otro par de pasos
 * que también puede quedarse a medias.
 *
 * Así que las dos inserciones viven en una función de Postgres
 * (`retain_seller_commission`, 0083) y este módulo solo la llama. Lo único que
 * se hace aquí es reunir los datos y decidir CUÁNDO llamarla.
 */

export interface RetencionPedida {
  companyId: string;
  bookingId: string;
  orderId?: string | null;
  sellerId: string;
  /** El turno abierto del vendedor. Sin turno no hay dónde apuntar la salida. */
  cashSessionId: string;
  /** El total de la venta, que es el techo de lo que se puede retener. */
  total: number;
  /** Lo que le toca de comisión. */
  comision: number;
  currency: string;
  beneficiaryName?: string | null;
  baseAmount?: number | null;
  percentage?: number | null;
  serviceDate?: string | null;
  snapshot?: unknown;
  userId?: string | null;
}

export interface RetencionHecha {
  commissionId: string;
  movementId: string;
  /** Lo retenido de verdad, que puede ser menos de lo pedido. */
  retenido: number;
  /** Lo que el cliente todavía debe y pagará al subir. */
  pendiente: number;
  /** Ya estaba: un reintento no saca el dinero otra vez. */
  yaEstaba: boolean;
}

/**
 * El turno abierto de un vendedor, si lo tiene.
 *
 * Sin turno no se puede retener, y eso es una condición de verdad y no un
 * detalle: el dinero que el vendedor se queda tiene que salir de algún arqueo,
 * o al cerrar el día nadie sabe cuánto entregó ni cuánto se quedó.
 */
export async function turnoAbiertoDe(
  companyId: string,
  sellerId: string
): Promise<string | null> {
  const [sesion] = await tenantQuery<{ _id: string }>(companyId, "cash_session", {
    _filter: { seller: sellerId, status: "open" },
    _limit: 1,
    _sort: { createdAt: "desc" },
  });
  return sesion?._id ?? null;
}

/**
 * Retiene la comisión: la comisión cobrada y su salida de caja, a la vez.
 *
 * LANZA si falla, y a propósito: al revés que el consumo de cupo —que nunca
 * tumba una venta porque un contador mal puesto no puede dejar a un cliente sin
 * reserva—, aquí lo que está en juego es que el vendedor se lleve dinero sin
 * que conste, o que conste sin que se lo lleve. Quien llama decide qué hacer
 * con el fallo, pero no puede no enterarse.
 */
export async function retenerComision(pedido: RetencionPedida): Promise<RetencionHecha> {
  // El techo lo pone la venta: con una comisión mal configurada el vendedor
  // retendría más de lo que cobró y el cliente subiría a la guagua con saldo
  // negativo. Se topa aquí, ANTES de escribir nada.
  const { retenido, pendiente } = repartoDelCobro(pedido.total, pedido.comision);
  if (retenido <= 0) {
    return { commissionId: "", movementId: "", retenido: 0, pendiente, yaEstaba: false };
  }

  const { data, error } = await supabaseService().rpc("retain_seller_commission", {
    p_org: pedido.companyId,
    p_cash_session: pedido.cashSessionId,
    p_user: pedido.userId ?? null,
    /**
     * Los datos de la comisión en UN objeto y no en trece argumentos sueltos:
     * con trece —cinco `uuid` seguidos— intercambiar dos compila, se ejecuta y
     * escribe la comisión de otro vendedor sobre otra reserva sin que nada se
     * queje.
     */
    p_commission: {
      booking_id: pedido.bookingId,
      order_id: pedido.orderId ?? null,
      seller_id: pedido.sellerId,
      beneficiary_name: pedido.beneficiaryName ?? "Vendedor",
      base_amount: pedido.baseAmount ?? pedido.total,
      percentage: pedido.percentage ?? 0,
      amount: retenido,
      currency: (pedido.currency || "usd").toLowerCase(),
      service_date: pedido.serviceDate ?? null,
      snapshot: pedido.snapshot ?? null,
    },
  });

  if (error) {
    throw Object.assign(new Error(`No se pudo retener la comisión: ${error.message}`), {
      status: 409,
      code: "RETENTION_FAILED",
    });
  }

  const salida = (data ?? {}) as { commission_id?: string; movement_id?: string; already?: boolean };
  return {
    commissionId: String(salida.commission_id ?? ""),
    movementId: String(salida.movement_id ?? ""),
    retenido,
    pendiente,
    yaEstaba: salida.already === true,
  };
}
