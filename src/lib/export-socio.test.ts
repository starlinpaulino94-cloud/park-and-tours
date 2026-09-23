import { describe, it, expect } from "vitest";
import { EXPORT_SOCIO, columnasParaSocio } from "@/lib/export-socio";
import { buildExport } from "@/lib/export";

describe("la exportación del socio va por lista blanca", () => {
  it("un recurso sin lista no devuelve columnas: devuelve null", () => {
    /**
     * `null` no es «ninguna»: es «esto no se ha decidido», y quien llama tiene
     * que negar. Una lista vacía habría producido un archivo con cabeceras y
     * sin datos, que parece un error del sistema en vez de una decisión.
     */
    expect(columnasParaSocio("payment")).toBeNull();
    expect(columnasParaSocio("invoice")).toBeNull();
    expect(columnasParaSocio("product")).toBeNull();
  });

  it("y los que la tienen la tienen entera", () => {
    for (const [recurso, campos] of Object.entries(EXPORT_SOCIO)) {
      expect(campos.length, `${recurso} tiene la lista vacía`).toBeGreaterThan(0);
      expect(new Set(campos).size, `${recurso} repite campos`).toBe(campos.length);
    }
  });

  it("el archivo solo trae lo declarado, aunque la fila traiga más", () => {
    /**
     * ES LA PRUEBA QUE IMPORTA.
     *
     * `exportColumns` arma las cabeceras con las claves que TRAEN las filas. Sin
     * la lista, una columna nueva en la tabla aparece en el archivo del socio
     * sin que nadie lo decida — y se descubre cuando ya está en el Excel de
     * alguien.
     */
    const filas = [{
      booking_number: "B-1", status: "confirmed", total_amount: 100,
      cost_amount: 60, margin_percent: 40, internal_notes: "no pagó aún",
    }];
    const { csv, columns } = buildExport("booking", filas, {
      fields: columnasParaSocio("booking")!,
    });
    expect(columns.map((c) => c.field)).toEqual(["booking_number", "status", "total_amount"]);
    expect(csv).not.toMatch(/cost_amount|margin|internal_notes|60|no pagó/);
  });

  it("el orden es el DECLARADO, no el que traigan los datos", () => {
    /**
     * Sin esto, las columnas salen en el orden en que aparecen las claves, que
     * cambia entre dos exportaciones del mismo listado según qué fila venga
     * primero con qué campos rellenos. Un archivo cuyas columnas bailan no se
     * puede comparar con el del mes pasado.
     */
    const desordenadas = [{ status: "x", booking_number: "B-1" }];
    const { columns } = buildExport("booking", desordenadas, {
      fields: columnasParaSocio("booking")!,
    });
    expect(columns.map((c) => c.field)).toEqual(["booking_number", "status"]);
  });

  it("un campo declarado que no está en los datos no inventa una columna vacía", () => {
    const { columns } = buildExport("booking", [{ booking_number: "B-1" }], {
      fields: columnasParaSocio("booking")!,
    });
    expect(columns.map((c) => c.field)).toEqual(["booking_number"]);
  });

  it("sin lista, el ERP interno sigue exportando todo lo suyo", () => {
    // La regla es para el actor externo. Quien exporta sus propios datos quiere
    // todo lo que tiene, y ésa fue siempre la promesa de esta pantalla.
    const { columns } = buildExport("booking", [{ booking_number: "B-1", cost_amount: 60 }]);
    expect(columns.map((c) => c.field)).toContain("cost_amount");
  });

  it("ninguna lista deja salir coste, margen ni comisión de la casa", () => {
    /**
     * Una revisión de la lista, no del mecanismo: es fácil añadir un campo
     * «que hace falta para el informe» sin mirar de quién es el dato.
     */
    const prohibidos = /cost|margin|commission_pct|monthly_goal|base_cost|internal/;
    for (const [recurso, campos] of Object.entries(EXPORT_SOCIO)) {
      for (const campo of campos) {
        expect(campo, `${recurso}.${campo} suena a dato de la operadora`).not.toMatch(prohibidos);
      }
    }
  });
});
