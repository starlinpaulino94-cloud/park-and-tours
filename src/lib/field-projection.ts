import "server-only";
import type { AppRole } from "@/lib/auth";
import { atLeast, esDeSocio, esDeProveedor, esInterno, esAdminDeSocio } from "@/lib/tenant";
import { refId } from "@/lib/types";
import { relationResource } from "@/lib/supabase/expand";

/**
 * RECORTAR COLUMNAS, EN UN SOLO SITIO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO SIRVE `READ_ROLE` AQUÍ
 *
 * `READ_ROLE` decide sobre la TABLA entera: o la ves o no la ves. Con `product`
 * eso no vale —un vendedor sin catálogo no puede vender, y el punto de venta
 * se queda sin nada que enseñar—, pero su `base_cost` es el coste de la empresa
 * y no tiene por qué viajar a la pantalla de quien vende. Lo mismo con el
 * directorio del equipo: las FILAS son compartidas a propósito (el supervisor,
 * el desplegable del punto de venta), y lo que sobra son dos COLUMNAS —lo que
 * cobra cada compañero y su meta—.
 *
 * Para eso hace falta recortar campos, no negar tablas. Se proyecta, no se
 * bloquea.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y TIENE QUE SEGUIR A LAS EXPANSIONES
 *
 * Recortar solo la fila de arriba habría sido teatro: una reserva expande su
 * producto —con el coste dentro— y una orden expande su vendedor —con la
 * comisión dentro—. El recorte baja por las relaciones resolviendo a qué
 * recurso apunta cada una, que es el mismo mapa que usa la expansión. Así, una
 * expansión nueva hereda el recorte en vez de volver a arrastrar el coste.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UN CAMPO RECORTADO SE VA, NO SE PONE A CERO
 *
 * Se BORRA la clave en vez de dejarla en `0` o en `null`. Un coste en cero no
 * es «no puedes verlo»: es «esta excursión no cuesta nada», y el margen que se
 * dibuja a partir de ahí sale del 100 %. La pantalla que enseña esas columnas
 * distingue ausencia de cero y pinta «—».
 */

/** Campo → rango mínimo para VERLO, por recurso. */
export const HIDDEN_BELOW: Record<string, Record<string, AppRole>> = {
  // El coste y lo que se deriva de él.
  product: { base_cost: "manager" },
  product_modality: { cost: "manager" },
  // Las condiciones de cada compañero. La fila propia se exceptúa más abajo:
  // nadie tiene que pedir permiso para ver su propia comisión.
  seller: { commission_pct: "manager", monthly_goal: "manager", max_discount_pct: "manager" },
};

/**
 * LO QUE NUNCA VIAJA A LA EMPRESA ASOCIADA. EL OTRO EJE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO VALE `HIDDEN_BELOW`
 *
 * Aquél recorta por RANGO: bastaría con pedir `manager` para que el socio
 * —rango 10— no viera el campo. Y no es eso lo que hay que decir. Las notas
 * que la operadora escribe sobre un tour center son suyas: no las ve ese tour
 * center, y sí las ve un `operations` de la operadora que tiene menos rango que
 * un gerente. Es un eje distinto, no un umbral más alto.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y `metadata` VA EN LA LISTA
 *
 * Porque `notes` vive dentro. La ficha del socio se reconstruye desde
 * `organizations`, y esa fila arrastra su `metadata` entera: borrar `notes` de
 * arriba y dejar el saco debajo es teatro — el mismo texto sigue ahí, una
 * clave más adentro, para quien mire el JSON de la respuesta.
 *
 * El socio SÍ ve sus condiciones comerciales y su comisión: son la relación
 * que ha firmado, no una nota sobre él.
 */
export const OCULTO_AL_SOCIO: Record<string, string[]> = {
  partner: ["notes", "metadata"],
};

/**
 * Cuándo una fila es «la de quien consulta» y se libra del recorte.
 *
 * Sin esto, el vendedor no vería su PROPIA comisión ni su propia meta, que es
 * justo lo que su apartado existe para enseñarle.
 *
 * OJO: no exime del recorte al socio. La ficha del socio ES su fila propia, y
 * es precisamente ahí donde están las notas que no puede leer.
 */
export const ES_PROPIA: Record<string, (row: Record<string, unknown>, ctx: ProjectionCtx) => boolean> = {
  /**
   * La ficha propia, y —desde la Fase 5— la de los MÍOS cuando quien mira
   * administra un tour center.
   *
   * La segunda mitad no ensancha nada: al socio solo le llegan fichas de su
   * propio tour center, porque `seller` está en su ámbito como PROPIA por
   * socio. Lo que arregla es que el recorte por rango le escondía la comisión
   * de su propia gente —su rango es el más bajo que hay—, y esa pantalla
   * existe precisamente para enseñársela. Al agente no: sus compañeros son sus
   * compañeros.
   */
  seller: (row, ctx) =>
    (Boolean(ctx.sellerId) && row._id === ctx.sellerId) ||
    (esAdminDeSocio(ctx) && Boolean(ctx.partnerId) && refId(row.partner as never) === ctx.partnerId),
};

