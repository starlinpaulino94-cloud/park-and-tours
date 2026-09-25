/**
 * Un cliente de Supabase de mentira, sobre la misma base en memoria.
 *
 * POR QUÉ HACE FALTA UNO APARTE
 *
 * `fake-tenant.ts` falsea `tenantQuery/Create/Update`, y con eso se prueban los
 * servicios que hablan con la base por ahí. Pero hay nueve que la llaman
 * directamente con `supabaseService()` —el conector de OTAs, el canje de
 * MembeGo, los crons— porque corren SIN SESIÓN y las ayudas de inquilino no les
 * sirven. Esos nueve no se podían probar de ninguna forma.
 *
 * Este doble entiende el trozo de la gramática de PostgREST que la aplicación
 * usa de verdad, y nada más: `from`, `select`, `insert`, `update`, `eq`, `in`,
 * `not`, `lt`, `lte`, `gt`, `gte`, `order` (encadenable), `limit`, `range`,
 * `single` y `maybeSingle`.
 * Añadir lo que no se usa sería escribir un motor de base de datos, que es
 * exactamente lo que no queremos tener que mantener.
 *
 * LO QUE NO ES
 *
 * No aplica RLS ni el filtro por organización: lo simula respetando los `eq`
 * que el código escribe. Si un servicio OLVIDA su `eq("organization_id", …)`,
 * este doble le devolverá filas de otras empresas igual que lo haría PostgREST
 * con la llave de servicio — y eso es lo correcto, porque esa llave se salta la
 * RLS de verdad. Una prueba que lo tapara escondería precisamente la clase de
 * fuga que hay que buscar.
 *
 * Tampoco hay `check`, claves foráneas, disparadores ni transacciones; para eso
 * están `supabase/tests/*.test.sql`.
 */

import type { FakeDb } from "@/test/fake-tenant";

type Fila = Record<string, unknown>;

interface Resultado {
  data: unknown;
  error: { message: string; code?: string } | null;
  count?: number | null;
}

/** Referencia: `"id"`, `{_id}` o `{id}` se leen igual. */
function ref(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const r = value as { _id?: unknown; id?: unknown };
    return r._id ?? r.id ?? value;
  }
  return value;
}

/**
 * Las columnas de PostgREST frente a los campos de la aplicación.
 *
 * La base guarda `order_id` y la aplicación lee `order`. El doble traduce para
 * que una prueba pueda sembrar con la forma de la aplicación —que es la que usa
 * `fake-tenant`— y el servicio consultar con la forma de la base, igual que
 * pasa de verdad.
 */
function valorDe(fila: Fila, columna: string): unknown {
  if (columna === "id") return fila._id ?? fila.id;
  if (columna in fila) return ref(fila[columna]);
  // `order_id` → `order`, `departure_id` → `departure`…
  if (columna.endsWith("_id")) {
    const corto = columna.slice(0, -3);
    if (corto in fila) return ref(fila[corto]);
  }
  return undefined;
}

/**
 * La fila que se va a escribir, con las referencias en las DOS formas.
 *
 * `valorDe` ya lee `settlement_id` y `settlement` como el mismo campo, porque
 * la base guarda uno y la aplicación lee el otro. Al escribir hacía lo
 * contrario: guardaba literalmente la clave que le dieran, así que una fila
 * escrita por PostgREST no se podía leer con la forma de la aplicación — y una
 * prueba que mezclara las dos capas veía un campo vacío que en producción está
 * lleno.
 *
 * Se guardan las dos y quedan equivalentes en las dos direcciones. Que el
 * nombre REAL de la columna exista lo comprueba `schema-contract.test.ts`
 * contra el esquema, que es donde se puede comprobar de verdad.
 */
function conAmbasFormas(fila: Fila): Fila {
  const out: Fila = { ...fila };
  for (const [clave, valor] of Object.entries(fila)) {
    if (clave === "organization_id" || !clave.endsWith("_id")) continue;
    const corto = clave.slice(0, -3);
    if (!(corto in out)) out[corto] = valor;
  }
  return out;
}

