import "server-only";
import { tenantFindOne, tenantQuery, TenantError } from "@/lib/tenant";
import { refId } from "@/lib/types";
import {
  departureWindow, resourceWindow, routeWindow, windowsOverlap,
  assignmentIsLive, vehicleLabel, departureLabel,
  type Window, type ResourceKind,
} from "@/lib/dispatch";
import { dayOf } from "@/lib/hr";
import { companyTimeZone } from "@/lib/time";
import type { Company } from "@/lib/types";

/**
 * LA MISMA GUAGUA NO PUEDE ESTAR EN DOS SITIOS A LA VEZ.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA REGLA EXISTÍA Y NO PARABA NADA — OTRA VEZ
 *
 * `resourceConflicts` está escrito y probado desde la ola 5… para PINTAR EN ROJO
 * la mesa de despacho del día que alguien esté mirando. Nunca impidió una
 * escritura. Asignar la misma guagua a dos salidas que se pisan por la pantalla
 * genérica de recursos, desde el móvil, o por la API, funcionaba sin una queja.
 *
 * Es la misma historia que el seguro vencido en 8.6 y la certificación del guía
 * en 0051, y se cierra en el mismo sitio y por la misma razón: **la comprobación
 * va en la escritura**, que es por donde pasa todo el mundo, y no en la pantalla,
 * que es por donde pasa quien mira.
 *
 * Y peor que en 8.6: la mesa de despacho **tampoco** veía el choque cuando una
 * de las dos asignaciones era una ruta de recogida, porque construía sus usos
 * leyendo solo `departure_resource`. Eso se arregla en el dominio
 * (`usesOfDeparture`), del que esta comprobación también tira.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE NO BLOQUEA, Y ES LA MITAD DEL DISEÑO
 *
 *  · **Dos servicios el mismo día que no se pisan.** La guagua que hace el tour
 *    de las 8 y el de las 2 es la operación normal. Bloquear el día completo
 *    haría inusable la pantalla y alguien acabaría quitando la comprobación.
 *  · **El mismo recurso dos veces en LA MISMA salida.** Es una fila duplicada en
 *    la ficha, no un problema de agenda: la guagua de la recogida y la guagua de
 *    la excursión son la misma guagua haciendo el mismo servicio.
 *  · **Un choque que ya estaba ahí y no toca esta fila.** Si el día tiene un
 *    conflicto entre otras dos salidas, escribir cualquier cosa fallaría con un
 *    error que habla de algo que quien escribe no ha tocado — y no podría
 *    arreglarlo, porque para arreglarlo hay que escribir.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y SE LEE POR `service_date`, CON UN DÍA A CADA LADO
 *
 * `departure_resource` y `pickup_route` llevan la fecha del servicio en la
 * propia fila desde 0086 y 0088: se filtra por columna, no por unión. El día de
 * antes y el de después entran porque una excursión que sale a las 22:00 y dura
 * cuatro horas ocupa la guagua en dos fechas, y un choque a las 00:30 es un
 * choque igual.
 */

/** Las tablas cuya escritura ocupa un recurso, y por qué campos. */
export const CONFLICT_FIELDS: Record<string, { vehicle: string[]; staff: string[] }> = {
  departure_resource: { vehicle: ["vehicle"], staff: ["staff"] },
  pickup_route: { vehicle: ["vehicle"], staff: ["driver", "guide"] },
};

export interface ChoqueDeRecurso {
  kind: ResourceKind;
  resourceId: string;
  resourceName: string;
  /** Con qué choca, en palabras que el despacho entiende. */
  mensaje: string;
  /** La otra salida, para poder abrirla. */
  departureId: string;
}

const objeto = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const otroDia = (day: string, delta: number): string =>
  new Date(new Date(`${day}T12:00:00Z`).getTime() + delta * 86_400_000).toISOString().slice(0, 10);

/**
 * La fila tal y como va a quedar: la que hay, con el payload encima.
 *
 * Hace falta porque una edición que solo cambia el vehículo no trae ni la salida
 * ni las horas, y sin ellas no se puede calcular ninguna ventana. Calcularla
 * sobre el payload suelto habría dejado pasar exactamente el caso que más se da:
 * crear el recurso vacío y asignarle la guagua un segundo después.
 */
async function filaResultante(
  companyId: string,
  table: string,
  payload: Record<string, unknown>,
  recordId?: string
): Promise<Record<string, unknown> | null> {
  if (!recordId) return { ...payload };
  const actual = await tenantFindOne<Record<string, unknown>>(companyId, table, recordId).catch(() => null);
  if (!actual) return { ...payload };
  return { ...actual, ...payload };
}

/** La ventana que ocuparía esa fila, y el día contra el que se busca. */
function ventanaDe(
  table: string,
  fila: Record<string, unknown>,
  salida: Record<string, unknown>,
  timeZone: string
): Window | null {
  const ventana = departureWindow(salida as never);
  if (!ventana) return null;
  return table === "pickup_route"
    ? routeWindow(fila as never, ventana, timeZone)
    : resourceWindow(fila as never, ventana, timeZone);
}

/**
 * Los choques que provocaría escribir esta fila.
 *
 * Devuelve la lista en vez de lanzar, para que la pantalla pueda avisar antes de
 * guardar y la escritura pueda impedirlo con el mismo cálculo. Dos cálculos
 * distintos para «¿choca?» acabarían diciendo cosas distintas, y el que decide
 * es el de la escritura — que es el que nadie mira.
 */
