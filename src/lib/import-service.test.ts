import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";
import { targetByKey } from "@/lib/import";
import type { Prepared, PreparedRow } from "@/lib/import";

/**
 * EL IMPORTADOR CONTRA LA BASE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DÓNDE SE PUEDE EQUIVOCAR ESTE SERVICIO
 *
 * Qué es válido, qué es un duplicado y cómo se lee un número vive en
 * `import.ts` y es puro. Aquí solo quedan las dos cosas que necesitan la base:
 * saber qué filas YA están y meterlas. Y las dos pueden salir mal de formas que
 * el archivo no enseña:
 *
 *   · cruzar mal los duplicados no da un error, da fichas repetidas;
 *   · y escribir sin pedir permiso al plan deja media importación dentro y la
 *     otra media fuera, sin forma de saber cuál es cuál.
 */

let db: FakeDb;
const techoPedido = vi.fn();

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    tenantQuery: (...a: [string, string, Record<string, unknown>?]) => db.tenantQuery(...a),
    tenantCreate: (...a: [string, string, Record<string, unknown>]) => db.tenantCreate(...a),
    tenantUpdate: (...a: [string, string, string, Record<string, unknown>]) => db.tenantUpdate(...a),
  };
});
const auditado = vi.fn();
vi.mock("@/lib/audit", () => ({ writeAudit: (...a: unknown[]) => auditado(...a) }));
vi.mock("@/lib/plan-service", () => ({
  assertWithinLimit: (...a: unknown[]) => techoPedido(...a),
}));

import { resolveExisting, runImport } from "@/lib/import-service";

const ORG = "org-1";
const ctx = { companyId: ORG, userId: "usr-1", email: "ana@tours.do" } as never;
const CLIENTES = targetByKey("customer")!;
const PRODUCTOS = targetByKey("product")!;

const fila = (line: number, values: Record<string, unknown>, dedupe: { field: string; value: string } | null): PreparedRow =>
  ({ line, values, issues: [], dedupe });

const preparado = (rows: PreparedRow[]): Prepared =>
  ({ rows, valid: rows, issues: [], mappedFields: Object.keys(rows[0]?.values ?? {}) });

beforeEach(() => {
  vi.clearAllMocks();
  db = fakeDb();
});

/* ══════════════════════ qué filas ya están ══════════════════════════════ */

