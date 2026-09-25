import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * LA COBRANZA TIENE QUE LLEGAR HASTA LA ÚLTIMA CUOTA — Y DECIRLO SI NO.
 *
 * Este cron hacía cuatro barridos de la plataforma entera, los cuatro con un
 * tope fijo y ninguno con orden. El peor era el de las retenciones: el tope
 * caía sobre las FILAS pero lo que se sacaba de ellas eran EMPRESAS, así que
 * bastaba con que una operadora grande llenara la página para que a otra no se
 * le liberara ni una plaza. Y como el montón no cambia entre pasadas, era
 * siempre la misma operadora.
 *
 * Medido contra Postgres 16 con 2 500 retenciones vencidas: dos pasadas
 * seguidas devolvían exactamente las mismas mil filas —cero diferencias— y de
 * las 1 500 restantes no se tocaba ninguna. El barrido atendía retenciones de
 * hacía dieciséis horas mientras ignoraba, para siempre, una de hacía un día y
 * diecisiete.
 */

let cuotas: Record<string, unknown>[] = [];
let retenciones: Record<string, unknown>[] = [];
const empresasLiberadas: string[] = [];
const incidentes: string[] = [];

/** Un constructor de consultas con `range` de verdad. */
function lector(tabla: string) {
  const filtros: ((f: Record<string, unknown>) => boolean)[] = [];
  const api: Record<string, unknown> = {};
  const seguir = () => api;
  for (const n of ["select", "not", "in", "gte", "lte", "lt", "gt", "order", "limit"]) {
    api[n] = vi.fn(seguir);
  }
  api.eq = vi.fn((col: string, valor: unknown) => {
    filtros.push((f) => f[col] === undefined || f[col] === valor);
    return api;
  });
  const fuente = () => {
    if (tabla === "payment_schedule") return cuotas;
    if (tabla === "sales_order") return retenciones;
    return [];
  };
  api.range = vi.fn((desde: number, hasta: number) => Promise.resolve({
    data: fuente().filter((f) => filtros.every((p) => p(f))).slice(desde, hasta + 1),
    error: null,
  }));
  api.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
  api.update = vi.fn(() => {
    const u: Record<string, unknown> = {};
    let vueltas = 0;
    u.eq = vi.fn(() => (++vueltas >= 2 ? Promise.resolve({ error: null }) : u));
    return u;
  });
  return api;
}

vi.mock("@/lib/supabase/service", () => ({
  supabaseService: () => ({
    from: (t: string) => lector(t),
    rpc: vi.fn(async (nombre: string, args: Record<string, unknown>) => {
      if (nombre === "report_incident") incidentes.push(String(args.p_source));
      return { data: null, error: null };
    }),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: vi.fn() }));
vi.mock("@/lib/notify-service", () => ({ notify: vi.fn() }));
vi.mock("@/lib/messaging/service-store", () => ({ serviceStore: () => ({}) }));
vi.mock("@/lib/messaging/events", () => ({ notifyBalanceDue: vi.fn() }));
vi.mock("@/lib/booking-service", () => ({
  releaseExpiredHolds: vi.fn(async (companyId: string) => {
    empresasLiberadas.push(companyId);
    return { released: 1 };
  }),
}));
vi.mock("@/lib/waitlist-service", () => ({
  expireOffers: vi.fn(async () => ({ expired: 0, departures: [] })),
  offerFreedSeatsForCompany: vi.fn(),
}));
vi.mock("@/lib/octo-service", () => ({ markExpiredOctoHolds: vi.fn(async () => 0) }));
vi.mock("@/lib/system-health-service", async () => {
  const real = await vi.importActual<typeof import("@/lib/system-health-service")>("@/lib/system-health-service");
  // Solo el diario. `barridoVigilado` y `reportIncident` corren de verdad:
  // espiar el export no habría servido, porque uno llama al otro por el enlace
  // interno del módulo y la prueba saldría verde con el aviso apagado.
  return { ...real, startJobRun: vi.fn(async () => "run-1"), finishJobRun: vi.fn(async () => {}) };
});

import { GET } from "./collections/route";

const request = (auth?: string) =>
  ({ headers: { get: (n: string) => (n === "authorization" ? auth ?? null : null) } }) as NextRequest;

/** Retenciones vencidas repartidas entre dos operadoras, la segunda al final. */
function sembrarRetenciones(cuantas: number) {
  return Array.from({ length: cuantas }, (_, i) => ({
    id: `ord-${String(i).padStart(5, "0")}`,
    // La operadora B solo aparece en la última fila: es la que el tope de mil
    // se comía entera.
    organization_id: i === cuantas - 1 ? "org-B" : "org-A",
    status: "pending_payment",
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const m of ["error", "log", "warn"] as const) vi.spyOn(console, m).mockImplementation(() => {});
  process.env.CRON_SECRET = "s3cr3t";
  cuotas = [];
  retenciones = [];
  empresasLiberadas.length = 0;
  incidentes.length = 0;
});

afterEach(() => { delete process.env.CRON_SECRET; });

describe("GET /api/cron/collections · los cuatro barridos llegan al final", () => {
  it("libera el cupo de la operadora que estaba detrás del tope viejo", async () => {
    retenciones = sembrarRetenciones(2500);

    const res = await GET(request("Bearer s3cr3t"));
    expect(res.status).toBe(200);

    // Es EL fallo de la ola, en una línea: con `.limit(1000)` esta operadora no
    // salía en la lista y sus plazas se quedaban apartadas para siempre.
    expect(empresasLiberadas).toContain("org-B");
    expect(empresasLiberadas).toContain("org-A");
  });

  it("repasa TODAS las cuotas vencidas, no las primeras dos mil", async () => {
    cuotas = Array.from({ length: 2500 }, (_, i) => ({
      id: `cuota-${String(i).padStart(5, "0")}`,
      organization_id: "org-A",
      order_id: `ord-${i}`,
      booking_id: null, kind: "installment",
      due_date: "2020-01-01", amount: 100, paid_amount: 0, balance: 100,
      currency: "usd", status: "pending", reminded_at: null,
    }));

    const { data } = await (await GET(request("Bearer s3cr3t"))).json();
    // Con el tope de dos mil, quinientas cuotas vencidas seguían diciendo
    // «pendiente» y no entraban en ninguna lista de cobro.
    expect(data.installments.barrido.vistas).toBe(2500);
    expect(data.installments.barrido.truncado).toBe(false);
  });

  it("cuando un barrido no llega al final, DICE CUÁL y levanta un incidente", async () => {
    // Por encima del techo nuevo. Que el techo exista no es el problema; el
    // problema de antes era que no se oía.
    retenciones = sembrarRetenciones(20_500);

    const { data } = await (await GET(request("Bearer s3cr3t"))).json();

    expect(data.truncados).toContain("cupo");
    expect(incidentes).toContain("barrido:cobranza:retenciones");
  });

  it("y cuando todo cabe, no dice que se quedó corto", async () => {
    retenciones = sembrarRetenciones(10);

    const { data } = await (await GET(request("Bearer s3cr3t"))).json();

    // Un aviso que salta siempre es un aviso que nadie lee: por eso importa
    // tanto que esta lista esté vacía en el caso normal.
    expect(data.truncados).toEqual([]);
    expect(incidentes).toEqual([]);
  });

  it("sin la credencial del cron no barre nada", async () => {
    retenciones = sembrarRetenciones(10);
    const res = await GET(request("Bearer otro"));
    expect(res.status).toBe(401);
    expect(empresasLiberadas).toEqual([]);
  });
});
