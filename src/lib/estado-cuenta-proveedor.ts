import "server-only";
import { supabaseService } from "@/lib/supabase/service";
import { mustRead } from "@/lib/supabase/io";
import { tenantQuery, TenantError, esDeProveedor, type TenantContext } from "@/lib/tenant";
import { projectRows } from "@/lib/field-projection";
import { writeAudit } from "@/lib/audit";
import { notify } from "@/lib/notify-service";
import { validarNcf } from "@/lib/ncf";
import {
  vetoDeAceptacion, vetoDeFactura, accionesPara,
  type AccionesDelProveedor,
} from "@/lib/conformidad-proveedor";

/**
 * EL ESTADO DE CUENTA DEL PROVEEDOR.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE SUSTITUYE
 *
 * Hoy el transportista se entera de su corte porque alguien se lo dice por
 * teléfono o le manda un PDF por WhatsApp. Si no está de acuerdo, llama; y de
 * esa llamada no queda nada. Si tiene que facturar, dicta el número de
 * comprobante y lo teclea otra persona — y un dígito de más en un NCF es un
 * 606 rechazado semanas después.
 *
 * Las tres cosas —verlo, contestarlo y facturarlo— son la misma conversación,
 * así que viven en la misma pantalla.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y EL ÁMBITO NO SE DECIDE AQUÍ
 *
 * De quién es una liquidación lo dice `assertSettlementBeneficiary` desde la
 * fase 2, y por ahí pasan la pantalla, el PDF y la disputa. Lo que este módulo
 * añade son las dos ESCRITURAS que el proveedor puede hacer, con su identidad
 * dentro de la sentencia.
 */

export interface LiquidacionDelProveedor {
  _id: string;
  code: string | null;
  period_from: string | null;
  period_to: string | null;
  currency: string;
  status: string;
  net_total: number;
  pending_total: number;
  paid_at: string | null;
  accepted_at: string | null;
  disputed_at: string | null;
  dispute_reason: string | null;
  supplier_ncf: string | null;
  supplier_invoice_number: string | null;
  /** Lo que la pantalla puede ofrecerle, decidido en el servidor. */
  acciones: AccionesDelProveedor;
}

const numero = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

/**
 * Sus liquidaciones, de la más reciente a la más vieja.
 *
 * Se acota por columna —`settlement.supplier_id` existe desde 0040—, así que
 * por primera vez en toda la fase no hubo que desnormalizar nada.
 */
export async function liquidacionesDeProveedor(
  companyId: string,
  supplierId: string,
  limite = 60
): Promise<LiquidacionDelProveedor[]> {
  const crudas = await tenantQuery<Record<string, unknown>>(companyId, "settlement", {
    _filter: { supplier: supplierId, beneficiary_type: "supplier" },
    _sort: { issued_at: "desc" },
    _limit: limite,
  });

  /**
   * El recorte va ANTES del mapeo, como en 0086: el mapeo de abajo elige a
   * mano, pero es una lista escrita por una persona. Pasando las filas por la
   * lista blanca del actor primero, un campo prohibido llega ya borrado.
   */
  const actor = { role: "supplier" as const, supplierId };
  return projectRows("settlement", actor, crudas).map((fila) => ({
    _id: String(fila._id ?? ""),
    code: texto(fila.code),
    period_from: texto(fila.period_from),
    period_to: texto(fila.period_to),
    currency: String(fila.currency || "usd").toLowerCase(),
    status: String(fila.status || "pending"),
    net_total: numero(fila.net_total),
    pending_total: numero(fila.pending_total),
    paid_at: texto(fila.paid_at),
    accepted_at: texto(fila.accepted_at),
    disputed_at: texto(fila.disputed_at),
    dispute_reason: texto(fila.dispute_reason),
    supplier_ncf: texto(fila.supplier_ncf),
    supplier_invoice_number: texto(fila.supplier_invoice_number),
    acciones: accionesPara(fila as { status?: string | null }),
  }));
}

/* ═══════════════════════════════════════════ las dos escrituras del proveedor */

interface Cabecera {
  id: string;
  status: string | null;
  accepted_at: string | null;
  supplier_ncf: string | null;
  supplier_id: string | null;
}

const COLUMNAS = "id,status,accepted_at,supplier_ncf,supplier_id";

/**
 * La liquidación, comprobando que es SUYA.
 *
 * El proveedor solo llega a las suyas; el personal interno con rango puede
 * actuar en nombre de cualquiera —registrar por teléfono la conformidad de
 * quien no usa el portal—, y queda a su nombre en la bitácora.
 */
async function cabeceraDe(
  ctx: TenantContext & { companyId: string },
  settlementId: string
): Promise<Cabecera> {
  const fila = await mustRead<Cabecera>(
    "leer la liquidación",
    supabaseService().from("settlement").select(COLUMNAS)
      .eq("id", settlementId).eq("organization_id", ctx.companyId).limit(1).maybeSingle()
  );
  if (!fila) throw new TenantError("Esa liquidación no existe", 404);
  if (esDeProveedor(ctx) && (!ctx.supplierId || fila.supplier_id !== ctx.supplierId)) {
    throw new TenantError("Esta liquidación no es tuya", 403);
  }
  return fila;
}

export interface Conformidad {
  id: string;
  accepted_at: string;
}

/**
 * «Esto está bien.»
 *
 * Es la otra mitad de la disputa, y la que faltaba: sin ella, el silencio de un
 * proveedor y su acuerdo se parecen demasiado — y una liquidación aceptada se
 * paga sin volver a preguntar, mientras que una que nadie contestó es una
 * llamada pendiente.
 */
