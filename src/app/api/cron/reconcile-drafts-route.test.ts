import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * LAS VENTAS QUE SE QUEDARON A MEDIAS.
 *
 * `createOrderWithBookings` es una saga: crea la orden en `draft`, escribe
 * reservas, vouchers, comisiones y cuentas por cobrar, y al final la promueve.
 * Si algo LANZA, la compensación lo deshace dentro de la misma petición.
 *
 * Pero si el PROCESO MUERE no hay excepción que capturar, y lo que queda es una
 * orden `draft` con sus reservas apartando plazas, un voucher que escanea como
 * válido, una comisión `pending` que la próxima liquidación PAGA y una cuenta por
 * cobrar que parece cobrable. Una venta que no existió, con todos sus efectos.
 *
 * `reconcileStaleDrafts` existía para eso desde AUD-F34 y **nada la ejecutaba**:
 * su única puerta exigía sesión de admin y mismo origen, que es justo lo que un
 * programador de tareas no tiene. No estaba mal escrita — estaba sin enchufar.
 */

let borradores: { id: string; organization_id: string; created_at: string }[] = [];
/** El corte que pidió la consulta, para comprobar que acota por antigüedad. */
let corteVisto: string | null = null;
const leidas: { desde: number; hasta: number }[] = [];
const reconciliadas: { empresa: string; minutos: number }[] = [];
const auditoria: { companyId?: string; action: string; severity?: string }[] = [];
const incidentes: string[] = [];
let reconciliarFalla: string | null = null;

/** Un lector que respeta la ventana: sin eso, no avanzar saldría en verde. */
function lector() {
  const api: Record<string, unknown> = {};
  const seguir = () => api;
  for (const n of ["select", "eq", "order"]) api[n] = vi.fn(seguir);
  /**
   * `lt` NO es decorativo aquí.
   *
   * Sin el corte por antigüedad, este cron barrería los borradores que están EN
   * VUELO ahora mismo y revertiría ventas vivas — el fallo en la dirección
   * peligrosa. El lector falso lo aplica de verdad para que quitarlo se note.
   */
  api.lt = vi.fn((col: string, valor: string) => {
    if (col === "created_at") corteVisto = valor;
    return api;
  });
  api.range = vi.fn((desde: number, hasta: number) => {
    leidas.push({ desde, hasta });
    // Solo los anteriores al corte, como haría Postgres. Sin corte, todos.
    const vistos = corteVisto
      ? borradores.filter((b) => b.created_at < corteVisto!)
      : borradores;
    return Promise.resolve({ data: vistos.slice(desde, hasta + 1), error: null });
  });
  return api;
}