type Filtro = (fila: Fila) => boolean;

/**
 * Las columnas de un `select`, cuando se puede saber cuáles son.
 *
 * Devuelve `null` —«no proyectes»— para `*` y para cualquier select con
 * relaciones incrustadas (`product:product_id(name)`), porque reproducir la
 * forma que PostgREST le da a un anidamiento sería escribir medio PostgREST.
 * Para una lista de columnas llanas sí se proyecta, y se proyecta ESTRICTO: la
 * fila que se devuelve tiene las columnas que se pidieron y ninguna más.
 *
 * Esa estrictez es el motivo de que este doble exista. Leer `row.product_id` de
 * un `select("product")` devuelve `undefined` en producción sin fallar, y el
 * `String(undefined)` que viene detrás mete `"undefined"` en un conjunto que
 * luego nadie encuentra. Un doble permisivo devolvería el campo igualmente y la
 * prueba pasaría con el error dentro.
 */
function columnasDe(cols: string): string[] | null {
  const limpio = cols.trim();
  if (limpio === "" || limpio === "*" || limpio.includes("(")) return null;
  const nombres = limpio.split(",").map((c) => c.trim()).filter(Boolean);
  if (nombres.some((c) => c.includes(":") || c === "*")) return null;
  return nombres;
}

class Builder implements PromiseLike<Resultado> {
  private filtros: Filtro[] = [];
  /** Columnas de `onConflict` cuando la escritura es un `upsert`. */
  private conflicto: string[] = [];
  private orden: { columna: string; asc: boolean }[] = [];
  /** Desde qué fila empieza el resultado. `range` lo usa; `limit` no lo toca. */
  private desde = 0;
  private tope = 0;
  private modo: "select" | "insert" | "update" | "delete" = "select";
  private payload: Fila | Fila[] | null = null;
  private unico: "single" | "maybeSingle" | null = null;
  private contar = false;
  private columnas: string[] | null = null;

  constructor(private db: FakeDb, private tabla: string) {}

  /* ── qué se hace ─────────────────────────────────────────────────────── */

