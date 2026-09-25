import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * EL BARRIDO DE CUPOS TIENE QUE LLEGAR AL FINAL.
 *
 * Antes leía con `.limit(3000)` y sin orden. Medido contra Postgres 16, dos
 * pasadas seguidas sobre los mismos datos devolvían EXACTAMENTE las mismas
 * filas: lo que caía fuera del tope no se retrasaba, no se reintentaba y no se
 * avisaba — se quedaba sin liberar para siempre, y eran plazas garantizadas a
 * un socio que ya no las iba a usar y que nadie más podía vender.
 *
 * Por eso estas pruebas no miran cuántos cupos se revisaron: miran CUÁLES. Un
 * barrido que trata tres mil de tres mil quinientos y uno que los trata todos
 * dan el mismo tipo de respuesta y distinta lista.
 */

/** Cuántos cupos hay en la base de mentira: por encima del tope viejo. */
const CUANTOS = 3500;

const leidas: { desde: number; hasta: number }[] = [];
/** Columnas por las que se pidió orden, en la última lectura de cupos. */
let ordenPedido: string[] = [];
let cupos: Record<string, unknown>[] = [];
const actualizados: string[] = [];
const incidentes: { source: string }[] = [];

/** Un constructor de consultas que respeta `range` de verdad. */
function lector(tabla: string) {
  const filtros: ((f: Record<string, unknown>) => boolean)[] = [];
  const api: Record<string, unknown> = {};
  const encadenar = () => api;
  for (const nombre of ["select", "eq", "not", "in", "gte", "lte", "lt"]) {
    api[nombre] = vi.fn(encadenar);
  }
  api.order = vi.fn((col: string) => {
    if (tabla === "allotment") ordenPedido.push(col);
    return api;
  });
  api.range = vi.fn((desde: number, hasta: number) => {
    if (tabla === "allotment") leidas.push({ desde, hasta });
    const fuente = tabla === "allotment" ? cupos : [];
    return Promise.resolve({
      data: fuente.filter((f) => filtros.every((p) => p(f))).slice(desde, hasta + 1),
      error: null,
    });
  });
  api.update = vi.fn((_patch: Record<string, unknown>) => {
    const u: Record<string, unknown> = {};
    let id = "";
    u.eq = vi.fn((col: string, valor: string) => {
      if (col === "id") id = valor;
      // La segunda `eq` cierra la escritura.
      return col === "organization_id"
        ? Promise.resolve({ error: null }).then((r) => { actualizados.push(id); return r; })
        : u;
    });
    return u;
  });
  return api;
}

vi.mock("@/lib/supabase/service", () => ({
  supabaseService: () => ({
    from: (t: string) => lector(t),
    // `reportIncident` escribe por RPC. Se deja el camino REAL y se captura
    // aquí: espiar el export del módulo de salud no habría servido, porque
    // `barridoVigilado` llama a su vecino por el enlace interno del módulo y
    // no por el export — la prueba habría salido verde con el aviso apagado.
    rpc: vi.fn(async (nombre: string, args: Record<string, unknown>) => {
      if (nombre === "report_incident") incidentes.push({ source: String(args.p_source) });
      return { data: null, error: null };
    }),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: vi.fn() }));
vi.mock("@/lib/notify-service", () => ({ notify: vi.fn() }));
vi.mock("@/lib/system-health-service", async () => {
  const real = await vi.importActual<typeof import("@/lib/system-health-service")>("@/lib/system-health-service");
  // Solo el diario de ejecuciones se sustituye: `barridoVigilado` y
  // `reportIncident` corren de verdad.
  return { ...real, startJobRun: vi.fn(async () => "run-1"), finishJobRun: vi.fn(async () => {}) };
});

import { GET } from "./allotments/route";

const request = (auth?: string) =>
  ({ headers: { get: (n: string) => (n === "authorization" ? auth ?? null : null) } }) as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  process.env.CRON_SECRET = "s3cr3t";
  leidas.length = 0;
  actualizados.length = 0;
  incidentes.length = 0;
  ordenPedido = [];
  cupos = Array.from({ length: CUANTOS }, (_, i) => ({
    id: `cupo-${String(i).padStart(5, "0")}`,
    organization_id: "org-1",
    allotment_type: "guaranteed",
    status: "active",
    seats: 10,
    seats_used: 0,
    seats_released: 0,
    release_days: 3,
    release_runs: 0,
    // Sin salida no hay fecha contra la que contar: se deja nula a propósito
    // para que el bucle no intente liberar y la prueba mida SOLO el barrido.
    departure_id: null,
    partner_id: null,
  }));
});

afterEach(() => { delete process.env.CRON_SECRET; });

describe("GET /api/cron/allotments · el barrido llega al final", () => {
  it("revisa TODOS los cupos, también los que caían fuera del tope viejo", async () => {
    const res = await GET(request("Bearer s3cr3t"));
    const body = await res.json();

    expect(res.status).toBe(200);
    // Lo que de verdad importa: no se quedó en 3 000.
    expect(body.data.reviewed).toBe(CUANTOS);
    expect(body.data.barrido.truncado).toBe(false);
  });

  it("pide VENTANAS que avanzan, no la misma una y otra vez", async () => {
    await GET(request("Bearer s3cr3t"));

    // Un recorrido que no avanzara pediría siempre `desde: 0` y daría vueltas
    // sobre las mismas quinientas filas para siempre.
    const inicios = leidas.map((l) => l.desde);
    expect(inicios[0]).toBe(0);
    expect(new Set(inicios).size).toBe(inicios.length);
    expect(inicios).toEqual([...inicios].sort((a, b) => a - b));
  });

  it("cubre el rango entero sin huecos ni solapes", async () => {
    await GET(request("Bearer s3cr3t"));

    // Un hueco es una fila que nadie trata; un solape es una fila tratada dos
    // veces. Las dos cosas son fallos, y las dos se ven aquí.
    for (let i = 1; i < leidas.length; i++) {
      expect(leidas[i].desde).toBe(leidas[i - 1].hasta + 1);
    }
  });

  it("pide un orden ESTABLE, con desempate por identidad", async () => {
    await GET(request("Bearer s3cr3t"));

    // Paginar sin orden declarado es el fallo silencioso de la paginación:
    // Postgres puede devolver dos páginas que se solapan, y entonces una fila
    // se trata dos veces y otra no se trata nunca. Y ordenar solo por la fecha
    // no basta: dos cupos de la misma salida quedan empatados, y el empate se
    // deshace como quiera el plan de ejecución. Hace falta el desempate por
    // identidad, que es único.
    expect(ordenPedido).toContain("id");
    expect(ordenPedido.length).toBeGreaterThanOrEqual(2);
    // Y el desempate va el ÚLTIMO: primero el criterio que importa.
    expect(ordenPedido[ordenPedido.length - 1]).toBe("id");
  });

  it("cuando de verdad hay demasiado, se planta Y LEVANTA UN INCIDENTE", async () => {
    // Veinte mil uno: el techo nuevo. Que exista no es el problema; el
    // problema de antes era que no se oía.
    cupos = Array.from({ length: 20_500 }, (_, i) => ({
      ...cupos[0], id: `cupo-${String(i).padStart(6, "0")}`,
    }));

    const res = await GET(request("Bearer s3cr3t"));
    const body = await res.json();

    expect(body.data.barrido.truncado).toBe(true);
    expect(incidentes.map((i) => i.source)).toContain("barrido:cupos:liberacion");
  });
});
