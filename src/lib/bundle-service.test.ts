import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";
import { fakeSupabase, type FakeSupabase } from "@/test/fake-supabase";

/**
 * EL PAQUETE, DESDE LA BASE HASTA EL ITINERARIO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ CUBRE ESTO Y QUÉ NO
 *
 * Las reglas de si dos actividades chocan, cuál se elige y en qué orden viven
 * en `bundles.ts` y ya están probadas. Lo que NO tenía ni una prueba es la capa
 * que lee la base y se la da masticada: `loadBundle`, `slotsFor` y `planBundle`.
 *
 * Y ahí es donde están los fallos que no se ven leyendo: un producto normal
 * tratado como paquete, una salida cancelada colándose en un itinerario, un
 * aforo sin declarar tomado por «agotado».
 */

let db: FakeDb;
let sb: FakeSupabase;

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    tenantQuery: (...a: [string, string, Record<string, unknown>?]) => db.tenantQuery(...a),
  };
});
vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => sb }));

import { loadBundle, slotsFor, planBundle } from "@/lib/bundle-service";

const EMPRESA = "org-1";
const PAQUETE = "prod-paquete";
const SAONA = "prod-saona";
const BUGGY = "prod-buggy";

/** Mañana, para que las salidas caigan siempre en el futuro. */
const DIA = "2026-10-01";

function base(extra: Record<string, Record<string, unknown>[]> = {}) {
  return fakeDb({
    product: [
      { _id: PAQUETE, organization_id: EMPRESA, name: "Combo Saona + Buggy", is_bundle: true, bundle_buffer_minutes: 45 },
      { _id: SAONA, organization_id: EMPRESA, name: "Isla Saona", is_bundle: false, duration_hours: 8 },
      { _id: BUGGY, organization_id: EMPRESA, name: "Buggy Macao", is_bundle: false, duration_hours: 3 },
    ],
    // Se siembra con la forma de la APLICACIÓN (`bundle`, `product`): el doble
    // traduce a `bundle_id`/`product_id` al consultar, igual que PostgREST.
    product_bundle_item: [
      { _id: "it-1", organization_id: EMPRESA, bundle: PAQUETE, product: SAONA, day_offset: 0, sort_order: 1 },
      { _id: "it-2", organization_id: EMPRESA, bundle: PAQUETE, product: BUGGY, day_offset: 1, sort_order: 2 },
    ],
    departure: [],
    ...extra,
  });
}

const ctx = () => ({ companyId: EMPRESA, company: { timezone: "America/Santo_Domingo" } }) as never;

beforeEach(() => {
  db = base();
  sb = fakeSupabase(db);
});

describe("cargar la definición del paquete", () => {
  it("trae sus actividades en orden", async () => {
    const d = await loadBundle(EMPRESA, PAQUETE);
    expect(d).toBeTruthy();
    expect(d!.items.map((i) => i.productName)).toEqual(["Isla Saona", "Buggy Macao"]);
    expect(d!.items.map((i) => i.dayOffset)).toEqual([0, 1]);
    expect(d!.bufferMin).toBe(45);
  });

  it("un producto NORMAL no se puede tratar como paquete", async () => {
    /**
     * Es la puerta de entrada. Sin esta comprobación, vender una excursión
     * suelta por el camino del paquete crearía una cabecera con su precio y
     * CERO componentes: una venta cobrada que no reserva ninguna plaza y que no
     * aparece en ningún manifiesto.
     */
    expect(await loadBundle(EMPRESA, SAONA)).toBeNull();
  });

  it("un paquete que no existe devuelve null, no revienta", async () => {
    expect(await loadBundle(EMPRESA, "no-existe")).toBeNull();
  });

  it("sin margen configurado usa 30 minutos, no cero", async () => {
    // Cero minutos de margen encadenaría una actividad justo al acabar la
    // anterior: sobre el papel encaja y en la calle no llega nadie.
    db.seed("product", [{ _id: "p-sin", organization_id: EMPRESA, name: "Otro", is_bundle: true }]);
    db.seed("product_bundle_item", [
      { _id: "it-x", organization_id: EMPRESA, bundle: "p-sin", product: SAONA, day_offset: 0 },
    ]);
    expect((await loadBundle(EMPRESA, "p-sin"))!.bufferMin).toBe(30);
  });
});

