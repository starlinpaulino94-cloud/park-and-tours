import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";

/**
 * EL CIERRE DEL DÍA, QUE NO TENÍA NINGUNA PRUEBA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ DECIDE ESTE SERVICIO, SI NO CALCULA NADA
 *
 * El cuadre lo hace `cierre-dia.ts`, que sí está probado. Lo que decide ESTE
 * fichero es **qué filas entran en el cuadre**, y eso es la mitad del resultado:
 * un cierre que lee el día equivocado cuadra perfectamente el día de otro.
 *
 * Tres decisiones, y las tres se prueban aquí porque ninguna vive en el dominio:
 *
 *   1. **Dónde se corta el día.** En la zona de la EMPRESA, no en la del
 *      servidor. El proceso corre en UTC; un cobro de las 21:00 en Santo Domingo
 *      son las 01:00 UTC del día siguiente.
 *   2. **Por qué columna pertenece cada tabla al día.** La caja va por
 *      `opened_at` y no por `closed_at`; la venta por `order_date`; el cobro por
 *      `paid_at`. Cambiar una sola de esas cinco mueve dinero de día.
 *   3. **Qué se dice cuando el documento está recortado.** Un total incompleto
 *      con cara de completo es peor que no tenerlo.
 */

let db: FakeDb;

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    tenantQuery: (...a: [string, string, Record<string, unknown>?]) => db.tenantQuery(...a),
  };
});

import { cierreDelDia } from "@/lib/cierre-dia-service";
import type { TenantContext } from "@/lib/tenant";

/** Santo Domingo va a UTC-4 todo el año: no tiene horario de verano. */
const SANTO_DOMINGO = "America/Santo_Domingo";

const ctx = (timezone: string | null = SANTO_DOMINGO) =>
  ({ companyId: "c1", company: { _id: "c1", name: "PT", timezone } } as unknown as TenantContext);

beforeEach(() => { db = fakeDb(); });

describe("dónde se corta el día", () => {
  it("EN LA ZONA DE LA EMPRESA, NO EN LA DEL SERVIDOR", async () => {
    /**
     * El cobro de las 21:00 del día 10 en Santo Domingo se guarda como 01:00 UTC
     * del día 11. Cortando en UTC se le achacaría al día siguiente: el cierre del
     * 10 saldría corto y el del 11 largo, los dos cuadrando, y nadie lo notaría
     * hasta que alguien contara el efectivo a mano.
     */
    db.seed("payment", [
      { _id: "p-tarde", paid_at: "2026-04-11T01:00:00.000Z", amount: 100, status: "completed", method: "cash" },
    ]);
    const cierre = await cierreDelDia(ctx(), "2026-04-10");
    expect(cierre.cobros.total, "el cobro de las 21:00 se fue al día siguiente").toBe(100);
  });

  it("y lo del día siguiente NO entra", async () => {
    // El otro lado del mismo corte: sin él, el día se comería el de mañana.
    db.seed("payment", [
      { _id: "p-manana", paid_at: "2026-04-11T05:00:00.000Z", amount: 100, status: "completed", method: "cash" },
    ]);
    const cierre = await cierreDelDia(ctx(), "2026-04-10");
    expect(cierre.cobros.total).toBe(0);
  });

  it("una zona distinta mueve el corte de verdad", async () => {
    /**
     * La misma fila, dos empresas, dos días. Si el corte estuviera fijo —o saliera
     * del servidor— este par de afirmaciones no podría cumplirse a la vez.
     */
    db.seed("payment", [
      { _id: "p", paid_at: "2026-04-11T01:00:00.000Z", amount: 50, status: "completed", method: "cash" },
    ]);
    expect((await cierreDelDia(ctx(SANTO_DOMINGO), "2026-04-10")).cobros.total).toBe(50);
    expect((await cierreDelDia(ctx("Europe/Madrid"), "2026-04-10")).cobros.total).toBe(0);
  });

  it("y la zona sale en el documento, para que el papel lo pueda decir", async () => {
    // Un cierre sin decir en qué zona se cortó no se puede discutir: dos personas
    // mirando el mismo papel no sabrían si hablan del mismo día.
    expect((await cierreDelDia(ctx(), "2026-04-10")).timezone).toBe(SANTO_DOMINGO);
  });

  it("una empresa sin zona declarada no rompe el cierre", async () => {
    // Cae en la zona por defecto en vez de reventar: un dato de configuración que
    // falta no puede dejar a nadie sin cerrar el día.
    const cierre = await cierreDelDia(ctx(null), "2026-04-10");
    expect(cierre.timezone).toBeTruthy();
  });
});