  select(cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.modo === "select") this.modo = "select";
    if (opts?.count) this.contar = true;
    // Un `select` después de un `insert`/`update` pide la fila escrita, y ahí
    // el código lee lo que acaba de mandar: no se proyecta.
    if (cols && this.modo === "select") this.columnas = columnasDe(cols);
    return this;
  }
  insert(rows: Fila | Fila[]) { this.modo = "insert"; this.payload = rows; return this; }
  update(row: Fila) { this.modo = "update"; this.payload = row; return this; }
  delete() { this.modo = "delete"; return this; }
  /**
   * `upsert` NO es un `insert`, y tratarlo como tal escondía el fallo entero.
   *
   * Media docena de servicios escriben con `upsert(..., { onConflict })` para
   * decir «esta fila es única por estas columnas: si ya está, actualízala».
   * Con el doble insertando siempre, la segunda visita del mismo cliente creaba
   * un espejo NUEVO en vez de sumar sobre el que había — y la prueba veía el
   * primero, con su contador intacto, dando por bueno un contador que en
   * producción sí avanza. Un doble que se equivoca así no prueba nada: da
   * permiso.
   */
  upsert(rows: Fila | Fila[], opts?: { onConflict?: string }) {
    this.modo = "insert";
    this.payload = rows;
    this.conflicto = (opts?.onConflict ?? "").split(",").map((c) => c.trim()).filter(Boolean);
    return this;
  }

  /* ── filtros ─────────────────────────────────────────────────────────── */

  eq(col: string, value: unknown) {
    this.filtros.push((f) => valorDe(f, col) === (ref(value) ?? value));
    return this;
  }
  neq(col: string, value: unknown) {
    this.filtros.push((f) => valorDe(f, col) !== (ref(value) ?? value));
    return this;
  }
  in(col: string, values: unknown[]) {
    const lista = values.map((v) => ref(v) ?? v);
    this.filtros.push((f) => lista.includes(valorDe(f, col)));
    return this;
  }
  /** Solo la forma que usa la aplicación: `not(col, "is", null)`. */
  not(col: string, op: string, value: unknown) {
    if (op === "is" && value === null) {
      this.filtros.push((f) => {
        const v = valorDe(f, col);
        return v !== null && v !== undefined;
      });
      return this;
    }
    throw new Error(`fake-supabase: not(${col}, "${op}", …) no está soportado; añádelo si la aplicación lo usa`);
  }
  /**
   * `ilike`: comparación insensible a mayúsculas CON comodines.
   *
   * Se implementan los comodines a propósito y no como una igualdad relajada:
   * `%` y `_` son lo que hace que `ilike` sobre una cadena que viene de una URL
   * no sea una comparación sino un patrón, y una prueba que los ignorara
   * escondería justo esa clase de fuga.
   */
  ilike(col: string, patron: string) {
    // `*` es comodín igual que `%`: PostgREST lo convierte ANTES de que SQL vea
    // el patrón, así que una contrabarra delante no lo salva. Un doble que lo
    // tratara como un carácter normal daría por buena la única defensa que no
    // vale para él.
    const escapado = String(patron)
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/[%*]/g, ".*")
      .replace(/_/g, ".");
    const re = new RegExp(`^${escapado}$`, "i");
    this.filtros.push((f) => {
      const v = valorDe(f, col);
      return v !== null && v !== undefined && re.test(String(v));
    });
    return this;
  }

  is(col: string, value: unknown) {
    this.filtros.push((f) => {
      const v = valorDe(f, col);
      return value === null ? v === null || v === undefined : v === value;
    });
    return this;
  }
  lt(col: string, value: unknown) { return this.comparar(col, value, (a, b) => a < b); }
  lte(col: string, value: unknown) { return this.comparar(col, value, (a, b) => a <= b); }
  gt(col: string, value: unknown) { return this.comparar(col, value, (a, b) => a > b); }
  gte(col: string, value: unknown) { return this.comparar(col, value, (a, b) => a >= b); }

  /**
   * Una comparación contra un nulo es NULA, no falsa, y por tanto la fila NO
   * pasa el filtro. Es exactamente el comportamiento de Postgres, y es lo que
   * hace que una retención sin fecha no la libere nunca nadie: si este doble
   * tratara el nulo como cero, la prueba diría que el barrido funciona.
   */
  private comparar(col: string, value: unknown, cmp: (a: string, b: string) => boolean) {
    this.filtros.push((f) => {
      const v = valorDe(f, col);
      if (v === null || v === undefined) return false;
      return cmp(String(v), String(value));
    });
    return this;
  }

  /* ── forma del resultado ─────────────────────────────────────────────── */

  /**
   * ORDENAR POR VARIAS COLUMNAS, COMO PostgREST.
   *
   * Encadenar `.order()` dos veces en PostgREST ordena por las dos, en ese
   * orden. Este doble se quedaba solo con la ÚLTIMA, y eso importa porque un
   * barrido paginado necesita un desempate estable: sin él, dos filas con la
   * misma fecha pueden salir en distinto orden en dos páginas consecutivas, y
   * entonces una se repite y otra no sale nunca. Justo el fallo que el barrido
   * existe para evitar, y el doble lo habría dado por bueno.
   */
  order(columna: string, opts?: { ascending?: boolean }) {
    this.orden.push({ columna, asc: opts?.ascending !== false });
    return this;
  }
  limit(n: number) { this.tope = n; return this; }
  /**
   * `range` ES UNA VENTANA, NO UN TOPE.
   *
   * Esto descartaba `desde` y solo calculaba el tamaño. Con eso, un barrido
   * que pidiera la página 2 recibía otra vez la página 1 —y como cada pasada
   * devolvía filas, el bucle habría dado vueltas para siempre sobre las
   * mismas, o peor: la prueba de un barrido que NO avanza su cursor habría
   * salido en verde. Un doble que perdona el error que se está probando no
   * prueba nada.
   */
  range(desde: number, hasta: number) { this.desde = desde; this.tope = hasta - desde + 1; return this; }
  single() { this.unico = "single"; return this; }
  maybeSingle() { this.unico = "maybeSingle"; return this; }

  /* ── ejecución ───────────────────────────────────────────────────────── */

  private filas(): Fila[] {
    let filas = this.db.rows(this.tabla).filter((f) => this.filtros.every((p) => p(f)));
    if (this.orden.length > 0) {
      filas = [...filas].sort((a, b) => {
        for (const { columna, asc } of this.orden) {
          const x = String(valorDe(a, columna) ?? "");
          const y = String(valorDe(b, columna) ?? "");
          const c = x.localeCompare(y);
          if (c !== 0) return asc ? c : -c;
        }
        return 0;
      });
    }
    if (this.desde > 0) filas = filas.slice(this.desde);
    if (this.tope > 0) filas = filas.slice(0, this.tope);
    return filas;
  }

  private async ejecutar(): Promise<Resultado> {
    try {
      if (this.modo === "insert") {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload as Fila];
        const creadas: Fila[] = [];
        for (const row of rows) {
          // Con `onConflict`, la fila que ya casa por esas columnas se ACTUALIZA.
          if (this.conflicto.length > 0) {
            const ya = this.db.rows(this.tabla).find((f) =>
              this.conflicto.every((col) => valorDe(f, col) === (ref(row[col]) ?? row[col]))
            );
            if (ya) {
              creadas.push(await this.db.tenantUpdate(
                String(ya.organization_id ?? ""), this.tabla, String(ya._id),
                conAmbasFormas(row)
              ));
              continue;
            }
          }
          // `created_at` lo pone la base con `default now()`, y hay servicios
          // que FILTRAN por él —la deduplicación de visitas del embudo, sin ir
          // más lejos—. Sin sello, esas filas no pasan su propio `gte` y la
          // prueba diría que la deduplicación no funciona.
          const conSello = row.created_at === undefined
            ? { ...row, created_at: new Date().toISOString() }
            : row;
          creadas.push(await this.db.tenantCreate(
            String(row.organization_id ?? ""), this.tabla, conAmbasFormas(conSello)));
        }
        return this.envolver(creadas);
      }

      if (this.modo === "update") {
        const afectadas = this.filas();
        const out: Fila[] = [];
        for (const fila of afectadas) {
          out.push(await this.db.tenantUpdate(
            String(fila.organization_id ?? ""), this.tabla, String(fila._id),
            conAmbasFormas(this.payload as Fila)
          ));
        }
        return this.envolver(out);
      }

      if (this.modo === "delete") {
        const afectadas = this.filas();
        for (const fila of afectadas) {
          await this.db.tenantDelete(String(fila.organization_id ?? ""), this.tabla, String(fila._id));
        }
        return this.envolver(afectadas);
      }

      const filas = this.filas();
      if (this.contar) return { data: null, error: null, count: filas.length };
      return this.envolver(filas);
    } catch (err) {
      return { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
    }
  }

  /** PostgREST devuelve la fila y no un array cuando se pide `single`. */
  private envolver(filas: Fila[]): Resultado {
    // Las filas se devuelven con `id` además de `_id`: el código que habla con
    // PostgREST lee `row.id`, y sin esto leería `undefined` sin fallar.
    const conId = filas.map((f) => this.proyectar(f));
    if (this.unico === "single") {
      if (conId.length !== 1) {
        return { data: null, error: { message: `se esperaba una fila y hay ${conId.length}` } };
      }
      return { data: conId[0], error: null };
    }
    if (this.unico === "maybeSingle") {
      return { data: conId[0] ?? null, error: null };
    }
    return { data: conId, error: null, count: conId.length };
  }

  /** La fila con los nombres de columna de la BASE, no los de la aplicación. */
  private proyectar(fila: Fila): Fila {
    const id = fila._id ?? fila.id;
    if (!this.columnas) return { ...fila, id };
    const salida: Fila = {};
    for (const col of this.columnas) salida[col] = valorDe(fila, col) ?? null;
    // `_id` viaja siempre: es la identidad de la fila dentro del doble, y las
    // pruebas la usan para localizarla.
    return { ...salida, _id: fila._id, id: this.columnas.includes("id") ? id : salida.id ?? id };
  }

  then<R1 = Resultado, R2 = never>(
    onDone?: ((value: Resultado) => R1 | PromiseLike<R1>) | null,
    onFail?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    return this.ejecutar().then(onDone, onFail);
  }
}

