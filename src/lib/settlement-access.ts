import "server-only";
import { TenantError, atLeast, type TenantContext } from "@/lib/tenant";
import { refId } from "@/lib/types";

/**
 * ¿DE QUIÉN ES ESTA LIQUIDACIÓN?
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO BASTA EL RANGO
 *
 * `/api/settlements/:id/statement` pedía rango de gerencia y comprobaba la
 * empresa, nada más. Mientras solo entrara gerencia eso alcanzaba, porque quien
 * manda ve todas. En el momento en que se le abre el estado de cuenta a su
 * beneficiario —que es de lo que trata esta fase—, el rango deja de decidir
 * nada: bastaría con cambiar el identificador de la dirección para bajarse la
 * liquidación de un proveedor, con sus costes y sus retenciones dentro.
 *
 * Así que la pregunta pasa a ser de la FILA, no del rol. Y vive en un solo
 * sitio porque la hacen tres caminos —la pantalla, el PDF y, más adelante, la
 * disputa—: copiada, basta con que uno se quede atrás.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL TIPO DE BENEFICIARIO MANDA SOBRE EL IDENTIFICADOR
 *
 * Se comprueba `beneficiary_type` ANTES que el identificador. Sin eso, una
 * liquidación de proveedor con `seller_id` nulo y un vendedor sin ficha
 * vinculada —los dos nulos— habrían casado: `null === null`. Es el mismo fallo
 * que hace que «sin vendedor» no pueda significar «de cualquiera».
 */

export interface SettlementLike {
  beneficiary_type?: string | null;
  seller?: unknown;
  partner?: unknown;
  supplier?: unknown;
}

export type BeneficiaryKind = "seller" | "partner" | "supplier";

/** Quién es el beneficiario declarado de la liquidación, o null si no lo dice. */
export function beneficiaryOf(s: SettlementLike): { kind: BeneficiaryKind; id: string } | null {
  const kind = String(s.beneficiary_type ?? "").toLowerCase();
  if (kind !== "seller" && kind !== "partner" && kind !== "supplier") return null;
  const id = refId((s as Record<string, unknown>)[kind]);
  return id ? { kind: kind as BeneficiaryKind, id } : null;
}

/**
 * Deja pasar a gerencia y al beneficiario; a nadie más.
 *
 * El proveedor todavía no tiene identidad en el sistema (llega en una fase
 * posterior), así que hoy sus liquidaciones solo las abre gerencia. Se declara
 * igual para que el día que la tenga no haya que volver a razonar esto.
 */
export function assertSettlementBeneficiary(
  ctx: Pick<TenantContext, "role" | "partnerId"> & { sellerId?: string | null },
  settlement: SettlementLike
): void {
  if (atLeast(ctx.role, "manager")) return;

  const beneficiario = beneficiaryOf(settlement);
  if (!beneficiario) {
    throw new TenantError("Esta liquidación no declara a quién pertenece", 403);
  }

  /**
   * El tipo primero, el identificador después — y nunca al revés.
   *
   * Los identificadores son uuid de TABLAS DISTINTAS: comparar el de un
   * vendedor con el de un socio no tiene sentido ni aunque coincidieran. Sin
   * mirar el tipo, la comprobación sería «¿este uuid aparece en algún sitio de
   * la fila?», que es una pregunta que puede responder que sí por accidente.
   *
   * Lo de los dos nulos —una liquidación de proveedor tiene `seller_id` nulo, y
   * una cuenta sin ficha tiene `sellerId` nulo— lo cierra `beneficiaryOf`, que
   * devuelve `null` cuando la fila no trae identificador: sin beneficiario
   * declarado no se llega hasta aquí. Se dice para que nadie añada un
   * `Boolean(...)` de más creyendo que faltaba.
   */
  const propio =
    (beneficiario.kind === "seller" && beneficiario.id === ctx.sellerId) ||
    (beneficiario.kind === "partner" && beneficiario.id === ctx.partnerId);

  if (!propio) throw new TenantError("Esta liquidación no es tuya", 403);
}