describe("buscar las salidas que sirven", () => {
  const salida = (id: string, producto: string, at: string, extra: Record<string, unknown> = {}) => ({
    _id: id, organization_id: EMPRESA, product: producto,
    departure_at: at, capacity: 40, booked_pax: 0, pending_pax: 0, status: "available", ...extra,
  });

  it("descarta las que no están abiertas", async () => {
    /**
     * Una salida cancelada o cerrada no sirve para armar nada. Colarla en un
     * itinerario vende un paquete cuya segunda actividad no existe, y eso se
     * descubre el día del tour.
     */
    db.seed("departure", [
      salida("d-ok", SAONA, `${DIA}T12:00:00.000Z`),
      salida("d-cancel", SAONA, `${DIA}T13:00:00.000Z`, { status: "cancelled" }),
      salida("d-closed", SAONA, `${DIA}T14:00:00.000Z`, { status: "closed" }),
    ]);
    const items = (await loadBundle(EMPRESA, PAQUETE))!.items;
    const slots = await slotsFor(EMPRESA, items, DIA, "America/Santo_Domingo");
    expect(slots.map((s) => s.departureId)).toEqual(["d-ok"]);
  });

  it("calcula las plazas restando lo vendido y lo pendiente", async () => {
    db.seed("departure", [salida("d-1", SAONA, `${DIA}T12:00:00.000Z`, { capacity: 40, booked_pax: 25, pending_pax: 5 })]);
    const items = (await loadBundle(EMPRESA, PAQUETE))!.items;
    const [slot] = await slotsFor(EMPRESA, items, DIA, "America/Santo_Domingo");
    expect(slot.seatsLeft).toBe(10);
  });

  it("aforo CERO es «sin declarar», no «agotado»", async () => {
    /**
     * Es la convención del esquema desde 0004, y confundirla vacía el catálogo:
     * toda salida sin aforo declarado quedaría fuera de cualquier paquete.
     * El mismo error que costó el «0 plazas» en el punto de venta.
     */
    db.seed("departure", [salida("d-libre", SAONA, `${DIA}T12:00:00.000Z`, { capacity: 0 })]);
    const items = (await loadBundle(EMPRESA, PAQUETE))!.items;
    const [slot] = await slotsFor(EMPRESA, items, DIA, "America/Santo_Domingo");
    expect(slot.seatsLeft).toBeNull();
  });

  it("no devuelve negativos aunque haya sobreventa", async () => {
    db.seed("departure", [salida("d-over", SAONA, `${DIA}T12:00:00.000Z`, { capacity: 10, booked_pax: 14 })]);
    const items = (await loadBundle(EMPRESA, PAQUETE))!.items;
    const [slot] = await slotsFor(EMPRESA, items, DIA, "America/Santo_Domingo");
    expect(slot.seatsLeft).toBe(0);
  });

  it("sin actividades no consulta nada", async () => {
    expect(await slotsFor(EMPRESA, [], DIA)).toEqual([]);
  });
});