export async function aceptarLiquidacion(
  ctx: TenantContext & { companyId: string },
  settlementId: string,
  ahora: Date = new Date()
): Promise<Conformidad> {
  const cabecera = await cabeceraDe(ctx, settlementId);
  const veto = vetoDeAceptacion(cabecera);
  if (veto) throw new TenantError(veto.mensaje, veto.status);

  const marcado = ahora.toISOString();
  /**
   * UNA sentencia, con la condición dentro. `accepted_at is null` en el WHERE
   * y no en un `if`: dos toques del botón no son dos conformidades, y entre
   * leer y escribir cabe una disputa que llegó por otro lado.
   */
  const filas = await mustRead<{ id: string }[]>(
    "registrar la conformidad",
    supabaseService().from("settlement")
      .update({ accepted_at: marcado, accepted_by: ctx.userId ?? null })
      .eq("id", settlementId)
      .eq("organization_id", ctx.companyId)
      .is("accepted_at", null)
      .neq("status", "void")
      .neq("status", "disputed")
      .select("id")
  );
  if (!filas || filas.length === 0) {
    throw new TenantError("Esta liquidación ya no admite conformidad", 409);
  }

  await writeAudit({
    companyId: ctx.companyId,
    userId: ctx.userId,
    action: "settlement.accepted",
    entityType: "settlement",
    entityId: settlementId,
    description: "El beneficiario dio su conformidad a la liquidación",
    metadata: { supplier_id: cabecera.supplier_id, via: esDeProveedor(ctx) ? "portal" : "operadora" },
  });

  /**
   * NO avisa a nadie, y es deliberado. Un aviso por cada conformidad convierte
   * la campana en ruido y a la semana nadie la abre; lo que hay que mirar es el
   * desacuerdo, que ya avisa desde 0076. La conformidad se ve en la pantalla de
   * liquidaciones, que es donde se está cuando importa.
   */
  return { id: settlementId, accepted_at: marcado };
}

export interface FacturaRegistrada {
  id: string;
  ncf: string;
  tipo: string;
  numero: string | null;
}

/**
 * La factura del proveedor, con el número que la DGII va a leer.
 *
 * El NCF se valida ANTES de escribirlo: un dígito de más es un 606 rechazado
 * semanas después, cuando ya nadie se acuerda de qué factura era. Y el TIPO
 * sale del propio número en vez de preguntarse aparte — con dos campos, un
 * formulario admite que digan cosas distintas.
 */
export async function registrarFacturaDeProveedor(
  ctx: TenantContext & { companyId: string },
  settlementId: string,
  entrada: { ncf: string; numero?: string | null },
  ahora: Date = new Date()
): Promise<FacturaRegistrada> {
  const cabecera = await cabeceraDe(ctx, settlementId);
  const veto = vetoDeFactura(cabecera);
  if (veto) throw new TenantError(veto.mensaje, veto.status);

  const validado = validarNcf(entrada.ncf);
  if (!validado.ok) throw new TenantError(validado.mensaje ?? "NCF inválido", 400);

  const filas = await mustRead<{ id: string }[]>(
    "registrar la factura del proveedor",
    supabaseService().from("settlement")
      .update({
        supplier_ncf: validado.ncf,
        supplier_ncf_type: validado.tipo,
        supplier_invoice_number: (entrada.numero || "").trim() || null,
        supplier_invoice_at: ahora.toISOString(),
        supplier_invoice_by: ctx.userId ?? null,
      })
      .eq("id", settlementId)
      .eq("organization_id", ctx.companyId)
      .is("supplier_ncf", null)
      .select("id")
  );
  if (!filas || filas.length === 0) {
    /**
     * O llegó otra antes, o el índice único rechazó el número por repetido. Lo
     * segundo importa: el mismo NCF del mismo proveedor dos veces solo puede
     * ser la misma factura contada dos veces, y eso se paga dos veces.
     */
    throw new TenantError(
      "No se pudo registrar esa factura. Comprueba que el NCF no esté ya usado en otra liquidación",
      409
    );
  }

  await writeAudit({
    companyId: ctx.companyId,
    userId: ctx.userId,
    action: "settlement.supplier_invoice",
    entityType: "settlement",
    entityId: settlementId,
    description: `Factura del proveedor registrada (${validado.ncf})`,
    metadata: { supplier_id: cabecera.supplier_id, ncf: validado.ncf, tipo: validado.tipo },
  });

  // Esta SÍ avisa: alguien de administración tiene que registrar la compra, y
  // sin aviso el comprobante se queda en la liquidación sin llegar al 606.
  await notify({
    companyId: ctx.companyId,
    event: "supplier_invoice_received",
    entityType: "settlement",
    entityId: settlementId,
    vars: { referencia: validado.ncf, proveedor: await nombreDeProveedor(ctx.companyId, cabecera.supplier_id) },
  });

  return {
    id: settlementId,
    ncf: validado.ncf,
    tipo: validado.tipo ?? "",
    numero: (entrada.numero || "").trim() || null,
  };
}

async function nombreDeProveedor(companyId: string, supplierId: string | null): Promise<string | null> {
  if (!supplierId) return null;
  const fila = await mustRead<{ name: string | null }>(
    "leer el nombre del proveedor",
    supabaseService().from("supplier").select("name")
      .eq("id", supplierId).eq("organization_id", companyId).limit(1).maybeSingle()
  );
  return fila?.name ?? null;
}
