import "server-only";
import { tenantFindOne, tenantQuery, tenantUpdate, TenantError } from "@/lib/tenant";
import { refId } from "@/lib/types";
import type { Company } from "@/lib/types";
import { projectRows } from "@/lib/field-projection";
import { writeAudit } from "@/lib/audit";
import { notify } from "@/lib/notify-service";
import { assertPayloadVehicleUsable } from "@/lib/flota-service";
import { assertPayloadSinChoque } from "@/lib/choque-de-recurso";
import { vehicleLabel } from "@/lib/dispatch";
import {
  vetoDeAsignacion, payloadDeAsignacion, TABLA_DEL_TIPO,
  CAMPOS_QUE_ASIGNA_EL_PROVEEDOR, CAMPOS_DE_PERSONAL,
  type TipoDeServicio,
} from "@/lib/asignacion-proveedor";

/**
 * LA ESCRITURA DEL PROVEEDOR SOBRE SU PROPIO SERVICIO.
 *
 * El QUÉ y el CUÁNDO los decide el módulo puro; aquí se decide el DE QUIÉN, que
 * exige leer de la base: de quién es la fila y de quién es la guagua.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LAS COMPROBACIONES SE REUSAN, NO SE REESCRIBEN
 *
 * Los papeles del vehículo los contesta `assertPayloadVehicleUsable` (8.6) y el
 * choque de agenda `assertPayloadSinChoque` — los mismos que corren cuando
 * escribe la operadora. Una copia «para el portal» sería la versión floja de la
 * misma regla, y la floja es la que se queda sin actualizar.
 */

export interface FlotaDelProveedor {
  vehicles: { _id: string; etiqueta: string; capacity: number | null }[];
  staff: { _id: string; nombre: string; tipo: string | null }[];
}

const nombreDePersona = (s: Record<string, unknown>): string =>
  String(s.full_name || "").trim() || "Sin nombre";

/**
 * Su flota: lo que puede poner en un servicio.
 *
 * Se filtra por `supplier_id` en la consulta y ADEMÁS se recorta con la lista
 * blanca del actor. El filtro decide qué filas; el recorte, qué columnas — y esa
 * segunda mitad importa porque `vehicle` y `staff` llevan tarifa diaria dentro.
 *
 * Solo lo ACTIVO: ofrecerle una guagua dada de baja en el desplegable es
 * invitarle a asignarla y que la escritura la rechace después.
 */
export async function flotaDelProveedor(
  companyId: string,
  supplierId: string
): Promise<FlotaDelProveedor> {
  const actor = { role: "supplier" as const, supplierId };
  const [vehiculos, personal] = await Promise.all([
    tenantQuery<Record<string, unknown>>(companyId, "vehicle", {
      _filter: { supplier: supplierId, status: "active" },
      _sort: { name: "asc" }, _limit: 200,
    }),
    tenantQuery<Record<string, unknown>>(companyId, "staff", {
      _filter: { supplier: supplierId, status: "active" },
      _sort: { full_name: "asc" }, _limit: 200,
    }),
  ]);

  return {
    vehicles: projectRows("vehicle", actor, vehiculos).map((v) => ({
      _id: String(v._id ?? ""),
      etiqueta: vehicleLabel(v as never),
      capacity: typeof v.capacity === "number" ? v.capacity : null,
    })),
    staff: projectRows("staff", actor, personal).map((s) => ({
      _id: String(s._id ?? ""),
      nombre: nombreDePersona(s),
      tipo: typeof s.staff_type === "string" ? s.staff_type : null,
    })),
  };
}

export interface EntradaDeAsignacion {
  tipo: TipoDeServicio;
  id: string;
  vehicle?: unknown;
  staff?: unknown;
  driver?: unknown;
  guide?: unknown;
}

export interface ResultadoDeAsignacion {
  _id: string;
  tipo: TipoDeServicio;
  asignado: Record<string, string | null>;
}

const hoyEn = (ahora: Date) => ahora.toISOString().slice(0, 10);

/**
 * Comprueba que cada identificador que llega es de SU flota.
 *
 * Se lee la ficha y se compara su `supplier_id`, en vez de confiar en que el
 * desplegable solo ofreciera las suyas: el desplegable lo pinta el navegador y
 * cualquiera puede mandar otro identificador. Sin esto, un transportista podía
 * asignar la guagua de la competencia a su propio servicio — y quien lo
 * descubriría es el chofer de la competencia, el día del viaje.
 */