export interface FakeSupabase {
  from(tabla: string): Builder;
  /**
   * Hace que TODA escritura sobre esa tabla falle, para probar qué pasa cuando
   * la base dice no. Es la forma de comprobar que un servicio no se traga sus
   * errores.
   */
  breakWrites(tabla: string, mensaje?: string, codigo?: string): void;
  /**
   * Hace que toda LECTURA de esa tabla falle.
   *
   * Existe por simetría y porque una lectura fallida es más traicionera que una
   * escritura: PostgREST devuelve `data: null`, que para el código de arriba es
   * indistinguible de «no hay nada» —no existe la reserva, no hay salidas—, y
   * ese «no hay nada» suele ser justo la rama que deja pasar lo que no debería.
   */
  breakReads(tabla: string, mensaje?: string, codigo?: string): void;
  /**
   * La clave duplicada, que NO es un error cualquiera.
   *
   * Tres servicios se apoyan en ella para ser idempotentes —el canje de
   * MembeGo, el canje del token SSO y el sobre del webhook— y los tres
   * distinguen `23505` de un fallo de verdad: uno significa «esto ya se hizo» y
   * se contesta que sí; el otro, «no se pudo hacer». Sin poder provocarla, esa
   * rama —la que decide si un reintento cobra dos veces— no se podía probar.
   */
  breakWithDuplicate(tabla: string): void;
  /** Deja de romper. */
  healWrites(tabla?: string): void;
  healReads(tabla?: string): void;
}

