import { describe, it, expect } from "vitest";
import {
  limitesConsulta, normalizarPeriodo, etiquetaPeriodo, nombreArchivo, diaLocal, diaSiguiente, atajos,
} from "@/lib/report";

/**
 * EL PERÍODO DE UN REPORTE.
 *
 * Un reporte que pierde un día no se nota: sale, se imprime, se archiva, y la
 * diferencia aparece cuando alguien cuadra. Estas pruebas fijan las dos reglas
 * que lo impiden.
 */

const RD = "America/Santo_Domingo"; // UTC−4

describe("hasta dónde llega «hasta»", () => {
  it("el último día entra ENTERO", () => {
    /**
     * ──────────────────────────────────────────────────────────────────────
     * EL DEFECTO QUE ESTO CIERRA
     *
     * El filtro de los listados comparaba `<= '2026-09-30'`, que es la
     * MEDIANOCHE del 30. O sea que «hasta el 30» dejaba fuera el 30 entero:
     * cada reporte perdía su último día, en silencio.
     */
    const l = limitesConsulta({ desde: "2026-09-01", hasta: "2026-09-30" }, RD);

    const aLasDosDeLaTarde = new Date("2026-09-30T18:00:00.000Z"); // 14:00 en RD
    expect(new Date(l.gte) <= aLasDosDeLaTarde, "empieza antes").toBe(true);
    expect(aLasDosDeLaTarde < new Date(l.lt), "y NO se cae del rango").toBe(true);
  });

  it("y el día siguiente NO entra", () => {
    /**
     * El rango es semiabierto justamente para esto: si el corte fuera cerrado,
     * un evento de la medianoche exacta caería en DOS reportes consecutivos y
     * se contaría dos veces. Se comprueba contra el reporte del mes siguiente,
     * que es donde ese evento tiene que aparecer una sola vez.
     */
    const septiembre = limitesConsulta({ desde: "2026-09-01", hasta: "2026-09-30" }, RD);
    const octubre = limitesConsulta({ desde: "2026-10-01", hasta: "2026-10-31" }, RD);

    const justoEnElCorte = new Date(septiembre.lt);
    expect(justoEnElCorte < new Date(septiembre.lt), "no es de septiembre").toBe(false);
    expect(new Date(octubre.gte) <= justoEnElCorte, "es de octubre").toBe(true);
    expect(septiembre.lt, "y los dos reportes se tocan sin solaparse").toBe(octubre.gte);

    const unMilisegundoAntes = new Date(new Date(septiembre.lt).getTime() - 1);
    expect(unMilisegundoAntes < new Date(septiembre.lt), "lo de antes sí es de septiembre").toBe(true);
  });

  it("el corte es la medianoche de la EMPRESA, no la de UTC", () => {
    /**
     * Las 21:00 del 30 en Santo Domingo son la 01:00 del 1 en UTC. Con los
     * cortes en UTC esa venta se va al mes siguiente — el mismo error que hubo
     * que corregir en las declaraciones fiscales.
     */
    const l = limitesConsulta({ desde: "2026-09-01", hasta: "2026-09-30" }, RD);
    const ventaDeLaNoche = new Date("2026-10-01T01:00:00.000Z"); // 30-sep 21:00 local
    expect(ventaDeLaNoche < new Date(l.lt), "es del 30, y cuenta en el 30").toBe(true);

    // El primer instante del rango también es local: 1-sep 00:00 en RD = 04:00 UTC.
    expect(l.gte).toBe("2026-09-01T04:00:00.000Z");
  });

  it("un solo día es un día completo", () => {
    const l = limitesConsulta({ desde: "2026-09-22", hasta: "2026-09-22" }, RD);
    const casiMedianoche = new Date("2026-09-23T03:59:59.000Z"); // 23:59:59 local
    expect(new Date(l.gte) <= casiMedianoche && casiMedianoche < new Date(l.lt)).toBe(true);
  });

  it("cruza el fin de mes y el fin de año sin perder el último día", () => {
    const l = limitesConsulta({ desde: "2026-12-01", hasta: "2026-12-31" }, RD);
    const nocheVieja = new Date("2027-01-01T02:00:00.000Z"); // 31-dic 22:00 local
    expect(nocheVieja < new Date(l.lt)).toBe(true);
  });
});

