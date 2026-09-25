import "server-only";
import { leerTodoElRecurso } from "@/lib/barrido";
import { tenantFindOne, tenantQuery } from "@/lib/tenant";
import { round2 } from "@/lib/commission-adjustments";
import type { Settlement, Seller } from "@/lib/types";

/**
 * EL ESTADO DE CUENTA DE UN VENDEDOR.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO SE REUTILIZA EL DEL PROVEEDOR
 *
 * Se parecen en la forma y no tienen nada que ver en el fondo. El del proveedor
 * lee `booking_cost` —lo que cuesta cada servicio operado— y lleva dentro el
 * COSTE y las retenciones fiscales; el del vendedor lee `commission` y lo que
 * lleva es el porcentaje que se le aplicó a cada venta.
 *
 * Derivar uno del otro «porque comparten columnas» habría metido el coste de la
 * empresa en el papel que se le entrega a quien vende, que es exactamente el
 * dato que el recorte de columnas existe para que no viaje. Se escriben aparte
 * a propósito: el parecido es de formato, no de contenido.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL PORCENTAJE QUE SE ENSEÑA ES EL CONGELADO
 *
 * Cada comisión guarda el `percentage` con el que se calculó, no el vigente en
 * la ficha. Enseñar el de hoy convertiría el estado de cuenta en una cifra que
 * cambia sola cuando alguien edita una regla, y ahí se acaba la conversación
 * sobre lo que se debe: nadie puede discutir un documento que se reescribe.
 */

export interface LineaComision {
  _id: string;
  /** Qué venta la generó, para poder buscarla. */
  booking_number: string | null;
  product: string | null;
  /** El día en que se vendió y el día en que se presta el servicio: no son el mismo. */
  sold_at: string | null;
  service_date: string | null;
  base_amount: number;
  percentage: number;
  amount: number;
  currency: string;
  status: string;
  /**
   * Una comisión anulada mostrada como pendiente genera más reclamaciones de
   * las que evita: se marca, no se esconde ni se suma.
   */
  anulada: boolean;
}

export interface EstadoDeCuentaVendedor {
  settlement: Settlement & Record<string, unknown>;
  seller: Seller | null;
  lines: LineaComision[];
  totals: { devengado: number; anulado: number; neto: number; lineas: number };
  currency: string;
}

const ANULADAS = new Set(["cancelled", "held", "disputed"]);

export function esAnulada(status?: string | null): boolean {
  return ANULADAS.has(String(status ?? "").toLowerCase());
}

/** Suma las líneas separando lo vivo de lo anulado. */
export function totalizar(lines: LineaComision[]) {
  let devengado = 0;
  let anulado = 0;
  for (const l of lines) {
    if (l.anulada) anulado += l.amount;
    else devengado += l.amount;
  }
  return {
    devengado: round2(devengado),
    anulado: round2(anulado),
    neto: round2(devengado),
    lineas: lines.length,
  };
}

export async function loadSellerStatement(
  companyId: string,
  settlementId: string
): Promise<EstadoDeCuentaVendedor> {
  const settlement = await tenantFindOne<Settlement & Record<string, unknown>>(
    companyId, "settlement", settlementId, { seller: true }
  );

  // El estado de cuenta del vendedor, entero: de aquí sale lo devengado y lo
  // anulado, y un total corto es una nómina corta.
  const rows = await leerTodoElRecurso<Record<string, unknown> & { _id: string }>(
    "commission", (limite, salto) => tenantQuery(companyId, "commission", {
      _filter: { settlement: settlementId },
      _sort: { service_date: "asc", _id: "asc" },
      _limit: limite, _offset: salto,
      booking: { product: true },
    }));

  const lines: LineaComision[] = rows.map((row) => {
    const booking = row.booking as { booking_number?: string; product?: { name?: string } } | null;
    return {
      _id: row._id,
      booking_number: booking?.booking_number ?? null,
      product: booking?.product?.name ?? null,
      sold_at: (row.generated_at as string) ?? (row.createdAt as string) ?? null,
      service_date: (row.service_date as string) ?? null,
      base_amount: Number(row.base_amount ?? 0),
      // El congelado, no el vigente.
      percentage: Number(row.percentage ?? 0),
      amount: Number(row.amount ?? 0),
      currency: String(row.currency || settlement.currency || "usd").toLowerCase(),
      status: String(row.status ?? "pending"),
      anulada: esAnulada(row.status as string),
    };
  });

  const sellerRef = settlement.seller;
  return {
    settlement,
    seller: sellerRef && typeof sellerRef === "object" ? (sellerRef as Seller) : null,
    lines,
    totals: totalizar(lines),
    currency: String(settlement.currency || "usd").toLowerCase(),
  };
}
