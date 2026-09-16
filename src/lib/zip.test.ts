import { describe, it, expect } from "vitest";
import { crc32, createZip } from "@/lib/zip";

/**
 * Un ZIP escrito a mano se prueba de una sola manera que valga: VOLVIÉNDOLO A
 * LEER. Comprobar que los bytes son los que escribimos no prueba nada —el error
 * estaría en los dos sitios a la vez—, así que este archivo trae un lector
 * mínimo, escrito desde la especificación y no desde `zip.ts`, que hace lo que
 * hace un extractor: busca el fin del directorio central, recorre las entradas,
 * salta a la cabecera local de cada una y verifica el CRC.
 *
 * Si el archivo que generamos no se pudiera abrir, este lector fallaría igual
 * que falla el Explorador de Windows, y antes.
 */

const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number) =>
  (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

interface LeidaEntrada {
  name: string;
  content: string;
  flags: number;
  method: number;
  crcOk: boolean;
  dosTime: number;
  dosDate: number;
}

/** Un extractor mínimo: el mismo camino que recorre cualquier herramienta real. */
function readZip(bytes: Uint8Array): LeidaEntrada[] {
  const decoder = new TextDecoder();

  // El fin del directorio central se busca desde el final, como manda la
  // especificación (puede llevar comentario detrás).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("no es un ZIP: falta el fin del directorio central");

  const total = u16(bytes, eocd + 10);
  let cursor = u32(bytes, eocd + 16);

  const entries: LeidaEntrada[] = [];
  for (let n = 0; n < total; n++) {
    if (u32(bytes, cursor) !== 0x02014b50) throw new Error("entrada del directorio central corrupta");
    const nameLength = u16(bytes, cursor + 28);
    const extraLength = u16(bytes, cursor + 30);
    const commentLength = u16(bytes, cursor + 32);
    const localAt = u32(bytes, cursor + 42);
    const name = decoder.decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));

    // Y ahora el salto a la cabecera local, que es lo que de verdad ejercita el
    // desplazamiento guardado: si estuviera mal, aquí no habría firma.
    if (u32(bytes, localAt) !== 0x04034b50) throw new Error(`${name}: la cabecera local no está donde dice`);
    const flags = u16(bytes, localAt + 6);
    const method = u16(bytes, localAt + 8);
    const dosTime = u16(bytes, localAt + 10);
    const dosDate = u16(bytes, localAt + 12);
    const crc = u32(bytes, localAt + 14);
    const size = u32(bytes, localAt + 18);
    const localNameLength = u16(bytes, localAt + 26);
    const dataAt = localAt + 30 + localNameLength + u16(bytes, localAt + 28);
    const data = bytes.slice(dataAt, dataAt + size);

    entries.push({
      name,
      content: decoder.decode(data),
      flags,
      method,
      crcOk: crc32(data) === crc,
      dosTime,
      dosDate,
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

describe("el CRC-32", () => {
  const bytes = (text: string) => new TextEncoder().encode(text);

  it("da los valores conocidos de la especificación", () => {
    // Vectores públicos: si la tabla estuviera mal, estos tres no cuadran.
    expect(crc32(bytes(""))).toBe(0);
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
    expect(crc32(bytes("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
    expect(crc32(bytes("a"))).toBe(0xe8b7be43);
  });

  it("es sensible al orden, no una suma", () => {
    // Un CRC que no distinguiera «ab» de «ba» dejaría pasar archivos truncados.
    expect(crc32(bytes("ab"))).not.toBe(crc32(bytes("ba")));
  });

  it("no devuelve negativos", () => {
    // En JavaScript el desplazamiento a la derecha con signo produce negativos, y
    // un CRC negativo escrito en el archivo lo deja ilegible.
    for (const texto of ["", "a", "Liquidación", "x".repeat(1000)]) {
      expect(crc32(bytes(texto))).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("el archivo ZIP", () => {
  it("se vuelve a leer entero, con el contenido intacto", () => {
    const zip = createZip([
      { name: "clientes.csv", content: "Nombre,Correo\r\nJuan,j@x.com" },
      { name: "reservas.csv", content: "Codigo\r\nRES-1" },
    ]);

    const leidas = readZip(zip);
    expect(leidas.map((e) => e.name)).toEqual(["clientes.csv", "reservas.csv"]);
    expect(leidas[0].content).toBe("Nombre,Correo\r\nJuan,j@x.com");
    expect(leidas[1].content).toBe("Codigo\r\nRES-1");
    // El CRC de cada entrada cuadra con sus datos: es lo que el extractor
    // comprueba antes de decir «archivo corrupto».
    expect(leidas.every((e) => e.crcOk)).toBe(true);
  });

  it("marca los nombres como UTF-8, que es lo que salva los acentos", () => {
    // Sin la bandera 0x0800, «Liquidación.csv» aparece como «LiquidaciÃ³n.csv» en
    // Windows: el archivo está bien y quien lo abre concluye que está roto.
    const [entrada] = readZip(createZip([{ name: "Liquidación.csv", content: "a" }]));
    expect(entrada.name).toBe("Liquidación.csv");
    expect(entrada.flags & 0x0800).toBe(0x0800);
  });

  it("guarda sin comprimir, y el tamaño declarado es el real", () => {
    const contenido = "x".repeat(5000);
    const [entrada] = readZip(createZip([{ name: "a.csv", content: contenido }]));
    expect(entrada.method).toBe(0);
    expect(entrada.content).toBe(contenido);
  });

  it("conserva las carpetas y endereza las barras invertidas", () => {
    // Una barra invertida en el nombre produce un archivo que en Linux se extrae
    // como un único fichero llamado «datos\a.csv».
    const leidas = readZip(createZip([
      { name: "datos/clientes.csv", content: "a" },
      { name: "datos\\reservas.csv", content: "b" },
    ]));
    expect(leidas.map((e) => e.name)).toEqual(["datos/clientes.csv", "datos/reservas.csv"]);
  });

  it("escribe la fecha de MS-DOS, no ceros", () => {
    // Con ceros, algunos extractores muestran una fecha imposible y otros se
    // quejan del archivo entero.
    const [entrada] = readZip(createZip([{ name: "a.csv", content: "x" }], new Date(2026, 8, 16, 14, 30, 20)));
    expect(entrada.dosDate >> 9).toBe(2026 - 1980);
    expect((entrada.dosDate >> 5) & 0x0f).toBe(9);
    expect(entrada.dosDate & 0x1f).toBe(16);
    expect(entrada.dosTime >> 11).toBe(14);
    expect((entrada.dosTime >> 5) & 0x3f).toBe(30);
  });

  it("una fecha anterior a 1980 no produce un archivo ilegible", () => {
    // El formato no puede representarla: se recorta al mínimo en vez de escribir
    // un año negativo, que desbordaría el campo y corrompería la cabecera.
    const [entrada] = readZip(createZip([{ name: "a.csv", content: "x" }], new Date(1971, 0, 5, 0, 0, 0)));
    expect(entrada.dosDate >> 9).toBe(0);
  });

  it("aguanta un archivo grande sin desbordar la pila", () => {
    // El contenido se copia byte a byte a un arreglo; con `push(...bytes)` y unos
    // megas, esto revienta con «Maximum call stack size exceeded» — y revienta al
    // exportar la empresa de un cliente real, no aquí.
    const grande = "fila,con,datos\r\n".repeat(60_000);
    const leidas = readZip(createZip([{ name: "grande.csv", content: grande }]));
    expect(leidas[0].content).toBe(grande);
    expect(leidas[0].crcOk).toBe(true);
  });

  it("sin entradas sigue siendo un ZIP válido y vacío", () => {
    expect(readZip(createZip([]))).toEqual([]);
  });

  it("los acentos del contenido sobreviven al viaje", () => {
    const [entrada] = readZip(createZip([{ name: "a.csv", content: "Pérez,Bávaro,ñandú" }]));
    expect(entrada.content).toBe("Pérez,Bávaro,ñandú");
  });
});
