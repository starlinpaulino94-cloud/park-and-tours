import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, paxTotalsDeLaBase, type FakeDb } from "@/test/fake-tenant";

/**
 * LA ÚNICA GUARDA CONTRA LA SOBREVENTA, PROBADA.
 *
 * Este módulo dice de sí mismo dos cosas: «the single guard against
 * overselling» y «the counters can never silently drift out of sync with
 * reality». Las dos eran falsas por un `_limit: 1000`.
 *
 * `recalculateDeparture` sumaba los pasajeros de la salida leyendo hasta mil
 * reservas. Una salida de entrada general de un parque —dos mil entradas al
 * día— pasa de mil sin nada raro, y entonces:
 *
 *   · la suma salía CORTA,
 *   · así que `available_pax` salía ALTA,
 *   · así que `assertCapacity` DEJABA PASAR la venta que no cabía.
 *
 * La guarda no fallaba: aprobaba. Desde 0094 la suma la hace Postgres, sin
 * tope, y estas pruebas la ejercitan por encima del techo viejo.
 */

let db: FakeDb;

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    tenantQuery: (...a: [string, string, Record<string, unknown>?]) => db.tenantQuery(...a),
    tenantUpdate: (...a: [string, string, string, Record<string, unknown>]) => db.tenantUpdate(...a),
  };
});

/**
 * El recuento corre de verdad sobre la base en memoria.
 *
 * No se puede falsear con una constante: es justo el número que decide si cabe
 * la venta, así que una respuesta fija haría pasar en verde la prueba de que el
 * cupo se respeta — que es la única que importa aquí.
 */
const rpc = vi.fn(async (nombre: string, args: Record<string, unknown>) => {
  if (nombre === "departure_pax_totals") return paxTotalsDeLaBase(db)(args);
  return { data: null, error: null };
});
vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => ({ rpc }) }));

import { recalculateDeparture, assertCapacity, OversellError } from "@/lib/availability";

const ORG = "org-1";
const SALIDA = "sal-1";

/** Una salida con capacidad y fecha lejana, para que el cierre no estorbe. */
function conCapacidad(capacity: number, extra: Record<string, unknown> = {}) {
  return fakeDb({
    departure: [{
      _id: SALIDA, organization_id: ORG, capacity,
      departure_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      status: "available", cutoff_hours: 0, ...extra,
    }],
  });
}

/** `cuantas` reservas de `pax` plazas cada una, en el estado que se diga. */
function reservas(cuantas: number, status: string, pax: number) {
  return Array.from({ length: cuantas }, (_, i) => ({
    _id: `res-${String(i).padStart(5, "0")}`,
    organization_id: ORG, departure: SALIDA, status, pax_total: pax,
  }));
}