describe("armar el itinerario", () => {
  const salida = (id: string, producto: string, at: string, extra: Record<string, unknown> = {}) => ({
    _id: id, organization_id: EMPRESA, product: producto,
    departure_at: at, capacity: 40, booked_pax: 0, pending_pax: 0, status: "available", ...extra,
  });

  it("elige una salida por actividad, en sus días", async () => {
    db.seed("departure", [
      salida("d-saona", SAONA, `${DIA}T12:00:00.000Z`),
      salida("d-buggy", BUGGY, "2026-10-02T17:00:00.000Z"),
    ]);
    const plan = await planBundle(ctx(), { bundleId: PAQUETE, startDay: DIA, pax: 2 });
    expect(plan!.blocker).toBeNull();
    expect(plan!.blocks.map((b) => b.departureId).sort()).toEqual(["d-buggy", "d-saona"]);
  });

  it("si FALTA la salida de una actividad, NO se vende a medias", async () => {
    /**
     * EL INVARIANTE QUE PROTEGE AL CLIENTE.
     *
     * Un paquete con una actividad sin plaza no es «un paquete con dos de
     * tres»: es un cliente que pagó un precio cerrado por algo que no va a
     * recibir entero. Tiene que bloquear la venta, no recortarla en silencio.
     */
    db.seed("departure", [salida("d-saona", SAONA, `${DIA}T12:00:00.000Z`)]);
    const plan = await planBundle(ctx(), { bundleId: PAQUETE, startDay: DIA, pax: 2 });
    expect(plan!.blocker).toBeTruthy();
  });

  it("una salida sin plazas para el grupo bloquea el paquete", async () => {
    db.seed("departure", [
      salida("d-saona", SAONA, `${DIA}T12:00:00.000Z`, { capacity: 10, booked_pax: 9 }),
      salida("d-buggy", BUGGY, "2026-10-02T17:00:00.000Z"),
    ]);
    const plan = await planBundle(ctx(), { bundleId: PAQUETE, startDay: DIA, pax: 4 });
    expect(plan!.blocker).toBeTruthy();
  });

  it("un paquete que no existe devuelve null", async () => {
    expect(await planBundle(ctx(), { bundleId: "no-existe", startDay: DIA, pax: 1 })).toBeNull();
  });
});

describe("el paquete no se ofrece donde no se puede vender", () => {
  it("el catálogo del POS y el del portal excluyen los paquetes", async () => {
    /**
     * LA GUARDA QUE NACE DEL FALLO QUE TENÍA EL SISTEMA.
     *
     * Ninguno de los dos catálogos filtraba por `is_bundle`, así que un paquete
     * salía como una tarjeta normal. El cajero lo añadía y el fallo aparecía al
     * CONFIRMAR: «Falta el día en que empieza el paquete» — con el cliente
     * delante.
     *
     * Ofrecer algo que no se puede cobrar es peor que no ofrecerlo: lo segundo
     * se descubre al configurar, lo primero en el mostrador.
     *
     * El punto de venta SÍ los vende, pero por su propio camino: una lista
     * aparte y un diálogo que pide el día antes de dejar añadir nada.
     */
    const { readFileSync } = await import("node:fs");
    for (const ruta of ["src/app/api/pos/context/route.ts", "src/app/api/portal/catalog/route.ts"]) {
      const fuente = readFileSync(ruta, "utf8");
      const catalogo = /tenantQuery<Product>\([\s\S]*?\}\);/.exec(fuente)?.[0] ?? "";
      expect(catalogo, `${ruta}: no se encontró la consulta del catálogo`).toBeTruthy();
      expect(catalogo, `${ruta}: el catálogo volvería a ofrecer paquetes que fallan al cobrar`)
        .toMatch(/is_bundle:\s*false/);
    }
  });

  it("el punto de venta manda el día de inicio, sin el cual el servidor rechaza", async () => {
    const { readFileSync } = await import("node:fs");
    const pos = readFileSync("src/app/dashboard/pos/page.tsx", "utf8");
    expect(pos, "el POS no envía bundle_start_day y toda venta de paquete fallaría")
      .toMatch(/bundle_start_day:\s*i\.bundle_start_day/);
    // Y no deja añadir un paquete cuyo itinerario esté bloqueado.
    expect(pos, "se podría añadir un paquete que el servidor va a rechazar")
      .toMatch(/disabled=\{!bundlePlan \|\| !!bundlePlan\.blocker/);
  });
});