export function fakeSupabase(db: FakeDb): FakeSupabase {
  const rotas = new Map<string, { message: string; code?: string }>();
  const rotasLectura = new Map<string, { message: string; code?: string }>();

  return {
    from(tabla: string) {
      const builder = new Builder(db, tabla);
      const roto = rotas.get(tabla);
      const rotoLeer = rotasLectura.get(tabla);
      if (!roto && !rotoLeer) return builder;

      // Se envuelve el builder para que las ESCRITURAS fallen y las lecturas
      // sigan funcionando: un fallo de escritura es el caso interesante, y
      // romper también las lecturas cambiaría la prueba de sitio.
      const original = builder.then.bind(builder);
      let escribe = false;
      for (const metodo of ["insert", "update", "delete", "upsert"] as const) {
        const previo = builder[metodo].bind(builder) as (...a: never[]) => Builder;
        (builder as unknown as Record<string, unknown>)[metodo] = (...args: never[]) => {
          escribe = true;
          return previo(...args);
        };
      }
      builder.then = ((onDone?: never, onFail?: never) => {
        if (escribe && roto) {
          return Promise.resolve({ data: null, error: { ...roto } }).then(onDone, onFail);
        }
        if (!escribe && rotoLeer) {
          return Promise.resolve({ data: null, error: { ...rotoLeer } }).then(onDone, onFail);
        }
        return original(onDone, onFail);
      }) as typeof builder.then;
      return builder;
    },
    breakWrites(tabla, mensaje = "la base rechazó la escritura", codigo) {
      rotas.set(tabla, { message: mensaje, code: codigo });
    },
    breakReads(tabla, mensaje = "la base rechazó la lectura", codigo) {
      rotasLectura.set(tabla, { message: mensaje, code: codigo });
    },
    breakWithDuplicate(tabla) {
      rotas.set(tabla, { message: "duplicate key value violates unique constraint", code: "23505" });
    },
    healWrites(tabla) { if (tabla) rotas.delete(tabla); else rotas.clear(); },
    healReads(tabla) { if (tabla) rotasLectura.delete(tabla); else rotasLectura.clear(); },
  };
}
