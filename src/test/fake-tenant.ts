/**
 * Una base de datos de mentira, con memoria, para probar los servicios.
 *
 * POR QUÉ FALSEAR LA CAPA DE ABAJO Y NO EL SERVICIO
 *
 * `booking-service` no calcula casi nada por sí mismo: pide el precio a
 * `pricing`, el cupo a `availability`, el contrato a `allotment-service`, la
 * comisión a `commission-engine`. Si se falsean esos, la prueba comprueba que
 * el servicio llama a lo que hay que llamar, que es lo que ya se ve leyendo el
 * código. Falseando solo `tenantQuery/Create/Update` —el suelo— todo lo de
 * arriba corre DE VERDAD contra estas filas, y la prueba comprueba lo único que
 * importa: qué acaba escrito.
 *
 * LO QUE ESTO NO ES
 *
 * No es Postgres. No aplica RLS, ni restricciones `check`, ni claves foráneas,
 * ni disparadores, ni transacciones. Una prueba que pase aquí no demuestra que
 * la base aceptaría la fila; para eso están `supabase/tests/*.test.sql` y
 * `scripts/db-test.sh`. Aquí se comprueban las REGLAS DE NEGOCIO: que el total
 * cuadre, que la comisión salga de la base correcta, que el cupo se devuelva a
 * su contrato.
 */

import { pgTable } from "@/lib/data-backend";

type Fila = Record<string, unknown>;