describe("qué período se usa cuando no lo dicen todo", () => {
  const hoy = new Date("2026-09-22T15:00:00.000Z"); // 11:00 en RD

  it("sin nada, el mes en curso hasta hoy", () => {
    expect(normalizarPeriodo(null, null, hoy, RD)).toEqual({ desde: "2026-09-01", hasta: "2026-09-22" });
  });

  it("con solo el desde, hasta hoy", () => {
    expect(normalizarPeriodo("2026-09-10", null, hoy, RD)).toEqual({ desde: "2026-09-10", hasta: "2026-09-22" });
  });

  it("al revés se endereza en vez de salir vacío", () => {
    /**
     * Quien escribe «del 30 al 1» quiere del 1 al 30. Devolverle un reporte en
     * blanco le hace creer que no pasó nada ese mes.
     */
    expect(normalizarPeriodo("2026-09-30", "2026-09-01", hoy, RD))
      .toEqual({ desde: "2026-09-01", hasta: "2026-09-30" });
  });

  it("una fecha inventada no rompe el reporte", () => {
    // Llega de la URL, así que puede ser cualquier cosa.
    expect(normalizarPeriodo("ayer", "32/13/2026", hoy, RD))
      .toEqual({ desde: "2026-09-01", hasta: "2026-09-22" });
  });

  it("un desde en el futuro no produce un rango invertido", () => {
    expect(normalizarPeriodo("2026-12-01", null, hoy, RD))
      .toEqual({ desde: "2026-12-01", hasta: "2026-12-01" });
  });
});

describe("cómo se lee el período en el papel", () => {
  it("un día se dice como un día", () => {
    expect(etiquetaPeriodo({ desde: "2026-09-22", hasta: "2026-09-22" })).toBe("22 de septiembre de 2026");
  });
  it("dentro del mismo mes no se repite el mes", () => {
    expect(etiquetaPeriodo({ desde: "2026-09-01", hasta: "2026-09-30" })).toBe("1 al 30 de septiembre de 2026");
  });
  it("entre meses del mismo año no se repite el año", () => {
    expect(etiquetaPeriodo({ desde: "2026-08-15", hasta: "2026-09-14" })).toBe("15 de agosto al 14 de septiembre de 2026");
  });
  it("entre años se dicen los dos", () => {
    expect(etiquetaPeriodo({ desde: "2025-12-20", hasta: "2026-01-05" }))
      .toBe("20 de diciembre de 2025 al 5 de enero de 2026");
  });
});

describe("el archivo que se descarga", () => {
  it("lleva el período en el nombre", () => {
    // Tres exportaciones del mismo reporte en la carpeta de descargas, con el
    // mismo nombre, son tres archivos que nadie sabe cuál es cuál.
    expect(nombreArchivo("bitacora", { desde: "2026-09-01", hasta: "2026-09-30" }))
      .toBe("bitacora-2026-09-01_a_2026-09-30.csv");
    expect(nombreArchivo("bitacora", { desde: "2026-09-22", hasta: "2026-09-22" }))
      .toBe("bitacora-2026-09-22.csv");
  });
});

describe("los atajos del selector", () => {
  const hoy = new Date("2026-09-01T15:00:00.000Z"); // 11:00 del 1-sep en RD

  it("«ayer» cruza bien el cambio de mes", () => {
    // El 1 de septiembre, ayer es el 31 de agosto. Restar un día en UTC desde
    // un instante de las 11:00 local daría el mismo día.
    const a = atajos(hoy, RD).find((x) => x.clave === "ayer")!;
    expect(a.periodo).toEqual({ desde: "2026-08-31", hasta: "2026-08-31" });
  });

  it("«mes anterior» es el mes entero, no treinta días atrás", () => {
    const m = atajos(hoy, RD).find((x) => x.clave === "mes-anterior")!;
    expect(m.periodo).toEqual({ desde: "2026-08-01", hasta: "2026-08-31" });
  });

  it("«este mes» va del día 1 a hoy", () => {
    const m = atajos(hoy, RD).find((x) => x.clave === "mes")!;
    expect(m.periodo).toEqual({ desde: "2026-09-01", hasta: "2026-09-01" });
  });
});

describe("piezas sueltas", () => {
  it("el día local no es el día UTC cuando la diferencia importa", () => {
    // 01:00 UTC del 1 es todavía el 30 en Santo Domingo.
    expect(diaLocal(new Date("2026-10-01T01:00:00.000Z"), RD)).toBe("2026-09-30");
  });
  it("el día siguiente cruza meses y años", () => {
    expect(diaSiguiente("2026-09-30")).toBe("2026-10-01");
    expect(diaSiguiente("2026-12-31")).toBe("2027-01-01");
    expect(diaSiguiente("2028-02-28")).toBe("2028-02-29");
  });
});
