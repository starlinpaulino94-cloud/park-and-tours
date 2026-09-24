import { describe, it, expect } from "vitest";
import {
  plazoDeRespuesta, haVencido, horasQueQuedan, puedeResponder, alVencer,
  VENTANA_POR_DEFECTO_HORAS,
} from "@/lib/aceptacion-proveedor";

const AHORA = new Date("2026-07-15T12:00:00.000Z");

describe("el plazo para contestar", () => {
  it("por defecto son las horas de la casa", () => {
    const plazo = plazoDeRespuesta({ ahora: AHORA });
    expect(plazo.getTime() - AHORA.getTime()).toBe(VENTANA_POR_DEFECTO_HORAS * 3_600_000);
  });

  it("y el proveedor puede tener el suyo", () => {
    const plazo = plazoDeRespuesta({ ahora: AHORA, ventanaHoras: 4 });
    expect(plazo.toISOString()).toBe("2026-07-15T16:00:00.000Z");
  });

  it("NUNCA PASA DE LA SALIDA", () => {
    /**
     * Un plazo que vence después de que el servicio ocurra no es un plazo: el
     * autobús tenía que estar en el hotel a las siete y a las siete y cinco da
     * igual lo que conteste nadie.
     */
    const plazo = plazoDeRespuesta({
      ahora: AHORA,
      ventanaHoras: 48,
      fechaDelServicio: "2026-07-16T07:00:00.000Z",
    });
    expect(plazo.toISOString()).toBe("2026-07-16T07:00:00.000Z");
  });

  it("y con la salida encima nace ya vencido, que es la verdad", () => {
    // No hay tiempo de contestar. Estirar el plazo por compasión dejaría un
    // servicio «pendiente» que nadie puede confirmar a tiempo.
    const plazo = plazoDeRespuesta({
      ahora: AHORA, ventanaHoras: 24, fechaDelServicio: "2026-07-15T11:00:00.000Z",
    });
    expect(haVencido(plazo, AHORA)).toBe(true);
  });

  it("una ventana en cero o negativa no se respeta", () => {
    /**
     * Cero horas vence en el mismo instante en que se crea, y lo que parecería
     * desde fuera es que ese proveedor no contesta nunca.
     */
    for (const ventana of [0, -5]) {
      const plazo = plazoDeRespuesta({ ahora: AHORA, ventanaHoras: ventana });
      expect(plazo.getTime() - AHORA.getTime()).toBe(VENTANA_POR_DEFECTO_HORAS * 3_600_000);
    }
  });

  it("sin plazo NO ha vencido", () => {
    // Al revés —tratar la ausencia como vencimiento— daría por caducados todos
    // los servicios de una salida sin fecha.
    expect(haVencido(null, AHORA)).toBe(false);
    expect(horasQueQuedan(null, AHORA)).toBeNull();
  });

  it("y el que vence justo ahora ya venció", () => {
    expect(haVencido(AHORA, AHORA)).toBe(true);
  });
});

describe("si admite respuesta", () => {
  it("solo lo pendiente y dentro de plazo", () => {
    expect(puedeResponder(
      { acceptance: "pending", acceptance_deadline: "2026-07-15T18:00:00.000Z" }, AHORA
    )).toEqual({ ok: true });
  });

  it("y los tres noes se distinguen, que son tres llamadas distintas", () => {
    expect(puedeResponder({ acceptance: "not_required" }, AHORA))
      .toEqual({ ok: false, motivo: "sin_peticion" });
    expect(puedeResponder({ acceptance: "accepted" }, AHORA))
      .toEqual({ ok: false, motivo: "ya_respondido" });
    expect(puedeResponder(
      { acceptance: "pending", acceptance_deadline: "2026-07-15T06:00:00.000Z" }, AHORA
    )).toEqual({ ok: false, motivo: "vencido" });
  });

  it("una fila sin la columna se lee como «no hay nada que contestar»", () => {
    // Lo desconocido es lo de hoy: antes de 0087 nadie preguntaba nada.
    expect(puedeResponder({}, AHORA)).toEqual({ ok: false, motivo: "sin_peticion" });
  });
});

describe("qué pasa al vencer el plazo", () => {
  it("por defecto se marca vencido y se avisa, y NO se da por aceptado", () => {
    /**
     * Es la decisión de la ola. La aceptación tácita obliga a un tercero que no
     * hizo nada; reasignar solo movería un autobús de verdad sin que lo
     * decidiera una persona. Lo único que ocurre sin que nadie lo mande es que
     * suene un aviso.
     */
    expect(alVencer(null)).toEqual({ estado: "expired", via: null, avisa: true });
    expect(alVencer("alert")).toEqual({ estado: "expired", via: null, avisa: true });
  });

  it("y quien tenga pactado que el silencio otorga, otorga — dejando rastro", () => {
    const d = alVencer("tacit");
    expect(d.estado).toBe("accepted");
    // «tacito», no «enlace»: la diferencia entre que contestara y que no
    // contestara nadie es toda la prueba que hay el día que se discuta.
    expect(d.via).toBe("tacito");
    expect(d.avisa, "una conformidad que nadie dio es justo la que hay que mirar").toBe(true);
  });

  it("UNA POLÍTICA DESCONOCIDA CAE EN LA QUE NO DECIDE NADA", () => {
    // Nunca en la que da el servicio por aceptado: un valor mal escrito en la
    // ficha no puede acabar en una conformidad inventada.
    for (const raro of ["reassign", "TACIT", "", "sí", undefined]) {
      expect(alVencer(raro as string | undefined).estado).toBe("expired");
    }
  });
});