/**
 * LO QUE EL PROVEEDOR SÍ VE. LISTA BLANCA, NO LISTA NEGRA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ AL REVÉS QUE EL SOCIO
 *
 * Al socio se le ESCONDEN campos (`OCULTO_AL_SOCIO`), que es razonable cuando
 * lo que se tapa son dos notas internas sobre una tabla que él ya conoce.
 *
 * El proveedor es otra cosa: es el actor con más datos personales de terceros
 * al alcance, y las tablas que ve —el recurso asignado, la ruta que conduce—
 * crecen con cada entrega. Con lista negra, cada columna nueva sale por
 * omisión, y una columna nueva en `pickup_route` es un teléfono de cliente en
 * la pantalla de un transportista. Con lista blanca, lo que nadie declaró no
 * sale, y el fallo es que a alguien le falte un dato — que se arregla con una
 * línea y una llamada.
 *
 * Es la misma decisión que la exportación del socio (5.5), tomada por el mismo
 * motivo y con el mismo precio.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ENTRA: LO OPERATIVO, Y NI UN CAMPO MÁS
 *
 * Lo que necesita para prestar el servicio: qué, cuándo, dónde y cuánta gente.
 * No entran el coste ni la moneda de SU línea —eso es lo que la operadora le
 * paga, y se ve en su estado de cuenta, no colgando de cada fila— ni las notas
 * internas, que es donde alguien escribe «este chofer llegó tarde dos veces».
 */
export const VISIBLE_AL_PROVEEDOR: Record<string, string[]> = {
  departure_resource: [
    "_id", "departure", "resource_role", "pax_assigned",
    "start_time", "end_time", "status", "vehicle", "staff", "supplier",
  ],
  pickup_route: [
    "_id", "departure", "zone", "name", "start_time",
    "pax_total", "stops_count", "status", "vehicle", "driver", "guide", "supplier",
  ],
  // De la salida, lo que le dice a qué servicio va. NO el cupo vendido ni los
  // ingresos: es una excursión de la operadora, no suya.
  departure: ["_id", "product", "departure_at", "departure_time", "meeting_point", "status", "capacity"],
  zone: ["_id", "name", "code"],
  // Su propia ficha, sin el saldo: lo que se le debe tiene su pantalla, con su
  // detalle y su forma de discutirlo.
  supplier: [
    "_id", "name", "supplier_type", "contact_name", "email", "phone",
    "currency", "payment_terms_days", "status",
  ],
};

/**
 * Los campos de esta tabla que NO ve el proveedor.
 *
 * Devuelve la lista de lo que hay que quitar de ESTA fila, calculada sobre sus
 * propias claves: la lista blanca dice lo que entra, así que todo lo demás sale.
 *
 * Una tabla SIN lista declarada no devuelve «nada que quitar»: devuelve todas
 * sus claves. Es la parte que hace que falle por omisión — si el ámbito abre
 * una tabla y nadie declaró sus campos, el proveedor recibe filas vacías y se
 * queja, en vez de recibirlas enteras y que no se entere nadie.
 */
export function camposFueraDeLaListaBlanca(table: string, row: Record<string, unknown>): string[] {
  const permitidos = VISIBLE_AL_PROVEEDOR[table];
  const todas = Object.keys(row);
  if (!permitidos) return todas;
  const blanca = new Set(permitidos);
  return todas.filter((campo) => !blanca.has(campo));
}

export interface ProjectionCtx {
  role: AppRole;
  sellerId?: string | null;
  /** Los que deciden `esDeSocio`, `esDeProveedor` y `esAdminDeSocio`. */
  partnerId?: string | null;
  isPartnerMember?: boolean;
  partnerRole?: string | null;
  /** El que decide `esDeProveedor`. */
  supplierId?: string | null;
}

/**
 * ¿Esta tabla recorta algo para alguien?
 *
 * OJO CON USARLA PARA SALTARSE EL RECORTE. Hoy no la llama nadie fuera de su
 * prueba, y conviene que siga así: la tentación evidente es
 * `if (!hasHiddenFields(t)) devolver las filas tal cual`, y con el eje del
 * proveedor eso sería un agujero — su lista blanca quita lo que NADIE declaró,
 * así que una tabla sin nada declarado es justo la que más hay que recortar,
 * no la que se puede saltar.
 *
 * Por eso el tercer eje entra aquí como `true` para cualquier tabla: mientras
 * exista un actor de lista blanca, no hay tabla de la que se pueda decir que no
 * recorta nada.
 */
