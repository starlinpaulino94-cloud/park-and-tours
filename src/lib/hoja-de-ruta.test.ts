import { describe, it, expect } from "vitest";
import {
  hojaAbierta, puedeMarcar, esperoLoSuficiente, horaDelDia, ordenarParadas,
  esMarcaDelChofer, VENTANA_DE_LA_HOJA_HORAS, MINUTOS_DE_ESPERA,
} from "@/lib/hoja-de-ruta";

const SERVICIO = "2026-07-16T07:00:00.000Z";

describe("cuándo se abre la hoja de ruta", () => {
  it("alrededor del servicio, por delante y por detrás", () => {
    expect(hojaAbierta(SERVICIO, new Date("2026-07-15T20:00:00.000Z"))).toBe(true);
    expect(hojaAbierta(SERVICIO, new Date("2026-07-16T18:00:00.000Z"))).toBe(true);
  });

  it("y NO un mes después: no es un histórico de clientes", () => {
    /**
     * Es lo que separa «la hoja del día» de «la lista de clientes de la
     * operadora con teléfono». Sin ventana, un transportista podría sacar la de
     * hace tres meses.
     */
    expect(hojaAbierta(SERVICIO, new Date("2026-08-16T07:00:00.000Z"))).toBe(false);
    expect(hojaAbierta(SERVICIO, new Date("2026-07-14T07:00:00.000Z"))).toBe(false);
  });

  it("el borde exacto de la ventana todavía abre", () => {
    const borde = new Date(new Date(SERVICIO).getTime() + VENTANA_DE_LA_HOJA_HORAS * 3_600_000);
    expect(hojaAbierta(SERVICIO, borde)).toBe(true);
    expect(hojaAbierta(SERVICIO, new Date(borde.getTime() + 1000))).toBe(false);
  });

  it("SIN FECHA NO SE ABRE, que es lo contrario de lo que pide el cuerpo", () => {
    /**
     * «Será un dato que falta, déjalo pasar» convertiría «sin fecha» en
     * «siempre», y la hoja pasaría a ser un listado sin caducidad.
     */
    expect(hojaAbierta(null, new Date(SERVICIO))).toBe(false);
    expect(hojaAbierta("", new Date(SERVICIO))).toBe(false);
    expect(hojaAbierta("no es una fecha", new Date(SERVICIO))).toBe(false);
  });
});

describe("qué puede marcar el chofer", () => {
  it("recogido y no-show, y nada más", () => {
    expect(esMarcaDelChofer("picked_up")).toBe(true);
    expect(esMarcaDelChofer("no_show")).toBe(true);
    // Cancelar es una decisión comercial con reembolso detrás, y no es suya.
    expect(esMarcaDelChofer("cancelled")).toBe(false);
    expect(esMarcaDelChofer("pending")).toBe(false);
  });

  it("una parada CANCELADA no se marca", () => {
    // El cliente avisó; ponerle un no-show le cuelga un incumplimiento a quien
    // hizo las cosas bien.
    expect(puedeMarcar("cancelled")).toBe(false);
    expect(puedeMarcar("pending")).toBe(true);
    // Y una ya marcada se puede corregir: el chofer se equivoca de fila y lo ve
    // al momento. La corrección queda en la bitácora.
    expect(puedeMarcar("no_show")).toBe(true);
  });
});

describe("si se esperó antes de declarar el no-show", () => {
  it("con la hora prevista se puede decir", () => {
    const prevista = "07:00";
    expect(esperoLoSuficiente(prevista, new Date("2026-07-16T07:06:00.000Z"), SERVICIO)).toBe(true);
    expect(esperoLoSuficiente(prevista, new Date("2026-07-16T07:01:00.000Z"), SERVICIO)).toBe(false);
  });

  it("justo en el minuto del tope ya cuenta como esperado", () => {
    const enPunto = new Date(new Date("2026-07-16T07:00:00.000Z").getTime() + MINUTOS_DE_ESPERA * 60_000);
    expect(esperoLoSuficiente("07:00", enPunto, SERVICIO)).toBe(true);
  });

  it("SIN HORA PREVISTA NO SE INVENTA una acusación", () => {
    /**
     * Devolver `false` diría que el chofer no esperó, que es justo lo que se va
     * a discutir cuando el turista reclame. No saberlo se dice no sabiéndolo.
     */
    expect(esperoLoSuficiente(null, new Date(), SERVICIO)).toBeNull();
    expect(esperoLoSuficiente("07:00", new Date(), null)).toBeNull();
    expect(esperoLoSuficiente("mañana temprano", new Date(), SERVICIO)).toBeNull();
  });

  it("y una hora imposible tampoco se acepta", () => {
    expect(horaDelDia("25:00", SERVICIO)).toBeNull();
    expect(horaDelDia("07:70", SERVICIO)).toBeNull();
    expect(horaDelDia("07:15", SERVICIO)?.toISOString()).toBe("2026-07-16T07:15:00.000Z");
  });
});

describe("el orden del recorrido", () => {
  it("por secuencia, y por hora cuando no la hay", () => {
    const paradas = [
      { sequence: 0, time: "08:00", id: "c" },
      { sequence: 2, time: "07:30", id: "b" },
      { sequence: 1, time: "09:00", id: "a" },
      { sequence: 0, time: "06:00", id: "d" },
    ];
    expect(ordenarParadas(paradas).map((p) => p.id)).toEqual(["a", "b", "d", "c"]);
  });

  it("LAS PARADAS SIN SECUENCIA VAN AL FINAL, no al principio", () => {
    /**
     * Una parada sin ordenar es una que nadie colocó. Ponerla primera mandaría
     * al chofer al sitio equivocado antes de empezar el recorrido.
     */
    const paradas = [{ sequence: 0, time: "05:00", id: "suelta" }, { sequence: 1, time: "09:00", id: "primera" }];
    expect(ordenarParadas(paradas).map((p) => p.id)).toEqual(["primera", "suelta"]);
  });

  it("y no toca la lista que recibe", () => {
    const paradas = [{ sequence: 2, time: null, id: "b" }, { sequence: 1, time: null, id: "a" }];
    ordenarParadas(paradas);
    expect(paradas.map((p) => p.id)).toEqual(["b", "a"]);
  });
});
