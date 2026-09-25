import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * EL DESPACHO Y LA LICENCIA VENCIDA (ola 9.13).
 *
 * Esta pantalla es donde se decide quién sale. Marca al chofer cuya
 * acreditación bloqueante ha caducado —`certification_blocked`— para que no se
 * descubra en el muelle.
 *
 * Leía las acreditaciones con `_limit: 2000`, y encima de la consulta había un
 * comentario que decía «la lista entera cabe de sobra en una consulta». Era una
 * suposición escrita y nunca comprobada: cuatrocientas personas con seis
 * acreditaciones cada una ya no caben. Y lo que se queda fuera no es una fila
 * de una lista — es justamente la licencia vencida que la pantalla existe para
 * enseñar.
 *
 * La guarda no falla: **aprueba**. Por eso estas pruebas no cuentan filas:
 * comprueban que al chofer se le sigue marcando cuando su acreditación está
 * detrás del tope viejo.
 */

const tenantQuery = vi.fn();

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return { ...actual, tenantQuery: (...a: unknown[]) => tenantQuery(...a) };
});
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));

import { loadDispatch } from "@/lib/dispatch-service";

const ORG = "org-1";
const DIA = "2026-09-15";
const ctx = {
  companyId: ORG, userId: "u1", role: "admin",
  company: { _id: ORG, timezone: "America/Santo_Domingo" },
} as unknown as Parameters<typeof loadDispatch>[0];

/** El chofer del día, asignado a la única salida. */
const CHOFER = { _id: "chofer-1", full_name: "Ramón", staff_type: "driver" };

const SALIDA = {
  _id: "sal-1", organization_id: ORG,
  departure_at: `${DIA}T13:00:00.000Z`,
  product: { _id: "p1", name: "Isla Saona" },
  booking: [],
  departure_resource: [{ _id: "r1", resource_role: "driver", staff: CHOFER }],
  pickup_route: [],
};

/**
 * Acreditaciones de relleno, vigentes y de otra gente, MÁS la vencida del
 * chofer AL FINAL — que es donde el tope viejo la dejaba fuera.
 */
function acreditaciones(relleno: number, vencidaDelChofer: boolean) {
  const filas: Record<string, unknown>[] = Array.from({ length: relleno }, (_, i) => ({
    _id: `c-${String(i).padStart(5, "0")}`,
    staff: `otro-${i}`,
    name: "Idiomas",
    blocks_assignment: false,
    expires_at: "2099-01-01",
  }));
  if (vencidaDelChofer) {
    filas.push({
      _id: "c-licencia",
      staff: "chofer-1",
      name: "Licencia de conducir",
      blocks_assignment: true,
      expires_at: "2020-01-01",
    });
  }
  return filas;
}

/** `tenantQuery` respetando la ventana: sin eso, no avanzar saldría en verde. */
function conAcreditaciones(filas: Record<string, unknown>[]) {
  tenantQuery.mockImplementation((_o: string, tabla: string, opts: Record<string, number>) => {
    if (tabla === "certification") {
      const salto = Number(opts?._offset ?? 0);
      const limite = Number(opts?._limit ?? 50);
      return Promise.resolve(filas.slice(salto, salto + limite));
    }
    if (tabla === "departure") return Promise.resolve([SALIDA]);
    return Promise.resolve([]);
  });
}

const choferDe = (payload: Awaited<ReturnType<typeof loadDispatch>>) =>
  payload.items[0].staff.find((s) => s._id === "chofer-1");

beforeEach(() => {
  tenantQuery.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("la licencia vencida se enseña", () => {
  it("con pocas acreditaciones, el chofer sale marcado", async () => {
    conAcreditaciones(acreditaciones(3, true));

    const payload = await loadDispatch(ctx, DIA);

    expect(choferDe(payload)?.certification_blocked).toBe(true);
    expect(choferDe(payload)?.certification_note).toMatch(/Licencia de conducir/);
  });

  it("y con la acreditación en regla, no", async () => {
    conAcreditaciones(acreditaciones(3, false));
    const payload = await loadDispatch(ctx, DIA);
    expect(choferDe(payload)?.certification_blocked).toBe(false);
  });
});

describe("una empresa con más de dos mil acreditaciones", () => {
  it("SIGUE marcando al chofer: es lo que el tope dejaba pasar", async () => {
    /**
     * 2 400 acreditaciones de relleno y la licencia vencida en la 2 401. Con
     * `_limit: 2000` esa fila no se leía, el mapa del chofer salía vacío,
     * `assignmentBlock` no encontraba nada y el despacho lo daba por bueno.
     *
     * Nada en la pantalla decía que faltaba información. Ésa es la prueba de la
     * ola: la guarda no fallaba, aprobaba.
     */
    conAcreditaciones(acreditaciones(2400, true));

    const payload = await loadDispatch(ctx, DIA);

    expect(choferDe(payload)?.certification_blocked).toBe(true);
    expect(choferDe(payload)?.certification_note).toMatch(/Licencia de conducir/);
  });

  it("y las lee por ventanas que AVANZAN", async () => {
    conAcreditaciones(acreditaciones(2400, true));
    await loadDispatch(ctx, DIA);

    const saltos = tenantQuery.mock.calls
      .filter((c) => c[1] === "certification")
      .map((c) => Number((c[2] as Record<string, number>)?._offset ?? 0));

    // Un bucle que no avanzara pediría siempre el mismo salto y daría vueltas
    // para siempre sobre las mismas filas.
    expect(saltos.length).toBeGreaterThan(1);
    expect(new Set(saltos).size).toBe(saltos.length);
    expect(saltos).toEqual([...saltos].sort((a, b) => a - b));
  });

  it("si de verdad no se pueden leer todas, el despacho NO carga a medias", async () => {
    /**
     * Un despacho que no carga se arregla recargando; un despacho que da por
     * bueno a quien no puede conducir se arregla en el muelle, o no se arregla.
     */
    conAcreditaciones(acreditaciones(10_600, true));
    await expect(loadDispatch(ctx, DIA)).rejects.toThrow(/no se pudo leer/i);
  });
});
