/**
 * La aritmética de maquetar un documento, sin depender de pdf-lib.
 *
 * Está separada del dibujado para poder probarla: el ajuste de línea y el saneado
 * de caracteres son justo lo que rompe un documento en producción —un nombre con
 * una tilde rara, una nota de cliente con un emoji— y no se puede comprobar
 * mirando un PDF a ojo.
 */

/**
 * Texto que las fuentes estándar de un PDF pueden escribir.
 *
 * Helvetica y sus hermanas codifican en WinAnsi (Latin-1 ampliado). Un carácter
 * fuera de ese juego hace que pdf-lib LANCE, así que un cliente llamado 中村 o
 * una nota con un emoji no romperían el acento: romperían la emisión del voucher
 * entera, en la puerta y con el cliente delante.
 *
 * Se transliteran los casos frecuentes (comillas tipográficas, guiones largos,
 * viñetas) porque cambiarlos por una interrogación empobrecería el documento, y
 * lo verdaderamente impronunciable cae a '?', que es visible y no revienta nada.
 */
const TRANSLITERATE: Record<string, string> = {
  "‘": "'", "’": "'", "‚": ",", "“": '"', "”": '"',
  "–": "-", "—": "-", "…": "...", "•": "-", " ": " ",
  " ": " ", " ": " ", "\t": "    ",
};

/** ¿Lo puede escribir una fuente estándar? WinAnsi cubre Latin-1 más un tramo. */
function encodable(code: number): boolean {
  if (code === 10 || code === 13) return true;           // saltos de línea
  if (code >= 0x20 && code <= 0x7e) return true;          // ASCII imprimible
  if (code >= 0xa0 && code <= 0xff) return true;          // Latin-1 (á, ñ, ¿, ·, °)
  // Tramo propio de WinAnsi (€, comillas, guiones) — ya transliterado arriba.
  return false;
}

export function sanitizeForPdf(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  let out = "";
  for (const char of text) {
    const replacement = TRANSLITERATE[char];
    if (replacement !== undefined) { out += replacement; continue; }
    const code = char.codePointAt(0) ?? 0;
    out += encodable(code) ? char : "?";
  }
  return out;
}

/** Mide el ancho de un texto; lo inyecta quien dibuja, con su fuente real. */
export type Measure = (text: string) => number;

/**
 * Parte un texto en líneas que caben en `maxWidth`.
 *
 * Una palabra más larga que la caja —un correo largo, un código— se trocea en
 * vez de desbordar: un voucher con el código saliéndose del margen no se puede
 * imprimir. Los saltos de línea que ya trae el texto se respetan, porque en una
 * plantilla escrita a mano son intencionados.
 */
export function wrapText(text: string, maxWidth: number, measure: Measure): string[] {
  const clean = sanitizeForPdf(text);
  // Solo espacios no es un párrafo en blanco: es nada. Los blancos INTERIORES sí
  // se conservan, porque en una plantilla separan párrafos a propósito.
  if (!clean.trim()) return [];
  const lines: string[] = [];

  for (const paragraph of clean.split(/\r?\n/)) {
    if (!paragraph.trim()) { lines.push(""); continue; }
    let current = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      if (measure(candidate) <= maxWidth) { current = candidate; continue; }
      if (current) { lines.push(current); current = ""; }
      // La palabra sola tampoco cabe: se parte por donde deja de caber.
      let rest = word;
      while (measure(rest) > maxWidth && rest.length > 1) {
        let cut = rest.length;
        while (cut > 1 && measure(rest.slice(0, cut)) > maxWidth) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      current = rest;
    }
    if (current) lines.push(current);
  }
  return lines;
}

/**
 * Recorta un texto a una sola línea, con puntos suspensivos.
 *
 * Para las celdas de una tabla, donde una segunda línea descuadraría la fila.
 */
export function truncate(text: string, maxWidth: number, measure: Measure): string {
  const clean = sanitizeForPdf(text);
  if (measure(clean) <= maxWidth) return clean;
  let cut = clean.length;
  while (cut > 1 && measure(`${clean.slice(0, cut)}...`) > maxWidth) cut--;
  return `${clean.slice(0, cut)}...`;
}

export interface ColumnSpec {
  /** Proporción del ancho disponible. */
  width: number;
  align?: "left" | "right";
}

/**
 * Convierte proporciones en posiciones X absolutas.
 *
 * Las columnas se declaran por peso para que el documento siga cuadrando si
 * cambia el margen o el tamaño de página.
 */
export function columnPositions(columns: ColumnSpec[], left: number, totalWidth: number): { x: number; width: number; align: "left" | "right" }[] {
  const sum = columns.reduce((s, c) => s + Math.max(c.width, 0), 0) || 1;
  let cursor = left;
  return columns.map((c) => {
    const width = (Math.max(c.width, 0) / sum) * totalWidth;
    const position = { x: cursor, width, align: c.align ?? "left" as const };
    cursor += width;
    return position;
  });
}

/** X donde empieza el texto de una celda, según su alineación. */
export function cellX(
  column: { x: number; width: number; align: "left" | "right" },
  textWidth: number,
  padding = 4
): number {
  return column.align === "right"
    ? column.x + column.width - textWidth - padding
    : column.x + padding;
}