const clon = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/** Referencia: `"id"`, `{_id}` o `{id}` se leen igual. */
function ref(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (value && typeof value === "object") {
    const r = value as { _id?: unknown; id?: unknown };
    const id = r._id ?? r.id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

/** ¿La fila cumple una condición de `_filter`? */
function cumple(fila: Fila, campo: string, cond: unknown): boolean {
  const valor = campo === "_id" ? (fila._id ?? fila.id) : fila[campo];

  if (cond && typeof cond === "object" && !Array.isArray(cond)) {
    const c = cond as Record<string, unknown>;
    if ("in" in c) {
      const lista = (c.in as unknown[]).map((v) => ref(v) ?? v);
      return lista.includes(ref(valor) ?? valor);
    }
    if ("nin" in c) {
      const lista = (c.nin as unknown[]).map((v) => ref(v) ?? v);
      return !lista.includes(ref(valor) ?? valor);
    }
    if ("gte" in c && String(valor ?? "") < String(c.gte)) return false;
    if ("lte" in c && String(valor ?? "") > String(c.lte)) return false;
    if ("gt" in c && !(String(valor ?? "") > String(c.gt))) return false;
    if ("lt" in c && !(String(valor ?? "") < String(c.lt))) return false;
    if ("neq" in c) return (ref(valor) ?? valor) !== (ref(c.neq) ?? c.neq);
    return true;
  }

  // Una referencia se compara por identificador aunque venga expandida.
  const esperado = ref(cond) ?? cond;
  const real = ref(valor) ?? valor;
  return real === esperado;
}

export interface FakeDb {
  /** Las filas de una tabla, tal y como están ahora. */
  rows(table: string): Fila[];
  /** La primera fila que cumpla, o `null`. */
  row(table: string, match: Record<string, unknown>): Fila | null;
  /** Mete filas sin pasar por el servicio (el estado de partida). */
  seed(table: string, filas: Fila[]): void;
  /** Cuántas veces se escribió en cada tabla, en orden. */
  readonly writes: { op: "create" | "update"; table: string; id?: string; data: Fila }[];
  tenantQuery: (org: string, table: string, opts?: Record<string, unknown>) => Promise<Fila[]>;
  tenantFindOne: (org: string, table: string, id: string, opts?: Record<string, unknown>) => Promise<Fila>;
  tenantCreate: (org: string, table: string, data: Fila) => Promise<Fila>;
  tenantUpdate: (org: string, table: string, id: string, data: Fila) => Promise<Fila>;
  tenantDelete: (org: string, table: string, id: string) => Promise<void>;
}

/**
 * Crea la base falsa con un estado de partida.
 *
 * Los identificadores son correlativos y previsibles (`booking-1`, `booking-2`)
 * a propósito: una prueba que afirma sobre `booking-2` se lee sin tener que
 * seguir una variable, y si el orden de escritura cambia, la prueba lo dice.
 */
export function fakeDb(inicial: Record<string, Fila[]> = {}): FakeDb {
  const tablas = new Map<string, Fila[]>();
  const writes: FakeDb["writes"] = [];
  let contador = 0;

  for (const [tabla, filas] of Object.entries(inicial)) {
    tablas.set(pgTable(tabla), filas.map((f) => ({ ...clon(f), _id: String(f._id ?? f.id ?? `${tabla}-${++contador}`) })));
  }

  /**
   * Una sola tabla por nombre de Postgres.
   *
   * `order` y `sales_order` son la MISMA tabla —`pgTable` lo traduce en
   * producción, porque `order` es palabra reservada—, igual que `company` y
   * `organizations`. Sin esta traducción aquí, un servicio que crea la venta con
   * las ayudas de inquilino (`order`) y luego la corrige con la llave de
   * servicio (`sales_order`) escribiría en dos tablas distintas, y la prueba
   * daría por perdida una escritura que en la base sí llega.
   */
  const de = (nombre: string): Fila[] => {
    const tabla = pgTable(nombre);
    if (!tablas.has(tabla)) tablas.set(tabla, []);
    return tablas.get(tabla)!;
  };

  const buscar = (tabla: string, opts: Record<string, unknown> = {}): Fila[] => {
    const filtro = (opts._filter as Record<string, unknown>) ?? {};
    let filas = de(tabla).filter((fila) =>
      Object.entries(filtro).every(([campo, cond]) => cumple(fila, campo, cond))
    );

    /**
     * ORDENAR POR TODAS LAS CLAVES DE `_sort`, NO SOLO POR LA PRIMERA.
     *
     * `applyQuery` recorre el objeto entero y encadena un `.order()` por cada
     * clave, así que `{ issued_at: "asc", _id: "asc" }` ordena por las dos. Este
     * doble se quedaba con la primera y tiraba el desempate — y el desempate es
     * justo lo que hace que dos páginas consecutivas no se solapen. Sin él, la
     * prueba de una lectura paginada sin orden total habría salido en verde.
     */
    const orden = opts._sort as Record<string, "asc" | "desc"> | undefined;
    if (orden) {
      const claves = Object.entries(orden);
      if (claves.length > 0) {
        filas = [...filas].sort((a, b) => {
          for (const [campo, dir] of claves) {
            const x = String(a[campo] ?? ""), y = String(b[campo] ?? "");
            const c = x.localeCompare(y);
            if (c !== 0) return dir === "desc" ? -c : c;
          }
          return 0;
        });
      }
    }

    /**
     * `_offset` ES UNA VENTANA, NO UN ADORNO.
     *
     * `applyQuery` lo traduce a `.range(offset, offset + limit - 1)`, así que en
     * la base de verdad salta filas. Aquí se ignoraba: una lectura que pidiera
     * la página 2 recibía otra vez la página 1, y con eso un barrido que NO
     * avanza su cursor —el fallo exacto que se está probando— habría pasado sus
     * propias pruebas. Un doble que perdona el fallo que se prueba no prueba
     * nada, y ese error se descubre en producción.
     */
    const salto = Number(opts._offset ?? 0);
    if (salto > 0) filas = filas.slice(salto);

    const limite = Number(opts._limit ?? 0);
    if (limite > 0) filas = filas.slice(0, limite);

    // Las relaciones pedidas (`product: true`, `customer: { … }`) se resuelven
    // aquí porque media aplicación lee `booking.product.name`: devolver el uuid
    // haría fallar la prueba por un motivo que no es el que se investiga.
    const relaciones = Object.fromEntries(
      Object.entries(opts).filter(([k]) => !k.startsWith("_"))
    );
    return filas.map((fila) => expandir(fila, relaciones, tabla));
  };

  /** Tabla a la que apunta un campo de referencia, cuando no coincide el nombre. */
  const DESTINO: Record<string, string> = {
    pickup_hotel: "hotel", assigned_to: "staff", driver: "staff", guide: "staff",
    to_org: "organizations", from_org: "organizations",
  };

  /**
   * Las relaciones ANIDADAS de un nodo: `departure: { product: true }`.
   *
   * Se resolvían solo en el primer nivel, y eso es un hueco justo en lo que
   * este doble promete. El proveedor de verdad SÍ baja —`expandRows` se llama
   * a sí misma—, así que una prueba podía pasar con el uuid donde en
   * producción llega el objeto, o al revés: dar por bueno un código que lee
   * `recurso.departure.product.name` y que en el banco nunca lo encontraba.
   *
   * Lo destapó el portal del proveedor, que pide exactamente esa forma.
   */
  const anidadas = (spec: unknown): Record<string, unknown> =>
    spec && typeof spec === "object" && !Array.isArray(spec)
      ? Object.fromEntries(Object.entries(spec as Fila).filter(([k]) => !k.startsWith("_")))
      : {};

  function expandir(fila: Fila, relaciones: Record<string, unknown>, tabla: string): Fila {
    const nombres = Object.keys(relaciones);
    if (nombres.length === 0) return clon(fila);
    const salida: Fila = clon(fila);
    for (const rel of nombres) {
      const destino = DESTINO[rel] ?? rel;
      const dentro = anidadas(relaciones[rel]);
      const id = ref(fila[rel]);
      if (id) {
        const hijo = de(destino).find((f) => f._id === id);
        if (hijo) salida[rel] = expandir(clon(hijo), dentro, destino);
        continue;
      }
      // Uno-a-muchos: las filas de `destino` que apuntan a esta.
      const hijos = de(destino).filter((f) => ref(f[tabla]) === fila._id);
      if (hijos.length > 0) salida[rel] = hijos.map((h) => expandir(clon(h), dentro, destino));
    }
    return salida;
  }

  return {
    writes,
    rows: (tabla) => de(tabla).map((f) => clon(f)),
    row: (tabla, match) => {
      const f = de(tabla).find((fila) =>
        Object.entries(match).every(([campo, cond]) => cumple(fila, campo, cond))
      );
      return f ? clon(f) : null;
    },
    seed: (tabla, filas) => {
      for (const f of filas) {
        de(tabla).push({ ...clon(f), _id: String(f._id ?? f.id ?? `${tabla}-${++contador}`) });
      }
    },
    tenantQuery: async (_org, tabla, opts) => buscar(tabla, opts ?? {}),
    tenantFindOne: async (_org, tabla, id, opts) => {
      const [fila] = buscar(tabla, { ...(opts ?? {}), _filter: { _id: id }, _limit: 1 });
      if (!fila) throw Object.assign(new Error(`No existe ${tabla} ${id}`), { status: 404 });
      return fila;
    },
    // El proveedor de verdad SELLA la fila con la empresa (`spCreate` añade
    // `organization_id: orgId` a todo lo que inserta). Sin ese sello, una fila
    // creada por un servicio sería invisible para cualquier consulta que filtre
    // por empresa —que es lo que hacen los nueve servicios sin sesión— y la
    // prueba fallaría por el doble, no por el código.
    tenantCreate: async (org, tabla, data) => {
      const fila: Fila = { organization_id: org, ...clon(data), _id: `${tabla}-${++contador}` };
      de(tabla).push(fila);
      writes.push({ op: "create", table: tabla, id: String(fila._id), data: clon(data) });
      return clon(fila);
    },
    tenantUpdate: async (_org, tabla, id, data) => {
      const fila = de(tabla).find((f) => f._id === id);
      if (!fila) throw Object.assign(new Error(`No existe ${tabla} ${id}`), { status: 404 });
      Object.assign(fila, clon(data));
      writes.push({ op: "update", table: tabla, id, data: clon(data) });
      return clon(fila);
    },
    tenantDelete: async (_org, tabla, id) => {
      const filas = de(tabla);
      const i = filas.findIndex((f) => f._id === id);
      if (i >= 0) filas.splice(i, 1);
    },
  };
}

/**
 * LO QUE HACE `departure_pax_totals` (0094), SOBRE LA BASE EN MEMORIA.
 *
 * Desde 0094 los pasajeros de una salida los cuenta una función de Postgres, y
 * en las pruebas no hay Postgres. Sin esto, cada fichero que vende algo tendría
 * que inventar su propia versión del recuento — y la primera que se desviara
 * dejaría la guarda contra la sobreventa probada contra una suma distinta de la
 * que corre en producción.
 *
 * Reproduce las tres decisiones de la función, que son las que importan:
 *
 *  · suma por las dos listas de estados QUE LE LLEGAN, sin saber qué significan
 *    (igual que la función: las listas las manda `availability.ts`);
 *  · `pax_total` nulo cuenta como cero, no como «no cuenta»;
 *  · una salida que no existe devuelve `found: false` y NO ceros, porque ceros
 *    querría decir «caben todos» sobre algo que no está.
 */
export function paxTotalsDeLaBase(db: FakeDb) {
  return (args: Record<string, unknown>) => {
    const org = String(args.p_org ?? "");
    const salida = String(args.p_departure ?? "");
    const confirmadas = (args.p_confirmed as string[] | undefined) ?? [];
    const pendientes = (args.p_pending as string[] | undefined) ?? [];

    const existe = db.rows("departure").find(
      (d) => String(d._id) === salida && (!d.organization_id || String(d.organization_id) === org)
    );
    if (!existe) return { data: { found: false }, error: null };

    let booked = 0;
    let pending = 0;
    for (const b of db.rows("booking")) {
      const suya = String(ref(b.departure) ?? b.departure_id ?? "") === salida;
      if (!suya) continue;
      if (b.organization_id && String(b.organization_id) !== org) continue;
      const pax = Number(b.pax_total ?? 0);
      const estado = String(b.status ?? "");
      if (confirmadas.includes(estado)) booked += pax;
      else if (pendientes.includes(estado)) pending += pax;
    }

    return {
      data: { found: true, capacity: Number(existe.capacity ?? 0), booked, pending },
      error: null,
    };
  };
}