export function hasHiddenFields(table: string, paraProveedor = false): boolean {
  if (paraProveedor) return true;
  return (
    Object.prototype.hasOwnProperty.call(HIDDEN_BELOW, table) ||
    Object.prototype.hasOwnProperty.call(OCULTO_AL_SOCIO, table)
  );
}

/** Los campos que este rango NO puede ver en esta tabla. */
export function hiddenFieldsFor(table: string, role: AppRole): string[] {
  const reglas = HIDDEN_BELOW[table];
  if (!reglas) return [];
  return Object.entries(reglas)
    .filter(([, minimo]) => !atLeast(role, minimo))
    .map(([campo]) => campo);
}

function propiaDe(table: string, ctx: ProjectionCtx, row: Record<string, unknown>): boolean {
  return ES_PROPIA[table]?.(row, ctx) ?? false;
}

/** Todo lo que hay que quitarle a QUIEN consulta, por los dos ejes. */
export function camposRecortadosPara(table: string, ctx: ProjectionCtx): string[] {
  const porRango = hiddenFieldsFor(table, ctx.role);
  /**
   * `esInterno` y no `!esDeSocio`: con el proveedor (0084) la negación dejó de
   * querer decir «es de la operadora». Aquí un proveedor caería en el recorte
   * por rango a secas — que hoy esconde lo suficiente porque su rango es el más
   * bajo, pero que dejaría de hacerlo en cuanto alguien le suba el rango por
   * cualquier motivo.
   */
  if (esInterno(ctx)) return porRango;
  return [...new Set([...porRango, ...(OCULTO_AL_SOCIO[table] ?? [])])];
}

const PROFUNDIDAD_MAXIMA = 4;

function proyectarFila(
  table: string,
  ctx: ProjectionCtx,
  row: Record<string, unknown>,
  depth: number
): Record<string, unknown> {
  if (depth > PROFUNDIDAD_MAXIMA) return row;

  let salida = row;
  /**
   * La fila propia exime del eje del RANGO y solo de ése.
   *
   * Escrito así —los dos ejes por separado, y `propia` tocando uno— y no como
   * un `if` alrededor de los dos, porque la exención por fila propia es
   * exactamente el razonamiento por analogía que abriría el otro: la ficha
   * propia del socio ES su fila, y es justo donde están las notas que la
   * operadora escribió sobre él.
   */
  const ocultos = [
    ...(propiaDe(table, ctx, row) ? [] : hiddenFieldsFor(table, ctx.role)),
    ...(esDeSocio(ctx) ? OCULTO_AL_SOCIO[table] ?? [] : []),
    /**
     * Y el eje del proveedor, que va al revés: lista blanca.
     *
     * Se calcula sobre las claves de ESTA fila y no sobre una lista fija,
     * porque lo que hay que quitar es «todo lo que no esté declarado», y eso
     * solo se sabe mirando lo que la fila trae. Una columna nueva sale por
     * omisión — que es exactamente lo que no puede pasar en la pantalla del
     * actor con más datos de terceros al alcance.
     */
    ...(esDeProveedor(ctx) ? camposFueraDeLaListaBlanca(table, row) : []),
  ];
  if (ocultos.length > 0) {
    salida = { ...row };
    for (const campo of ocultos) delete salida[campo];
  }

  // Y hacia abajo, por las relaciones expandidas.
  for (const [campo, valor] of Object.entries(salida)) {
    if (!valor || typeof valor !== "object") continue;
    const destino = relationResource(campo, table);
    if (!destino) continue;

    if (Array.isArray(valor)) {
      const filas = valor.filter((v) => v && typeof v === "object") as Record<string, unknown>[];
      if (filas.length !== valor.length) continue;
      const proyectadas = filas.map((f) => proyectarFila(destino, ctx, f, depth + 1));
      if (proyectadas.some((f, i) => f !== filas[i])) {
        if (salida === row) salida = { ...row };
        salida[campo] = proyectadas;
      }
      continue;
    }

    const hija = proyectarFila(destino, ctx, valor as Record<string, unknown>, depth + 1);
    if (hija !== valor) {
      if (salida === row) salida = { ...row };
      salida[campo] = hija;
    }
  }

  return salida;
}

/** Recorta una fila (y lo que trae expandido) para quien la va a recibir. */
export function projectRow<T extends Record<string, unknown>>(
  table: string,
  ctx: ProjectionCtx,
  row: T
): T {
  return proyectarFila(table, ctx, row, 0) as T;
}

/** Lo mismo para un listado o una exportación. */
export function projectRows<T extends Record<string, unknown>>(
  table: string,
  ctx: ProjectionCtx,
  rows: T[]
): T[] {
  return rows.map((row) => projectRow(table, ctx, row));
}