describe("cruzar el archivo con lo que ya existe", () => {
  it("encuentra por el campo de deduplicación", async () => {
    db.seed("customer", [
      { _id: "cli-1", organization_id: ORG, email: "laura@example.com", first_name: "Laura" },
    ]);
    const found = await resolveExisting(ORG, CLIENTES, [
      fila(2, { email: "laura@example.com" }, { field: "email", value: "laura@example.com" }),
    ]);
    expect(found.get("email:laura@example.com")).toBe("cli-1");
  });

  it("PERO NO si la ficha guardada tiene mayúsculas, y eso es un fallo abierto", async () => {
    /**
     * Esta prueba afirma lo que el código hace HOY, no lo que debería hacer.
     *
     * `keyOf` pasa a minúsculas las dos partes al armar el mapa, así que leyendo
     * el servicio parece que el cruce no mira mayúsculas. No es verdad: la
     * consulta va con un `in` exacto, y una ficha guardada como
     * `Laura@Example.com` no casa con `laura@example.com`. Se toma por nueva y
     * el archivo la vuelve a crear.
     *
     * Y hay fichas así: el motor público pasa el correo a minúsculas, pero la
     * captura a mano y el espejo de MembeGo guardan lo que les den.
     *
     * NO se arregla aquí. Un `in` insensible a mayúsculas no se puede expresar
     * en PostgREST, y hacer una consulta por valor serían doscientas por lote.
     * Lo que lo arregla de verdad es normalizar la columna en la base —`citext`
     * o un índice funcional— y eso es una migración, o sea su propia ola. Queda
     * dicho en el registro de arreglos.
     */
    db.seed("customer", [
      { _id: "cli-1", organization_id: ORG, email: "Laura@Example.com", first_name: "Laura" },
    ]);
    const found = await resolveExisting(ORG, CLIENTES, [
      fila(2, { email: "laura@example.com" }, { field: "email", value: "laura@example.com" }),
    ]);
    expect(found.size, "si esto empieza a encontrarla, el fallo está arreglado y esta prueba sobra").toBe(0);
  });

  it("lo que no está, no está", async () => {
    const found = await resolveExisting(ORG, CLIENTES, [
      fila(2, { email: "nueva@example.com" }, { field: "email", value: "nueva@example.com" }),
    ]);
    expect(found.size).toBe(0);
  });

  it("CON FICHAS REPETIDAS EN LA BASE, el cruce no se queda corto", async () => {
    /**
     * El tope de la consulta era `chunk.length`: tantas filas como valores se
     * preguntan, dando por hecho que cada valor casa con UNA. El propio
     * comentario de este servicio dice lo contrario —«con dos fichas del mismo
     * correo, que no debería pasar pero pasa»—, y cuando pasa, las repetidas
     * gastan cupo: los últimos valores del lote se quedan sin respuesta, se
     * toman por nuevos y el archivo los vuelve a crear. Una cartera con
     * duplicados los MULTIPLICA en cada importación.
     */
    db.seed("customer", [
      { _id: "cli-1a", organization_id: ORG, email: "ana@example.com" },
      { _id: "cli-1b", organization_id: ORG, email: "ana@example.com" },
      { _id: "cli-2a", organization_id: ORG, email: "beto@example.com" },
      { _id: "cli-2b", organization_id: ORG, email: "beto@example.com" },
      { _id: "cli-3", organization_id: ORG, email: "carla@example.com" },
    ]);
    const found = await resolveExisting(ORG, CLIENTES, [
      fila(2, {}, { field: "email", value: "ana@example.com" }),
      fila(3, {}, { field: "email", value: "beto@example.com" }),
      fila(4, {}, { field: "email", value: "carla@example.com" }),
    ]);
    expect(found.size, "una ficha que sí existe se tomó por nueva").toBe(3);
    expect(found.get("email:carla@example.com")).toBe("cli-3");
  });

  it("y con dos fichas del mismo correo gana la primera", async () => {
    // Se actualiza una y no se crea una tercera.
    db.seed("customer", [
      { _id: "cli-a", organization_id: ORG, email: "ana@example.com" },
      { _id: "cli-b", organization_id: ORG, email: "ana@example.com" },
    ]);
    const found = await resolveExisting(ORG, CLIENTES, [
      fila(2, {}, { field: "email", value: "ana@example.com" }),
    ]);
    expect(found.get("email:ana@example.com")).toBe("cli-a");
  });

  it("una fila sin clave de deduplicación no se cruza con nada", async () => {
    const found = await resolveExisting(ORG, CLIENTES, [fila(2, { first_name: "Sin correo" }, null)]);
    expect(found.size).toBe(0);
  });

  it("un recurso que no existe se dice, no se adivina", async () => {
    await expect(
      resolveExisting(ORG, { ...CLIENTES, resource: "inventado" }, [])
    ).rejects.toThrow(/Recurso desconocido/);
  });
});

/* ══════════════════════════ escribir las filas ══════════════════════════ */

