import "server-only";
import { tenantQuery } from "@/lib/tenant";
import { projectRows } from "@/lib/field-projection";
import { vehicleLabel } from "@/lib/dispatch";
import type { EstadoDeAceptacion } from "@/lib/aceptacion-proveedor";
import {
  vetoDeAsignacion, CAMPOS_QUE_ASIGNA_EL_PROVEEDOR, CAMPOS_DE_PERSONAL, TABLA_DEL_TIPO,
} from "@/lib/asignacion-proveedor";

/**
 * LOS SERVICIOS DE UN PROVEEDOR.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS TABLAS, UNA LISTA
 *
 * Un proveedor aparece en la operación por dos sitios: como RECURSO de una
 * salida —su guagua, su guía, su equipo— y como dueño de una RUTA de recogida.
 * Para él son la misma cosa: cosas que tiene que ir a hacer, con su día y su
 * hora. Devolverle dos listas le obligaría a cruzarlas de cabeza para saber qué
 * le toca mañana.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y SE FILTRA POR COLUMNA, LAS DOS VECES
 *
 * Por `supplier_id` (0085) y por `service_date` (0086), que están en la propia
 * fila. La alternativa —traerse todo y filtrar en memoria— es lo que hace hoy
 * `asset-impact.ts` con un tope de quinientas: funciona hasta la fila
 * quinientos uno, que desaparece sin que nada avise. En el portal del
 * proveedor esa fila es un servicio que alguien tiene que ir a prestar.
 */

export type VentanaDeServicios = "proximos" | "pasados";

export interface ServicioDeProveedor {
  _id: string;
  /** De cuál de las dos tablas viene. La pantalla los pinta distinto. */
  tipo: "recurso" | "ruta";
  service_date: string | null;
  /** Qué excursión, para que sepa a dónde va. */
  producto: string | null;
  /** El papel que se le pidió: conductor, guía, vehículo… o el nombre de la ruta. */
  detalle: string | null;
  punto_de_encuentro: string | null;
  pax: number | null;
  status: string | null;
  /** Lo que la operadora sabe del recurso NO es lo que él contestó (0087). */
  acceptance: EstadoDeAceptacion;
  acceptance_deadline: string | null;
  confirmation_number: string | null;
  /**
   * Lo que él mismo ha puesto: su guagua y su gente (8.9).
   *
   * Va como lista de campos y no como tres propiedades sueltas porque los campos
   * NO son los mismos en las dos tablas —un recurso tiene `staff`, una ruta tiene
   * `driver` y `guide`— y la pantalla tiene que pintar los que haya sin saber de
   * antemano cuáles son.
   */
  asignado: { campo: string; _id: string | null; etiqueta: string | null; clase: "vehicle" | "staff" }[];
  /**
   * Y si todavía puede tocarlo. Lo decide el SERVIDOR, igual que las acciones de
   * la liquidación en 8.7: con la condición escrita en el navegador, el día que
   * cambie la regla habría que acordarse de cambiarla en dos sitios — y el que se
   * quede viejo enseña un formulario que el servidor rechaza.
   */
  puede_asignar: boolean;
  motivo_para_no_asignar: string | null;
}

const LIMITE = 200;

function textoDe(valor: unknown): string | null {
  if (typeof valor === "string") return valor.trim() || null;
  if (valor && typeof valor === "object") {
    const r = valor as { name?: unknown };
    return typeof r.name === "string" ? r.name.trim() || null : null;
  }
  return null;
}

/**
 * El eje de la respuesta, igual en las dos tablas.
 *
 * Escrito una vez y no dos: son las mismas tres columnas con el mismo
 * significado, y dos copias son dos sitios donde acordarse de añadir la
 * siguiente.
 */
function respuesta(fila: Record<string, unknown>): {
  acceptance: EstadoDeAceptacion;
  acceptance_deadline: string | null;
  confirmation_number: string | null;
} {
  return {
    // Lo desconocido es lo de hoy: sin columna —o recortada— no hay nada que
    // contestar, que es como funcionaba antes de 0087.
    acceptance: (typeof fila.acceptance === "string" ? fila.acceptance : "not_required") as EstadoDeAceptacion,
    acceptance_deadline: typeof fila.acceptance_deadline === "string" ? fila.acceptance_deadline : null,
    confirmation_number: typeof fila.confirmation_number === "string" ? fila.confirmation_number : null,
  };
}

/**
 * Lo asignado, leído de la propia fila.
 *
 * `etiqueta` sale del objeto expandido, que llega ya recortado por la lista
 * blanca del proveedor: de un vehículo, su nombre y su matrícula; de una persona,
 * su nombre. Ni la tarifa diaria ni la cédula, que es lo que esas dos tablas
 * llevan al lado.
 */
function asignacionDe(
  tipo: "recurso" | "ruta",
  fila: Record<string, unknown>
): ServicioDeProveedor["asignado"] {
  const tabla = TABLA_DEL_TIPO[tipo];
  const dePersonal = new Set(CAMPOS_DE_PERSONAL[tabla] ?? []);
  return (CAMPOS_QUE_ASIGNA_EL_PROVEEDOR[tabla] ?? []).map((campo) => {
    const valor = fila[campo];
    const objeto = valor && typeof valor === "object" && !Array.isArray(valor)
      ? (valor as Record<string, unknown>) : null;
    const clase = dePersonal.has(campo) ? ("staff" as const) : ("vehicle" as const);
    const etiqueta = objeto
      ? clase === "vehicle"
        ? vehicleLabel(objeto as never)
        : String(objeto.full_name || "").trim() || null
      : null;
    return {
      campo,
      _id: objeto ? String(objeto._id ?? objeto.id ?? "") || null : (typeof valor === "string" ? valor : null),
      etiqueta,
      clase,
    };
  });
}

