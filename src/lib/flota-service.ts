import "server-only";
import { tenantFindOne, tenantQuery, TenantError } from "@/lib/tenant";
import { refId } from "@/lib/types";
import { vehicleBlock, type VehicleLike } from "@/lib/dispatch";
import { dayOf } from "@/lib/hr";

/**
 * NO SALE UNA GUAGUA SIN PAPELES.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA REGLA EXISTÍA Y NO PARABA NADA
 *
 * `vehicleBlock` está escrito, probado y usado desde 0065… para PINTAR EN ROJO
 * la mesa de despacho. Nunca impidió una escritura. El encargado que asigna
 * desde el móvil a las seis de la mañana, la pantalla genérica de recursos de
 * salida, y cualquier integración que escriba por la API: todos pasaban de
 * largo con el seguro vencido.
 *
 * Es exactamente la misma historia que la certificación del guía en 0051, y se
 * cierra en el mismo sitio y por la misma razón: **la comprobación va en la
 * escritura**, que es por donde pasa todo el mundo, y no en la pantalla, que es
 * por donde pasa quien mira.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y SE MIRA CONTRA EL DÍA DEL SERVICIO, NO CONTRA HOY
 *
 * La mesa de despacho pregunta por el día que está mirando, y para eso está
 * bien. Al escribir no: con «hoy» se puede reservar para dentro de un mes una
 * guagua cuyo seguro vence la semana que viene, y el día del viaje nadie se
 * entera hasta que la para la policía.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ NO BLOQUEA, Y ESO IMPORTA TANTO COMO LO QUE BLOQUEA
 *
 * Solo las dos tablas que DESPACHAN el vehículo: el recurso de una salida y la
 * ruta de recogida. Una incidencia, una inspección, una orden de trabajo o un
 * plan de mantenimiento también apuntan a un vehículo — y bloquearlas sería
 * absurdo: se registra una inspección sobre esa guagua PRECISAMENTE porque
 * tiene los papeles vencidos. Bloquear ahí dejaría el vehículo sin poder
 * arreglarse.
 */

/** Las tablas cuya escritura pone un vehículo a trabajar, y por qué campo. */
export const VEHICLE_DISPATCH_FIELDS: Record<string, string[]> = {
  departure_resource: ["vehicle"],
  pickup_route: ["vehicle"],
};

const hoy = () => new Date().toISOString().slice(0, 10);

/**
 * Impide despachar un vehículo con el seguro o la inspección vencidos.
 *
 * Lanza 409 y no 403, igual que la certificación: no es que al usuario le
 * falten permisos, es que la asignación no se puede hacer. Y el mensaje dice
 * QUÉ papel y de qué fecha, porque un «no se puede» sin motivo acaba en una
 * llamada de teléfono.
 */
export async function assertVehicleUsable(
  companyId: string,
  vehicleId: string,
  day: string = hoy()
): Promise<void> {
  const vehiculo = await tenantFindOne<VehicleLike>(companyId, "vehicle", vehicleId);
  const bloqueo = vehicleBlock(vehiculo, day);
  if (bloqueo) {
    throw Object.assign(new TenantError(bloqueo.reason, 409), {
      code: "VEHICLE_BLOCKED",
      kind: bloqueo.kind,
    });
  }
}

/**
 * El día contra el que se comprueban los papeles.
 *
 * El del SERVICIO, y se busca por tres sitios en orden: lo que trae el payload,
 * la salida a la que se engancha, y la fila que ya existe cuando se está
 * editando —porque una edición que solo cambia el vehículo no trae la salida—.
 *
 * Si no se puede averiguar, HOY. Es el único valor honesto: no comprobar nada
 * sería volver al estado del que venimos, y el de hoy al menos para la guagua
 * que ya tiene los papeles vencidos ahora mismo.
 */
async function diaDelServicio(
  companyId: string,
  table: string,
  payload: Record<string, unknown>,
  recordId?: string
): Promise<string> {
  const delPayload = dayOf(payload.service_date as string | undefined);
  if (delPayload) return delPayload;

  let departureId = refId(payload.departure);
  if (!departureId && recordId) {
    const actual = await tenantFindOne<Record<string, unknown>>(companyId, table, recordId);
    const suyo = dayOf(actual?.service_date as string | undefined);
    if (suyo) return suyo;
    departureId = refId(actual?.departure);
  }
  if (!departureId) return hoy();

  const [salida] = await tenantQuery<{ departure_at?: string }>(companyId, "departure", {
    _filter: { _id: departureId }, _limit: 1,
  });
  return dayOf(salida?.departure_at) ?? hoy();
}

/**
 * La comprobación para la API genérica: mira el payload, saca el vehículo que
 * se despacha y lo verifica contra el día del servicio.
 *
 * Se hace sobre el payload ya limpio, así que un campo que el recurso no acepta
 * nunca llega hasta aquí. Y va en el crear Y en el editar: sin la segunda,
 * bastaba con crear el recurso vacío y asignarle el vehículo un segundo después
 * para saltarse el bloqueo entero — que es la lección que dejó 0051.
 */
export async function assertPayloadVehicleUsable(
  companyId: string,
  table: string,
  payload: Record<string, unknown>,
  recordId?: string
): Promise<void> {
  const campos = VEHICLE_DISPATCH_FIELDS[table];
  if (!campos) return;

  const ids = campos
    .map((f) => (payload[f] === undefined ? null : refId(payload[f])))
    .filter((x): x is string => Boolean(x));
  if (ids.length === 0) return;

  const day = await diaDelServicio(companyId, table, payload, recordId);
  for (const id of new Set(ids)) {
    await assertVehicleUsable(companyId, id, day);
  }
}