async function assertEsDeSuFlota(
  companyId: string,
  supplierId: string,
  tabla: "vehicle" | "staff",
  id: string
): Promise<void> {
  const ficha = await tenantFindOne<Record<string, unknown>>(companyId, tabla, id).catch(() => null);
  if (!ficha) {
    throw new TenantError(tabla === "vehicle" ? "Ese vehículo no existe" : "Esa persona no existe", 404);
  }
  if (refId(ficha.supplier) !== supplierId) {
    throw new TenantError(
      tabla === "vehicle" ? "Ese vehículo no es de tu flota" : "Esa persona no es de tu plantilla",
      403
    );
  }
}

/**
 * El proveedor pone su vehículo y su gente en un servicio suyo.
 *
 * Las comprobaciones van EN ESTE ORDEN y no es indiferente:
 *
 *  1. La fila es suya —si no, no hay nada más que decirle—.
 *  2. Todavía se puede asignar.
 *  3. Lo que pone es suyo.
 *  4. Los papeles del vehículo, contra el día del servicio.
 *  5. El choque de agenda.
 *
 * Empezar por los papeles habría contestado «el seguro está vencido» sobre una
 * guagua ajena, que es contarle algo de otra empresa.
 */
export async function asignarFlotaDeProveedor(
  ctx: { companyId: string; company?: Company | null; supplierId?: string | null; userId?: string | null; email?: string | null },
  entrada: EntradaDeAsignacion,
  ahora: Date = new Date()
): Promise<ResultadoDeAsignacion> {
  const supplierId = ctx.supplierId;
  if (!supplierId) throw new TenantError("Tu cuenta no está vinculada a un proveedor", 403);

  const tabla = TABLA_DEL_TIPO[entrada.tipo];
  if (!tabla) throw new TenantError("Tipo de servicio desconocido", 400);

  const fila = await tenantFindOne<Record<string, unknown>>(ctx.companyId, tabla, entrada.id);
  // De quién es la fila lo decide `supplier_id`, no el rango: sin esto, el
  // portal serviría para asignar flota a los servicios de cualquier otro
  // transportista de la misma operadora.
  if (refId(fila.supplier) !== supplierId) {
    throw new TenantError("Este servicio no es tuyo", 403);
  }

  const veto = vetoDeAsignacion(fila as never, hoyEn(ahora));
  if (veto) throw new TenantError(veto.mensaje, veto.status);

  const payload = payloadDeAsignacion(entrada.tipo, entrada as unknown as Record<string, unknown>);
  if (Object.keys(payload).length === 0) {
    throw new TenantError("No mandaste nada que asignar", 400);
  }

  const dePersonal = new Set(CAMPOS_DE_PERSONAL[tabla] ?? []);
  for (const campo of CAMPOS_QUE_ASIGNA_EL_PROVEEDOR[tabla] ?? []) {
    const id = payload[campo] === undefined ? null : refId(payload[campo]);
    // `null` es «quítalo», y quitar no necesita dueño.
    if (!id) continue;
    await assertEsDeSuFlota(ctx.companyId, supplierId, dePersonal.has(campo) ? "staff" : "vehicle", id);
  }

  // Las dos mismas comprobaciones que corren cuando escribe la operadora.
  await assertPayloadVehicleUsable(ctx.companyId, tabla, payload, entrada.id);
  await assertPayloadSinChoque(ctx.company ?? null, ctx.companyId, tabla, payload, entrada.id);

  const actualizada = await tenantUpdate<Record<string, unknown>>(ctx.companyId, tabla, entrada.id, payload);

  const asignado: Record<string, string | null> = {};
  for (const campo of Object.keys(payload)) asignado[campo] = refId(payload[campo]) ?? null;

  await writeAudit({
    companyId: ctx.companyId, userId: ctx.userId ?? null,
    action: "supplier_fleet_assigned",
    entityType: tabla, entityId: entrada.id,
    severity: "info",
    description: `${ctx.email ?? "Un proveedor"} asignó su flota al servicio ${entrada.id}`,
    metadata: { tipo: entrada.tipo, asignado, service_date: fila.service_date ?? null },
  });

  /**
   * Y la operadora se entera. Es el punto del portal: que lo que decide el
   * transportista llegue al despacho sin una llamada de teléfono. Sin aviso, la
   * asignación existe en la base y nadie la mira hasta que sale el manifiesto.
   */
  await notify({
    companyId: ctx.companyId,
    event: "supplier_fleet_assigned",
    entityType: tabla, entityId: entrada.id,
    vars: {
      referencia: String(fila.service_date ?? entrada.id),
      detalle: Object.entries(asignado).map(([k, v]) => `${k}: ${v ?? "sin asignar"}`).join(", "),
    },
  });

  return { _id: String(actualizada._id ?? entrada.id), tipo: entrada.tipo, asignado };
}