function fechaDe(fila: Record<string, unknown>): string | null {
  const v = fila.service_date;
  return typeof v === "string" ? v : null;
}

/**
 * Los servicios de un proveedor en una ventana de tiempo.
 *
 * `ahora` entra como parámetro y no se lee del reloj aquí: así la prueba puede
 * fijarlo, y así las dos consultas —próximos y pasados— parten del MISMO
 * instante. Con dos lecturas del reloj, un servicio que empieza justo ahora
 * cabría en las dos listas o en ninguna.
 */
export async function serviciosDeProveedor(
  companyId: string,
  supplierId: string,
  ventana: VentanaDeServicios,
  ahora: Date = new Date()
): Promise<ServicioDeProveedor[]> {
  const corte = ahora.toISOString();
  const hoy = corte.slice(0, 10);
  const rango = ventana === "proximos" ? { gte: corte } : { lt: corte };
  // Lo que viene, en orden; lo que pasó, del revés. Es como se mira cada cosa:
  // lo próximo por lo que toca antes, lo pasado por lo más reciente.
  const orden = ventana === "proximos" ? "asc" : "desc";

  const [recursosCrudos, rutasCrudas] = await Promise.all([
    tenantQuery<Record<string, unknown>>(companyId, "departure_resource", {
      _filter: { supplier: supplierId, service_date: rango },
      _sort: { service_date: orden },
      _limit: LIMITE,
      departure: { product: true },
      // Lo que él mismo asignó (8.9): llega expandido para poder enseñar la
      // matrícula y el nombre, y recortado por la lista blanca del proveedor.
      vehicle: true, staff: true,
    }),
    tenantQuery<Record<string, unknown>>(companyId, "pickup_route", {
      _filter: { supplier: supplierId, service_date: rango },
      _sort: { service_date: orden },
      _limit: LIMITE,
      departure: { product: true },
      zone: true,
      vehicle: true, driver: true, guide: true,
    }),
  ]);

  /**
   * EL RECORTE VA ANTES DEL MAPEO, Y ESO ES TODA LA GRACIA.
   *
   * El mapeo de abajo elige a mano lo que la pantalla pinta, así que hoy no
   * saca nada que no deba. Pero es una lista escrita por una persona, y el día
   * que alguien añada ahí el coste de la línea —o una nota interna— no habría
   * nada que lo parara.
   *
   * Pasando las filas por la lista blanca del actor (0085) primero, ese campo
   * llega ya borrado y el mapeo lo lee como `undefined`. El recorte no depende
   * de que el mapeo esté bien escrito.
   */
  const actor = { role: "supplier" as const, supplierId };
  const recursos = projectRows("departure_resource", actor, recursosCrudos);
  const rutas = projectRows("pickup_route", actor, rutasCrudas);

  /**
   * El bloque de asignación, igual para las dos tablas.
   *
   * Escrito una vez: el veto es la misma pregunta —«¿puede todavía tocarlo?»— y
   * dos copias son dos sitios donde acordarse del siguiente motivo.
   */
  const asignacion = (tipo: "recurso" | "ruta", fila: Record<string, unknown>) => {
    const veto = vetoDeAsignacion(fila as never, hoy);
    return {
      asignado: asignacionDe(tipo, fila),
      puede_asignar: !veto,
      motivo_para_no_asignar: veto?.mensaje ?? null,
    };
  };

  const deRecurso = (fila: Record<string, unknown>): ServicioDeProveedor => {
    const salida = (fila.departure ?? {}) as Record<string, unknown>;
    return {
      _id: String(fila._id ?? ""),
      tipo: "recurso",
      service_date: fechaDe(fila),
      producto: textoDe(salida.product),
      detalle: typeof fila.resource_role === "string" ? fila.resource_role : null,
      punto_de_encuentro: typeof salida.meeting_point === "string" ? salida.meeting_point : null,
      pax: typeof fila.pax_assigned === "number" ? fila.pax_assigned : null,
      status: typeof fila.status === "string" ? fila.status : null,
      ...respuesta(fila),
      ...asignacion("recurso", fila),
    };
  };

  const deRuta = (fila: Record<string, unknown>): ServicioDeProveedor => {
    const salida = (fila.departure ?? {}) as Record<string, unknown>;
    return {
      _id: String(fila._id ?? ""),
      tipo: "ruta",
      service_date: fechaDe(fila),
      producto: textoDe(salida.product),
      detalle: textoDe(fila.name) ?? textoDe(fila.zone),
      punto_de_encuentro: typeof salida.meeting_point === "string" ? salida.meeting_point : null,
      pax: typeof fila.pax_total === "number" ? fila.pax_total : null,
      status: typeof fila.status === "string" ? fila.status : null,
      ...respuesta(fila),
      ...asignacion("ruta", fila),
    };
  };

  const juntos = [...recursos.map(deRecurso), ...rutas.map(deRuta)];

  /**
   * Y se ordenan otra vez, porque vienen de DOS consultas ordenadas cada una
   * por su lado. Sin esto, la pantalla enseñaría todos los recursos y después
   * todas las rutas, cada bloque en orden y el conjunto en ninguno — que es la
   * forma de que alguien se salte el servicio de las nueve porque estaba
   * debajo del de las cinco de la tarde.
   */
  juntos.sort((a, b) => {
    const x = a.service_date ?? "";
    const y = b.service_date ?? "";
    return orden === "asc" ? x.localeCompare(y) : y.localeCompare(x);
  });

  return juntos.slice(0, LIMITE);
}