describe("escribir lo que el archivo trae", () => {
  it("crea lo nuevo y deja su procedencia escrita", async () => {
    // Sirve para revertir una importación equivocada y para no confundir lo
    // migrado con lo capturado a mano.
    const out = await runImport(ctx, CLIENTES, preparado([
      fila(2, { email: "nueva@example.com", first_name: "Nueva" }, { field: "email", value: "nueva@example.com" }),
    ]), new Map(), { onExisting: "update" });

    expect(out.created).toBe(1);
    expect(db.rows("customer")[0].source).toBe("import");
  });

  it("actualiza lo que ya está SOLO con los campos del archivo", async () => {
    /**
     * Una columna ausente no puede borrar lo que la ficha ya tenía: es la forma
     * más rápida de que una importación de teléfonos deje a todo el mundo sin
     * correo.
     */
    db.seed("customer", [
      { _id: "cli-1", organization_id: ORG, email: "laura@example.com", first_name: "Laura", phone: "809-1" },
    ]);
    const out = await runImport(ctx, CLIENTES, preparado([
      fila(2, { phone: "809-999" }, { field: "email", value: "laura@example.com" }),
    ]), new Map([["email:laura@example.com", "cli-1"]]), { onExisting: "update" });

    expect(out.updated).toBe(1);
    const ficha = db.row("customer", { _id: "cli-1" })!;
    expect(ficha.phone).toBe("809-999");
    expect(ficha.email, "la importación borró un campo que no traía").toBe("laura@example.com");
  });

  it("y con «saltar» no la toca", async () => {
    db.seed("customer", [{ _id: "cli-1", organization_id: ORG, email: "laura@example.com", phone: "809-1" }]);
    const out = await runImport(ctx, CLIENTES, preparado([
      fila(2, { phone: "809-999" }, { field: "email", value: "laura@example.com" }),
    ]), new Map([["email:laura@example.com", "cli-1"]]), { onExisting: "skip" });

    expect(out.updated).toBe(0);
    expect(out.created).toBe(0);
    expect(db.row("customer", { _id: "cli-1" })!.phone).toBe("809-1");
  });

  it("EL TECHO SE PIDE ANTES DE LA PRIMERA FILA, y por todas de golpe", async () => {
    /**
     * Con sitio para diez y un archivo de sesenta, fallar en la número once deja
     * al cliente con diez productos importados, cincuenta fuera y ninguna forma
     * de saber cuáles.
     */
    const filas = Array.from({ length: 3 }, (_, i) =>
      fila(i + 2, { name: `Producto ${i}`, code: `P${i}` }, { field: "code", value: `p${i}` }));
    await runImport(ctx, PRODUCTOS, preparado(filas), new Map(), { onExisting: "update" });
    expect(techoPedido).toHaveBeenCalledTimes(1);
    expect(techoPedido.mock.calls[0][2], "no se pidió permiso por todas a la vez").toBe(3);
  });

  it("y si no cabe, no entra ninguna", async () => {
    techoPedido.mockRejectedValueOnce(Object.assign(new Error("El plan se llenó"), { status: 402 }));
    await expect(runImport(ctx, PRODUCTOS, preparado([
      fila(2, { name: "Uno", code: "P1" }, { field: "code", value: "p1" }),
    ]), new Map(), { onExisting: "update" })).rejects.toMatchObject({ status: 402 });
    expect(db.rows("product")).toHaveLength(0);
  });

  it("sin nada que crear no se le pide permiso al plan", async () => {
    db.seed("product", [{ _id: "prod-1", organization_id: ORG, code: "P1", name: "Uno" }]);
    await runImport(ctx, PRODUCTOS, preparado([
      fila(2, { name: "Uno bis" }, { field: "code", value: "p1" }),
    ]), new Map([["code:p1", "prod-1"]]), { onExisting: "update" });
    expect(techoPedido).not.toHaveBeenCalled();
  });

  it("UNA FILA QUE FALLA NO DETIENE LAS DEMÁS", async () => {
    /**
     * El archivo ya pasó por la validación pura, así que lo que falle aquí es
     * algo que solo la base sabía y es raro. Cortar dejaría la importación a
     * medias sin poder repetirla; al reintentar, lo ya escrito se detecta como
     * duplicado, así que repetir es seguro.
     */
    let n = 0;
    const real = db.tenantCreate.bind(db);
    db.tenantCreate = (async (...a: Parameters<typeof real>) => {
      n += 1;
      if (n === 2) throw new Error("la base dijo que no");
      return real(...a);
    }) as typeof db.tenantCreate;

    const out = await runImport(ctx, CLIENTES, preparado([
      fila(2, { email: "a@example.com" }, { field: "email", value: "a@example.com" }),
      fila(3, { email: "b@example.com" }, { field: "email", value: "b@example.com" }),
      fila(4, { email: "c@example.com" }, { field: "email", value: "c@example.com" }),
    ]), new Map(), { onExisting: "update" });

    expect(out.created).toBe(2);
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0].line, "el error no señala la línea del archivo").toBe(3);
    expect(out.failed[0].message).toMatch(/la base dijo que no/);
  });

  it("la importación queda en la bitácora, como aviso y con su recuento", async () => {
    await runImport(ctx, CLIENTES, preparado([
      fila(2, { email: "a@example.com" }, { field: "email", value: "a@example.com" }),
    ]), new Map(), { onExisting: "update" });

    const linea = auditado.mock.calls[0][0] as { action: string; severity: string; metadata: Record<string, unknown> };
    expect(linea.action).toBe("data_imported");
    expect(linea.severity, "una importación no es un evento rutinario").toBe("warning");
    expect(linea.metadata.created).toBe(1);
  });

  it("un archivo vacío no escribe ni pide nada, pero sí se anota", async () => {
    const out = await runImport(ctx, CLIENTES, preparado([]), new Map(), { onExisting: "update" });
    expect(out).toEqual({ created: 0, updated: 0, failed: [] });
    expect(techoPedido).not.toHaveBeenCalled();
    expect(auditado).toHaveBeenCalledTimes(1);
  });
});