vi.mock("@/lib/supabase/service", () => ({
  supabaseService: () => ({
    from: () => lector(),
    rpc: vi.fn(async (nombre: string, args: Record<string, unknown>) => {
      if (nombre === "report_incident") incidentes.push(String(args.p_source));
      return { data: null, error: null };
    }),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn(async (e: { companyId?: string; action: string; severity?: string }) => {
    auditoria.push(e);
  }),
}));
vi.mock("@/lib/booking-service", () => ({
  reconcileStaleDrafts: vi.fn(async (empresa: string, minutos: number) => {
    reconciliadas.push({ empresa, minutos });
    if (reconciliarFalla === empresa) throw new Error("se cayó la reconciliación");
    const suyos = borradores.filter((b) => b.organization_id === empresa).length;
    return { scanned: suyos, reverted: suyos };
  }),
}));
vi.mock("@/lib/system-health-service", async () => {
  const real = await vi.importActual<typeof import("@/lib/system-health-service")>("@/lib/system-health-service");
  // Solo el diario: `barridoVigilado` y `reportIncident` corren de verdad.
  return { ...real, startJobRun: vi.fn(async () => "run-1"), finishJobRun: vi.fn(async () => {}) };
});

import { GET } from "./reconcile-drafts/route";

const request = (auth?: string) =>
  ({ headers: { get: (n: string) => (n === "authorization" ? auth ?? null : null) } }) as NextRequest;

/** Borradores viejos de verdad: dos horas atrás, fuera de la ventana de una. */
const sembrar = (cuantos: number, empresa = "org-A") =>
  Array.from({ length: cuantos }, (_, i) => ({
    id: `ord-${String(i).padStart(5, "0")}`,
    organization_id: empresa,
    created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  }));

/** Y uno recién nacido: una saga en vuelo, que NO se puede tocar. */
const enVuelo = (empresa = "org-viva") => ({
  id: "ord-en-vuelo", organization_id: empresa,
  created_at: new Date().toISOString(),
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const m of ["error", "log", "warn"] as const) vi.spyOn(console, m).mockImplementation(() => {});
  process.env.CRON_SECRET = "s3cr3t";
  borradores = [];
  corteVisto = null;
  leidas.length = 0;
  reconciliadas.length = 0;
  auditoria.length = 0;
  incidentes.length = 0;
  reconciliarFalla = null;
});

afterEach(() => { delete process.env.CRON_SECRET; });

describe("GET /api/cron/reconcile-drafts", () => {
  it("revierte las ventas a medias que encuentra", async () => {
    borradores = sembrar(3);

    const { data } = await (await GET(request("Bearer s3cr3t"))).json();

    expect(data.reverted).toBe(3);
    expect(reconciliadas.map((r) => r.empresa)).toEqual(["org-A"]);
  });

  it("usa una ventana de una hora, no la de treinta minutos de la ruta manual", async () => {
    /**
     * Esto corre sin nadie mirando y sobre TODAS las empresas, así que un falso
     * positivo revierte una venta buena. Una saga normal tarda menos de un
     * segundo: entre un segundo y una hora solo caben las que de verdad murieron.
     */
    borradores = sembrar(1);
    await GET(request("Bearer s3cr3t"));
    expect(reconciliadas[0].minutos).toBe(60);
  });

  it("recorre TODAS las empresas, también la que está al final de la lista", async () => {
    // Es el fallo de la ola 9.11 aplicado aquí: con un tope fijo, la operadora
    // que quedaba detrás no recuperaba sus plazas NUNCA.
    borradores = [...sembrar(1200, "org-A"), ...sembrar(1, "org-Z")];

    await GET(request("Bearer s3cr3t"));

    expect(reconciliadas.map((r) => r.empresa).sort()).toEqual(["org-A", "org-Z"]);
  });

  it("y pide ventanas que AVANZAN", async () => {
    borradores = sembrar(1200);
    await GET(request("Bearer s3cr3t"));
    const inicios = leidas.map((l) => l.desde);
    expect(inicios[0]).toBe(0);
    expect(new Set(inicios).size).toBe(inicios.length);
    expect(inicios).toEqual([...inicios].sort((a, b) => a - b));
  });

  it("deja rastro en la bitácora DE ESA EMPRESA, con severidad de aviso", async () => {
    /**
     * Revertir sin dejar rastro es peor que no revertir: al día siguiente falta
     * una orden que alguien recuerda haber hecho y nada lo explica.
     */
    borradores = sembrar(2);

    await GET(request("Bearer s3cr3t"));

    const linea = auditoria.find((a) => a.action === "drafts_reconciled");
    expect(linea?.companyId).toBe("org-A");
    expect(linea?.severity).toBe("warning");
  });

  it("y si no había nada a medias, no ensucia la bitácora ni la salud", async () => {
    // Un aviso que salta siempre es un aviso que nadie lee.
    borradores = [];

    const { data } = await (await GET(request("Bearer s3cr3t"))).json();

    expect(data.reverted).toBe(0);
    expect(auditoria).toEqual([]);
    expect(incidentes).toEqual([]);
  });

  it("cada reversión sube a la pantalla de salud: es un proceso que murió vendiendo", async () => {
    borradores = sembrar(1);
    await GET(request("Bearer s3cr3t"));
    expect(incidentes).toContain("cron:reconcile-drafts");
  });

  it("una empresa que falla no deja a las demás con las plazas apartadas", async () => {
    borradores = [...sembrar(1, "org-mala"), ...sembrar(1, "org-buena")];
    reconciliarFalla = "org-mala";

    const { data } = await (await GET(request("Bearer s3cr3t"))).json();

    expect(data.failed).toEqual(["org-mala"]);
    expect(reconciliadas.map((r) => r.empresa)).toContain("org-buena");
  });

  it("NO toca una venta en vuelo: revertir una viva es el fallo peligroso", async () => {
    /**
     * Una saga normal tarda menos de un segundo. Si este barrido no acotara por
     * antigüedad, cogería los borradores que se están escribiendo AHORA y
     * cancelaría ventas buenas con el cliente delante — mucho peor que dejar una
     * huérfana viviendo una hora de más.
     */
    borradores = [...sembrar(2), enVuelo()];

    const { data } = await (await GET(request("Bearer s3cr3t"))).json();

    expect(corteVisto, "la consulta no acotó por antigüedad").not.toBeNull();
    expect(reconciliadas.map((r) => r.empresa)).not.toContain("org-viva");
    expect(data.reverted).toBe(2);
  });

  it("y si TODO está en vuelo, no revierte nada", async () => {
    borradores = [enVuelo("org-A"), enVuelo("org-B")];
    const { data } = await (await GET(request("Bearer s3cr3t"))).json();
    expect(data.reverted).toBe(0);
    expect(reconciliadas).toEqual([]);
  });

  it("sin la credencial del cron no revierte nada", async () => {
    borradores = sembrar(5);
    const res = await GET(request("Bearer otro"));
    expect(res.status).toBe(401);
    expect(reconciliadas).toEqual([]);
  });
});
