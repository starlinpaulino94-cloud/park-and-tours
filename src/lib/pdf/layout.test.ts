import { describe, it, expect } from "vitest";
import {
  sanitizeForPdf, wrapText, truncate, columnPositions, cellX,
} from "@/lib/pdf/layout";

/** Fuente de mentira: cada carácter mide 10. Hace la aritmética comprobable. */
const measure = (text: string) => text.length * 10;

describe("PDF — caracteres que la fuente puede escribir", () => {
  it("deja intactas las tildes y los signos del español", () => {
    // Si estos se perdieran, el documento saldría en un castellano roto.
    expect(sanitizeForPdf("Peña, ¿así? ¡Sí! Año 2026 · 25°")).toBe("Peña, ¿así? ¡Sí! Año 2026 · 25°");
  });

  it("transcribe las comillas y guiones tipográficos en vez de romperlos", () => {
    expect(sanitizeForPdf("“hola” — el ‘tour’…")).toBe('"hola" - el \'tour\'...');
  });

  it("lo impronunciable cae a ? en vez de tumbar la emisión", () => {
    // pdf-lib LANZA con un carácter fuera de WinAnsi: un cliente llamado 中村 o
    // una nota con un emoji no romperían una tilde, romperían el voucher entero
    // en la puerta y con el cliente delante.
    expect(sanitizeForPdf("中村")).toBe("??");
    expect(sanitizeForPdf("Gracias 👋")).toBe("Gracias ?");
  });

  it("los valores vacíos no son la cadena 'null'", () => {
    expect(sanitizeForPdf(null)).toBe("");
    expect(sanitizeForPdf(undefined)).toBe("");
    expect(sanitizeForPdf(0)).toBe("0");
  });

  it("los saltos de línea sobreviven; los tabuladores se vuelven espacios", () => {
    expect(sanitizeForPdf("uno\ndos")).toBe("uno\ndos");
    expect(sanitizeForPdf("uno\tdos")).toBe("uno    dos");
  });
});

describe("PDF — ajuste de línea", () => {
  it("parte por palabras dentro del ancho", () => {
    expect(wrapText("uno dos tres", 70, measure)).toEqual(["uno dos", "tres"]);
  });

  it("respeta los saltos que ya trae el texto", () => {
    // En una plantilla escrita a mano son intencionados.
    expect(wrapText("uno\ndos", 200, measure)).toEqual(["uno", "dos"]);
  });

  it("una palabra más larga que la caja se trocea en vez de desbordar", () => {
    // Un voucher con el código saliéndose del margen no se puede imprimir.
    expect(wrapText("abcdefghij", 40, measure)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("combina palabras normales con una impartible", () => {
    expect(wrapText("ok abcdefgh", 40, measure)).toEqual(["ok", "abcd", "efgh"]);
  });

  it("un texto vacío no produce líneas", () => {
    expect(wrapText("", 100, measure)).toEqual([]);
    expect(wrapText("   ", 100, measure)).toEqual([]);
  });

  it("sanea antes de medir: el ancho es el del texto que se va a dibujar", () => {
    // "…" es un carácter pero se dibuja como "...", que son tres. Medir el
    // original haría que la línea desbordara justo al imprimirla.
    expect(wrapText("ab…", 50, measure)).toEqual(["ab..."]);
    expect(wrapText("ab…", 40, measure)).toEqual(["ab..", "."]);
  });

  it("conserva la línea en blanco que separa dos párrafos", () => {
    expect(wrapText("uno\n\ndos", 200, measure)).toEqual(["uno", "", "dos"]);
  });
});

describe("PDF — recorte de una celda", () => {
  it("deja el texto si cabe", () => {
    expect(truncate("hola", 100, measure)).toBe("hola");
  });

  it("recorta con puntos suspensivos contando su propio ancho", () => {
    // 5 caracteres de hueco: "ab" + "..." mide exactamente 50.
    expect(truncate("abcdefgh", 50, measure)).toBe("ab...");
  });

  it("nunca devuelve una cadena vacía por muy estrecha que sea la celda", () => {
    expect(truncate("abcdef", 5, measure).length).toBeGreaterThan(0);
  });
});

describe("PDF — columnas de una tabla", () => {
  const columns = [{ width: 2 }, { width: 1 }, { width: 1, align: "right" as const }];

  it("reparte el ancho por pesos, no por píxeles", () => {
    // Así el documento sigue cuadrando si cambia el margen o el tamaño de hoja.
    const cols = columnPositions(columns, 40, 400);
    expect(cols.map((c) => c.width)).toEqual([200, 100, 100]);
    expect(cols.map((c) => c.x)).toEqual([40, 240, 340]);
  });

  it("una columna alineada a la derecha empieza donde acaba su texto", () => {
    const cols = columnPositions(columns, 0, 400);
    expect(cellX(cols[2], 30)).toBe(300 + 100 - 30 - 4);
    expect(cellX(cols[0], 30)).toBe(4);
  });

  it("pesos inválidos no dividen entre cero", () => {
    expect(columnPositions([{ width: 0 }], 10, 100)[0]).toMatchObject({ x: 10, width: 0 });
  });
});