describe("por qué columna pertenece cada tabla al día", () => {
  it("LA CAJA VA POR CUÁNDO SE ABRIÓ, no por cuándo se cerró", async () => {
    /**
     * La caja pertenece al día en que se abrió, aunque se cierre pasada la
     * medianoche. Por `closed_at` se perdería entera la caja que cerró a las
     * 00:30 — que es justo la de la noche que hay que cuadrar, y la que lleva el
     * efectivo de la jornada dentro.
     */
    db.seed("cash_session", [
      {
        _id: "caja-noche",
        opened_at: "2026-04-10T16:00:00.000Z",   // 12:00 local del día 10
        closed_at: "2026-04-11T04:30:00.000Z",   // 00:30 local del día 11
        status: "closed", counted_cash: 0, expected_cash: 0,
      },
    ]);
    const cierre = await cierreDelDia(ctx(), "2026-04-10");
    expect(cierre.caja.veredicto, "la caja de la noche se perdió").not.toBe("sin_cierre");
  });

  it("cada tabla se lee por SU columna de fecha", async () => {
    /**
     * Cinco tablas y cinco columnas distintas. Se comprueba que cada consulta pide
     * la suya: filtrar `sales_order` por `paid_at` —o `payment` por `order_date`—
     * no daría error, devolvería cero filas, y el cierre saldría en blanco con cara
     * de día tranquilo.
     */
    const pedidas: Record<string, string[]> = {};
    const original = db.tenantQuery;
    db.tenantQuery = async (org: string, tabla: string, opts?: Record<string, unknown>) => {
      const filtro = (opts?._filter ?? {}) as Record<string, unknown>;
      pedidas[tabla] = Object.keys(filtro);
      return original(org, tabla, opts);
    };

    await cierreDelDia(ctx(), "2026-04-10");

    expect(pedidas).toEqual({
      departure: ["departure_at"],
      sales_order: ["order_date"],
      payment: ["paid_at"],
      cash_session: ["opened_at"],
      incident: ["occurred_at"],
    });
  });
});

describe("qué se dice cuando el documento no es el día entero", () => {
  it("SE AVISA DE QUE ESTÁ RECORTADO", async () => {
    /**
     * Mil filas es el tope por tabla. Llegando a él, el documento deja de ser el
     * día y pasa a ser «las primeras mil de algo» — y un total incompleto con cara
     * de completo es peor que no tenerlo: alguien lo firma.
     */
    db.seed("payment", Array.from({ length: 1000 }, (_, i) => ({
      _id: `p${i}`, paid_at: "2026-04-10T16:00:00.000Z",
      amount: 1, status: "completed", method: "cash",
    })));
    const cierre = await cierreDelDia(ctx(), "2026-04-10");
    expect(cierre.recortado).toBe(true);
  });

  it("y un día normal NO sale marcado", async () => {
    // El aviso tiene que significar algo: marcarlo siempre sería no marcarlo.
    db.seed("payment", [
      { _id: "p1", paid_at: "2026-04-10T16:00:00.000Z", amount: 10, status: "completed", method: "cash" },
    ]);
    expect((await cierreDelDia(ctx(), "2026-04-10")).recortado).toBe(false);
  });
});

describe("la fecha que se pide", () => {
  it("una fecha ilegible cae en HOY, no en 1970", async () => {
    /**
     * Es lo que hace el resto de los reportes, y la alternativa es peor: un cierre
     * del 1 de enero de 1970 sale vacío y cuadrado, que es indistinguible de un día
     * sin actividad.
     */
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T16:00:00Z"));
    const cierre = await cierreDelDia(ctx(), "no-es-una-fecha");
    expect(cierre.fecha).toBe("2026-04-10");
    vi.useRealTimers();
  });

  it("sin fecha, el día de hoy EN LA ZONA DE LA EMPRESA", async () => {
    // A las 21:00 de Santo Domingo el servidor ya está en el día siguiente. El
    // cierre que se pide «de hoy» tiene que ser el de hoy para quien lo pide.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-11T01:00:00Z"));
    expect((await cierreDelDia(ctx(), null)).fecha).toBe("2026-04-10");
    vi.useRealTimers();
  });
});
