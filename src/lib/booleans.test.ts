import { describe, it, expect } from "vitest";
import { getResource, sanitizePayload } from "@/lib/resources";
import { labelOf } from "@/lib/labels";
import { YES_NO } from "@/lib/labels-modules";

/**
 * Los campos de sí/no contra las columnas booleanas de la base.
 *
 * Las migraciones declaran 28 columnas `boolean`, pero el formulario genérico
 * las ofrece como un `select` de "yes"/"no". Postgres aceptaba la cadena al
 * escribir, así que el guardado parecía funcionar; lo que fallaba era la vuelta:
 *
 *  - `labelOf` recibía `true` y llamaba a `.replace` sobre un booleano, que
 *    tumbaba la pantalla; con `false` pintaba un guion en vez de "No".
 *  - Al editar, el `select` recibía "true" y no casaba con ninguna opción, así
 *    que salía en blanco y viajaba como null contra una columna `not null`:
 *    la actualización entera fallaba, no solo ese campo.
 */

describe("booleanos — etiqueta", () => {
  it("true y false se leen como sí y no", () => {
    expect(labelOf(YES_NO, true).label).toBe("Sí");
    expect(labelOf(YES_NO, false).label).toBe("No");
  });

  it("un booleano nunca hace reventar la insignia", () => {
    // `true.replace` no existe: esto era un error en tiempo de render.
    expect(() => labelOf({}, true)).not.toThrow();
    expect(() => labelOf({}, false)).not.toThrow();
  });

  it("las cadenas siguen resolviéndose como antes", () => {
    expect(labelOf(YES_NO, "yes").label).toBe("Sí");
    expect(labelOf({}, "algo_sin_diccionario").label).toBe("algo sin diccionario");
    expect(labelOf({}, null).label).toBe("—");
    expect(labelOf({}, "").label).toBe("—");
  });
});

describe("booleanos — escritura", () => {
  const warehouse = getResource("warehouse")!;

  it("el sí/no del formulario llega a la base como booleano", () => {
    expect(sanitizePayload(warehouse, { name: "A", allows_negative: "yes" }).allows_negative).toBe(true);
    expect(sanitizePayload(warehouse, { name: "A", allows_negative: "no" }).allows_negative).toBe(false);
  });

  it("acepta el booleano ya hecho y las variantes de texto", () => {
    for (const [input, expected] of [[true, true], [false, false], ["true", true], ["false", false], ["1", true], ["0", false]] as const) {
      expect(sanitizePayload(warehouse, { allows_negative: input }).allows_negative, String(input)).toBe(expected);
    }
  });

  it("un valor que no es sí ni no se rechaza en vez de guardarse como falso", () => {
    // Guardar en silencio un `false` por un valor inesperado apaga un control
    // sin que nadie se entere: es justo el fallo que se está cerrando.
    expect(() => sanitizePayload(warehouse, { allows_negative: "quizás" })).toThrow(/sí o no/);
  });

  it("vaciar el campo lo deja nulo, no falso", () => {
    expect(sanitizePayload(warehouse, { allows_negative: "" }).allows_negative).toBeUndefined();
  });

  it("los campos no booleanos del mismo recurso no se tocan", () => {
    const out = sanitizePayload(warehouse, { name: "Central", allows_negative: "yes" });
    expect(out.name).toBe("Central");
  });

  it("cada recurso con columnas booleanas las declara", () => {
    // El detalle lo verifica `schema-contract.test.ts` contra las migraciones;
    // aquí basta con que la lista no se quede vacía por un refactor.
    for (const resource of ["warehouse", "inventory_item", "incident", "asset", "notification"]) {
      expect(getResource(resource)?.booleans?.length, resource).toBeGreaterThan(0);
    }
  });
});
