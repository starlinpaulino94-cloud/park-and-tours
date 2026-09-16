/**
 * Un ZIP sin comprimir, escrito a mano.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ A MANO Y NO CON UNA DEPENDENCIA
 *
 * Hace falta para una sola cosa —«llévate tus datos»: un archivo con todas las
 * tablas de la empresa— y el formato que se necesita es el más simple que
 * define la especificación: entradas ALMACENADAS, sin compresión. Eso son tres
 * estructuras (cabecera local, directorio central y su fin) y un CRC-32.
 *
 * Una biblioteca de ZIP trae compresión, cifrado, ZIP64, flujos y años de
 * casos que este uso no tiene, y habría que probar igual su comportamiento con
 * nombres acentuados y archivos grandes. Escrito aquí, cabe en una página, se
 * prueba entero y no añade superficie que mantener.
 *
 * Sin compresión el archivo pesa lo que pesan los CSV juntos. Es aceptable:
 * el valor de este archivo es que ABRA en cualquier equipo —doble clic en
 * Windows, macOS o Linux— sin instalar nada, no que pese poco.
 */

/* -------------------------------------------------------------- el CRC-32 */

/**
 * La tabla del CRC-32, calculada una vez.
 *
 * El ZIP exige el CRC de cada entrada, y un CRC mal calculado produce un
 * archivo que se abre y al extraer dice «corrupto» — el peor fallo posible aquí,
 * porque el cliente cree que tiene sus datos a salvo y no los tiene.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* ---------------------------------------------------------- las entradas */

export interface ZipEntry {
  /** Ruta dentro del archivo. Con `/` para carpetas, nunca con `\`. */
  name: string;
  content: string;
}

/**
 * Fecha y hora en el formato de MS-DOS que usa el ZIP.
 *
 * Es de 1980 y solo tiene resolución de dos segundos; da igual, pero tiene que
 * estar: con ceros, algunos extractores muestran «01/01/1980» y otros se
 * quejan del archivo.
 */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const u16 = (value: number): number[] => [value & 0xff, (value >> 8) & 0xff];
const u32 = (value: number): number[] => [
  value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff,
];

/**
 * Pega los trozos en un solo bloque.
 *
 * El archivo se arma como una lista de trozos y se copia UNA vez al final, en vez
 * de ir acumulando en un arreglo de números. No es afán de eficiencia: pasar el
 * contenido con `push(...bytes)` lo pasa como argumentos, y un CSV de unos pocos
 * megas —la exportación de una empresa con historia— supera el límite de
 * argumentos del motor y revienta con «Maximum call stack size exceeded». Hay una
 * prueba con sesenta mil filas que lo fija.
 */
function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * Arma el ZIP completo.
 *
 * El nombre de cada entrada se escribe en UTF-8 con la BANDERA 0x0800 puesta,
 * que es lo que le dice al extractor que no interprete los bytes como la
 * codificación antigua de DOS. Sin esa bandera, «Liquidación.csv» aparece como
 * «LiquidaciÃ³n.csv» en Windows: el archivo está bien y parece roto.
 */
export function createZip(entries: ZipEntry[], now: Date = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(now);

  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  let centralSize = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name.replace(/\\/g, "/"));
    const contentBytes = encoder.encode(entry.content);
    const crc = crc32(contentBytes);
    const size = contentBytes.length;

    // Cabecera local + nombre + datos.
    const header = new Uint8Array([
      ...u32(0x04034b50),   // firma
      ...u16(20),           // versión necesaria (2.0)
      ...u16(0x0800),       // bandera: el nombre va en UTF-8
      ...u16(0),            // método: almacenado, sin comprimir
      ...u16(time), ...u16(date),
      ...u32(crc),
      ...u32(size),         // comprimido = sin comprimir: no hay compresión
      ...u32(size),
      ...u16(nameBytes.length),
      ...u16(0),            // sin campos extra
    ]);
    local.push(header, nameBytes, contentBytes);

    const dir = new Uint8Array([
      ...u32(0x02014b50),   // firma del directorio central
      ...u16(20),           // versión que lo creó
      ...u16(20),           // versión necesaria
      ...u16(0x0800),
      ...u16(0),
      ...u16(time), ...u16(date),
      ...u32(crc),
      ...u32(size), ...u32(size),
      ...u16(nameBytes.length),
      ...u16(0), ...u16(0), // extra y comentario
      ...u16(0),            // número de disco
      ...u16(0),            // atributos internos
      ...u32(0),            // atributos externos
      ...u32(offset),       // dónde empieza su cabecera local
    ]);
    central.push(dir, nameBytes);

    offset += header.length + nameBytes.length + contentBytes.length;
    centralSize += dir.length + nameBytes.length;
  }

  const end = new Uint8Array([
    ...u32(0x06054b50),           // fin del directorio central
    ...u16(0), ...u16(0),         // disco actual y disco del directorio
    ...u16(entries.length), ...u16(entries.length),
    ...u32(centralSize),
    ...u32(offset),               // dónde empieza el directorio central
    ...u16(0),                    // sin comentario
  ]);

  return concat([...local, ...central, end]);
}
