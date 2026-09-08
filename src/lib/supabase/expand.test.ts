import { describe, it, expect, vi, beforeEach } from "vitest";

// El motor de expansión consulta a través del proveedor de datos; aquí se
// sustituye por una base en memoria para poder probar la decisión —qué es
// uno-a-uno, qué es uno-a-muchos, cómo se agrupa y se recorta— sin Postgres.
const rowsByTable: Record<string, Record<string, unknown>[]> = {};
const queries: { table: string; options: any }[] = [];

vi.mock("@/lib/supabase/data-provider", () => ({
  spQuery: vi.fn(async (_orgId: string, table: string, options: any) => {
    queries.push({ table, options });
    if (table === "__explota__") throw new Error("relación inexistente");
    const all = rowsByTable[table] || [];
    const filter = options?._filter || {};
    const matches = all.filter((row) =>
      Object.entries(filter).every(([field, cond]) => {
        const value = row[field];
        if (cond && typeof cond === "object" && "in" in (cond as any)) {
          return ((cond as any).in as unknown[]).includes(value);
        }
        return value === cond;
      })
    );
    return matches.slice(0, options?._limit ?? 50);
  }),
}));

vi.mock("@/lib/user-directory", () => ({
  resolveUserNames: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, `Usuario ${id}`]))),
}));

import {
  splitExpand, nodeOptions, childForeignKey, groupChildren, relationResource, labelFor, expandRows,
} from "@/lib/supabase/expand";

beforeEach(() => {
  for (const key of Object.keys(rowsByTable)) delete rowsByTable[key];
  queries.length = 0;
  vi.clearAllMocks();
});

describe("expand — separación de opciones y relaciones", () => {
  it("las claves con guion bajo son consulta; el resto, relaciones", () => {
    const { query, expand } = splitExpand({
      _filter: { status: "active" }, _limit: 20, _sort: { name: "asc" },
      customer: true, booking: { _limit: 5, product: true },
    });
    expect(query).toEqual({ _filter: { status: "active" }, _limit: 20, _sort: { name: "asc" } });
    expect(Object.keys(expand)).toEqual(["customer", "booking"]);
  });

  it("ignora valores que no describen una relación", () => {
    const { expand } = splitExpand({ customer: false, product: "x", seller: null, partner: true });
    expect(Object.keys(expand)).toEqual(["partner"]);
  });

  it("un nodo `true` no lleva opciones propias", () => {
    expect(nodeOptions(true)).toEqual({});
    expect(nodeOptions({ _limit: 3 })).toEqual({ _limit: 3 });
  });
});

describe("expand — a qué apunta cada campo", () => {
  it("resuelve los campos cuyo nombre no coincide con su recurso", () => {
    expect(relationResource("pickup_hotel")).toBe("hotel");
    expect(relationResource("modality")).toBe("product_modality");
    expect(relationResource("driver")).toBe("staff");
  });

  it("los campos de usuario no son un recurso consultable", () => {
    // Las identidades viven en auth.users, que PostgREST no puede unir.
    expect(relationResource("user")).toBeNull();
    expect(relationResource("created_by")).toBeNull();
  });

  it("la clave ajena del hijo sale del mapa de alias, no de una suposición", () => {
    // `order` es el recurso, pero la tabla es `sales_order`: la columna sigue
    // siendo `order_id`.
    expect(childForeignKey("order", "booking")).toBe("order_id");
    expect(childForeignKey("booking", "participant")).toBe("booking_id");
    expect(childForeignKey("cash_session", "cash_movement")).toBe("cash_session_id");
  });
});

describe("expand — agrupación de hijos", () => {
  const children = [
    { _id: "c1", booking_id: "b1" }, { _id: "c2", booking_id: "b1" },
    { _id: "c3", booking_id: "b2" }, { _id: "c4", booking_id: "b1" },
    { _id: "c5" },
  ];

  it("reparte cada hijo con su padre", () => {
    const grouped = groupChildren(children, "booking_id", 10);
    expect(grouped.get("b1")!.map((c) => c._id)).toEqual(["c1", "c2", "c4"]);
    expect(grouped.get("b2")!.map((c) => c._id)).toEqual(["c3"]);
  });

  it("el tope es POR PADRE, no del total", () => {
    // Una consulta trae los hijos de todos los padres a la vez; si el recorte
    // fuera global, el segundo padre se quedaría sin ninguno.
    const grouped = groupChildren(children, "booking_id", 2);
    expect(grouped.get("b1")).toHaveLength(2);
    expect(grouped.get("b2")).toHaveLength(1);
  });

  it("un hijo huérfano no se cuela en ningún padre", () => {
    const grouped = groupChildren(children, "booking_id", 10);
    expect([...grouped.values()].flat().map((c) => c._id)).not.toContain("c5");
  });
});