export async function choquesDeLaFila(
  company: Company | null,
  companyId: string,
  table: string,
  payload: Record<string, unknown>,
  recordId?: string
): Promise<ChoqueDeRecurso[]> {
  const campos = CONFLICT_FIELDS[table];
  if (!campos) return [];

  const fila = await filaResultante(companyId, table, payload, recordId);
  if (!fila) return [];
  // Una asignación cancelada no ocupa nada: no puede chocar con nadie.
  if (!assignmentIsLive(fila as never)) return [];

  const candidatos: { kind: ResourceKind; id: string }[] = [
    ...campos.vehicle.map((f) => ({ kind: "vehicle" as const, id: refId(fila[f]) })),
    ...campos.staff.map((f) => ({ kind: "staff" as const, id: refId(fila[f]) })),
  ].filter((c): c is { kind: ResourceKind; id: string } => Boolean(c.id));
  if (candidatos.length === 0) return [];

  const departureId = refId(fila.departure);
  if (!departureId) return [];

  const salida = await tenantFindOne<Record<string, unknown>>(
    companyId, "departure", departureId, { product: true }
  ).catch(() => null);
  if (!salida) return [];

  const timeZone = companyTimeZone(company);
  const ventana = ventanaDe(table, fila, salida, timeZone);
  if (!ventana) return [];

  const dia = dayOf(salida.departure_at as string | undefined);
  if (!dia) return [];
  const fechas = { gte: otroDia(dia, -1), lte: otroDia(dia, 1) };

  /**
   * Se traen las OTRAS asignaciones de esos días, de las dos tablas.
   *
   * Filtrar además por recurso habría hecho falta una consulta por candidato y
   * por tabla —cuatro en el peor caso— y `pickup_route` guarda al conductor y al
   * guía en columnas distintas. Un día entero de asignaciones de una operadora
   * cabe de sobra, y se compara en memoria contra un conjunto de dos o tres
   * identificadores.
   */
  const [recursos, rutas] = await Promise.all([
    tenantQuery<Record<string, unknown>>(companyId, "departure_resource", {
      _filter: { service_date: fechas }, _limit: 500,
      departure: { product: true },
    }),
    tenantQuery<Record<string, unknown>>(companyId, "pickup_route", {
      _filter: { service_date: fechas }, _limit: 500,
      departure: { product: true },
    }),
  ]);

  const buscados = new Map(candidatos.map((c) => [`${c.kind}:${c.id}`, c]));
  const choques: ChoqueDeRecurso[] = [];
  const yaDicho = new Set<string>();

  const revisar = (
    otra: Record<string, unknown>,
    otraTabla: string,
    ocupa: { kind: ResourceKind; valor: unknown }[]
  ) => {
    // Es la MISMA fila que se está escribiendo: no choca consigo misma.
    if (recordId && otraTabla === table && String(otra._id ?? "") === recordId) return;
    if (!assignmentIsLive(otra as never)) return;

    const suSalida = objeto(otra.departure);
    if (!suSalida) return;
    /**
     * La misma salida no es un choque, y esto es lo que lo cierra: la guagua de
     * la recogida y la guagua de la excursión son la misma guagua haciendo el
     * mismo servicio. Sin esta línea, asignar el vehículo a la ruta de una salida
     * que ya lo tiene como recurso fallaría siempre.
     */
    if (String(suSalida._id ?? suSalida.id ?? "") === departureId) return;

    const suVentana = ventanaDe(otraTabla, otra, suSalida, timeZone);
    if (!suVentana || !windowsOverlap(ventana, suVentana)) return;

    for (const { kind, valor } of ocupa) {
      const id = refId(valor);
      if (!id) continue;
      const clave = `${kind}:${id}`;
      const buscado = buscados.get(clave);
      if (!buscado) continue;
      if (yaDicho.has(clave)) continue;
      yaDicho.add(clave);

      const recurso = objeto(valor);
      const nombre = kind === "vehicle"
        ? vehicleLabel((recurso ?? { name: id }) as never)
        : String(recurso?.full_name || "Personal");

      choques.push({
        kind, resourceId: id, resourceName: nombre,
        mensaje:
          `${nombre} ya está en «${departureLabel(suSalida as never, timeZone)}», ` +
          "que se pisa con este servicio",
        departureId: String(suSalida._id ?? suSalida.id ?? ""),
      });
    }
  };

  for (const otra of recursos) {
    revisar(otra, "departure_resource", [
      { kind: "vehicle", valor: otra.vehicle },
      { kind: "staff", valor: otra.staff },
    ]);
  }
  for (const otra of rutas) {
    revisar(otra, "pickup_route", [
      { kind: "vehicle", valor: otra.vehicle },
      { kind: "staff", valor: otra.driver },
      { kind: "staff", valor: otra.guide },
    ]);
  }

  return choques;
}

/**
 * Impide la escritura que pondría el mismo recurso en dos sitios a la vez.
 *
 * 409 y no 403, igual que los papeles del vehículo: no es que al usuario le
 * falten permisos, es que la asignación no se puede hacer. Y el mensaje nombra
 * al recurso y a la otra salida, porque un «no se puede» sin motivo acaba en una
 * llamada de teléfono — y en este caso, en quitar la comprobación.
 */
export async function assertPayloadSinChoque(
  company: Company | null,
  companyId: string,
  table: string,
  payload: Record<string, unknown>,
  recordId?: string
): Promise<void> {
  const choques = await choquesDeLaFila(company, companyId, table, payload, recordId);
  if (choques.length === 0) return;
  throw Object.assign(new TenantError(choques.map((c) => c.mensaje).join(" · "), 409), {
    code: "RESOURCE_CONFLICT",
    conflicts: choques,
  });
}