beforeEach(() => {
  rpc.mockClear();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("el recuento", () => {
  it("separa lo confirmado de lo pendiente", async () => {
    db = conCapacidad(100);
    db.seed("booking", [...reservas(3, "paid", 2), ...reservas(2, "pending", 1)
      .map((r, i) => ({ ...r, _id: `pend-${i}` }))]);

    const estado = await recalculateDeparture(ORG, SALIDA);

    expect(estado.bookedPax).toBe(6);
    expect(estado.pendingPax).toBe(2);
    // Lo pendiente OCUPA: una plaza retenida no está libre.
    expect(estado.availablePax).toBe(92);
  });

  it("lo cancelado no ocupa asiento", async () => {
    db = conCapacidad(10);
    db.seed("booking", [
      ...reservas(1, "paid", 2),
      { _id: "anu", organization_id: ORG, departure: SALIDA, status: "cancelled", pax_total: 8 },
    ]);

    const estado = await recalculateDeparture(ORG, SALIDA);

    expect(estado.bookedPax).toBe(2);
    expect(estado.availablePax).toBe(8);
  });

  it("escribe los contadores en la salida", async () => {
    db = conCapacidad(50);
    db.seed("booking", reservas(4, "confirmed", 3));

    await recalculateDeparture(ORG, SALIDA);

    const [salida] = db.rows("departure").filter((d) => d._id === SALIDA);
    expect(salida.booked_pax).toBe(12);
    expect(salida.available_pax).toBe(38);
  });

  it("un recuento que no se pudo hacer NO es cero", async () => {
    /**
     * Devolver ceros aquí diría «la salida está vacía», y el efecto de eso es
     * que cabe todo el mundo: la sobreventa entraría por el hueco de una
     * consulta caída. Se lanza, y la venta no se registra — que es la respuesta
     * correcta cuando no se sabe si hay sitio.
     */
    db = conCapacidad(10);
    rpc.mockResolvedValueOnce({ data: null, error: { message: "se cayó la conexión" } });

    await expect(recalculateDeparture(ORG, SALIDA)).rejects.toThrow(/no se pudieron contar/i);
  });

  it("una salida que no existe no es una salida con sitio", async () => {
    db = conCapacidad(10);
    await expect(recalculateDeparture(ORG, "no-existe")).rejects.toThrow(/no encontrada/i);
  });

  it("si el recuento dice que NO encontró la salida, no vale que la ficha sí exista", async () => {
    /**
     * Son dos comprobaciones distintas y hacen falta las dos.
     *
     * La ficha de la salida se lee con las ayudas de inquilino; el recuento lo
     * hace la función de la base, que acota por empresa por su cuenta. Cuando
     * discrepan —la ficha está, el recuento dice que no— lo que no se puede
     * hacer es creerle a la ficha y seguir con cero pasajeros: cero pasajeros
     * quiere decir «caben todos», y eso es una venta autorizada contra una
     * salida que la base no reconoce como de esta empresa.
     *
     * Sin esta prueba, quitar el `found` del código pasaba desapercibido,
     * porque la comprobación de la ficha tapaba el caso fácil.
     */
    db = conCapacidad(10);
    rpc.mockResolvedValueOnce({ data: { found: false }, error: null });

    await expect(recalculateDeparture(ORG, SALIDA)).rejects.toThrow(/no encontrada/i);
    // Y no se escribió nada en la salida.
    const [salida] = db.rows("departure").filter((d) => d._id === SALIDA);
    expect(salida.booked_pax).toBeUndefined();
  });
});

describe("una salida con más de mil reservas", () => {
  it("cuenta TODAS: con el tope viejo decía tener sitio para mil personas que no caben", async () => {
    // 1 500 reservas de 2 plazas = 3 000 plazas, en una salida de 3 000.
    db = conCapacidad(3000);
    db.seed("booking", reservas(1500, "paid", 2));

    const estado = await recalculateDeparture(ORG, SALIDA);

    // Con `_limit: 1000` esto daba 2 000 y sobraban mil plazas que no existían.
    expect(estado.bookedPax).toBe(3000);
    expect(estado.availablePax).toBe(0);
    expect(estado.status).toBe("full");
  });

  it("y la venta que no cabe se RECHAZA, que es lo que fallaba", async () => {
    db = conCapacidad(3000);
    db.seed("booking", reservas(1500, "paid", 2));

    // Es la prueba de la ola: antes esta llamada pasaba, porque la guarda creía
    // que quedaban mil plazas.
    await expect(assertCapacity(ORG, SALIDA, 1)).rejects.toThrow(OversellError);
  });

  it("y si de verdad cabe, pasa", async () => {
    db = conCapacidad(3010);
    db.seed("booking", reservas(1500, "paid", 2));

    const estado = await assertCapacity(ORG, SALIDA, 10);
    expect(estado.availablePax).toBe(10);
  });

  it("el semáforo de «casi llena» también salía mal, y en la misma dirección", async () => {
    /**
     * Con el tope, una salida al 95 % se veía al 63 %: el despacho, la previsión
     * de ocupación y este semáforo mentían los tres a la vez y todos hacia
     * «queda sitio». Un error que va siempre en el mismo sentido no se
     * compensa: se acumula.
     */
    db = conCapacidad(3200);
    db.seed("booking", reservas(1520, "paid", 2)); // 3 040 de 3 200 = 95 %

    const estado = await recalculateDeparture(ORG, SALIDA);
    expect(estado.status).toBe("almost_full");
  });
});

describe("el override sigue siendo la única forma de forzar", () => {
  it("con override se vende por encima del cupo", async () => {
    db = conCapacidad(2);
    db.seed("booking", reservas(1, "paid", 2));

    // El que llama tiene que auditarlo: eso lo comprueba la guarda de la venta.
    const estado = await assertCapacity(ORG, SALIDA, 5, true);
    expect(estado.availablePax).toBe(0);
  });

  it("sin override, no", async () => {
    db = conCapacidad(2);
    db.seed("booking", reservas(1, "paid", 2));
    await expect(assertCapacity(ORG, SALIDA, 1)).rejects.toThrow(OversellError);
  });
});