describe("expand — hidratación real", () => {
  it("resuelve una referencia de uno-a-uno y le pone etiqueta", async () => {
    rowsByTable.product = [{ _id: "p1", name: "Tour Saona" }];
    const rows: Record<string, unknown>[] = [{ _id: "b1", product_id: "p1", product: "p1" }];

    await expandRows("org", "booking", rows, { product: true });

    expect(rows[0].product).toMatchObject({ _id: "p1", name: "Tour Saona" });
  });

  it("una sola consulta por relación, no una por fila", async () => {
    rowsByTable.product = [{ _id: "p1", name: "A" }, { _id: "p2", name: "B" }];
    const rows: Record<string, unknown>[] = [
      { _id: "b1", product_id: "p1" }, { _id: "b2", product_id: "p2" }, { _id: "b3", product_id: "p1" },
    ];

    await expandRows("org", "booking", rows, { product: true });

    expect(queries.filter((q) => q.table === "product")).toHaveLength(1);
    expect(queries[0].options._filter._id.in.sort()).toEqual(["p1", "p2"]);
  });

  it("resuelve una colección de uno-a-muchos que no es columna del padre", async () => {
    // Esto es lo que NUNCA funcionó: ni siquiera por la ruta genérica de ERP.
    rowsByTable.participant = [
      { _id: "pa1", booking_id: "b1", full_name: "Ana" },
      { _id: "pa2", booking_id: "b1", full_name: "Luis" },
      { _id: "pa3", booking_id: "b2", full_name: "Eva" },
    ];
    const rows: Record<string, unknown>[] = [{ _id: "b1" }, { _id: "b2" }];

    await expandRows("org", "booking", rows, { participant: { _limit: 50 } });

    expect((rows[0].participant as any[]).map((p) => p.full_name)).toEqual(["Ana", "Luis"]);
    expect((rows[1].participant as any[]).map((p) => p.full_name)).toEqual(["Eva"]);
  });

  it("un padre sin hijos recibe una lista vacía, no undefined", async () => {
    rowsByTable.participant = [];
    const rows: Record<string, unknown>[] = [{ _id: "b1" }];
    await expandRows("org", "booking", rows, { participant: true });
    expect(rows[0].participant).toEqual([]);
  });

  it("anida un nivel más", async () => {
    rowsByTable.booking = [{ _id: "b1", order_id: "o1", product_id: "p1" }];
    rowsByTable.product = [{ _id: "p1", name: "Tour Saona" }];
    const rows: Record<string, unknown>[] = [{ _id: "o1" }];

    await expandRows("org", "order", rows, { booking: { _limit: 20, product: true } });

    const booking = (rows[0].booking as any[])[0];
    expect(booking._id).toBe("b1");
    expect(booking.product).toMatchObject({ name: "Tour Saona" });
  });

  it("los campos de usuario se resuelven por nombre, no por consulta a una tabla", async () => {
    const rows: Record<string, unknown>[] = [{ _id: "cs1", user_id: "u1" }];
    await expandRows("org", "cash_session", rows, { user: true });
    expect(rows[0].user).toEqual({ _id: "u1", name: "Usuario u1" });
    expect(queries.some((q) => q.table === "user")).toBe(false);
  });

  it("una relación que falla no tumba la respuesta", async () => {
    rowsByTable.product = [{ _id: "p1", name: "Tour" }];
    const rows: Record<string, unknown>[] = [{ _id: "b1", product_id: "p1" }];

    // `authorized_products` no es ni columna ni tabla: antes se ignoraba en
    // silencio y ahora debe seguir sin romper el resto de la expansión.
    await expect(
      expandRows("org", "booking", rows, { product: true, authorized_products: true })
    ).resolves.toBeDefined();

    expect(rows[0].product).toMatchObject({ name: "Tour" });
    expect(rows[0].authorized_products).toBeUndefined();
  });

  it("no expande nada si no hay filas", async () => {
    await expandRows("org", "booking", [], { product: true });
    expect(queries).toHaveLength(0);
  });
});
