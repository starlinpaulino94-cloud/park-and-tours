import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TenantContext } from "@/lib/tenant";
import type { AppRole } from "@/lib/auth";

/**
 * El volcado de la empresa, con la base de datos simulada.
 *
 * Lo que se comprueba aquí no es el SQL: es que el archivo que recibe el cliente
 * sea fiel. Que no falte una tabla, que lo que se recortó lo diga, que una tabla
 * que su rol no puede leer no se cuele, y que el ZIP se pueda abrir.
 */

const tenantQuery = vi.fn();

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return { ...actual, tenantQuery: (...args: unknown[]) => tenantQuery(...args) };
});

import { buildCompanyExport, ROWS_PER_TABLE } from "@/lib/company-export-service";
import { companyExportPlan } from "@/lib/company-export";
import { crc32 } from "@/lib/zip";

const ctxOf = (role: AppRole): TenantContext & { companyId: string } => ({
  userId: "user-1", email: "u@x.com", name: "u", role,
  companyId: "org-1", partnerId: null, company: null,
});

/** Lee los nombres de las entradas del ZIP desde su directorio central. */
function namesIn(bytes: Uint8Array): string[] {
  const u16 = (at: number) => bytes[at] | (bytes[at + 1] << 8);
  const u32 = (at: number) =>
    (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) if (u32(i) === 0x06054b50) { eocd = i; break; }
  let cursor = u32(eocd + 16);
  const names: string[] = [];
  for (let n = 0; n < u16(eocd + 10); n++) {
    const nameLength = u16(cursor + 28);
    names.push(new TextDecoder().decode(bytes.slice(cursor + 46, cursor + 46 + nameLength)));
    cursor += 46 + nameLength + u16(cursor + 30) + u16(cursor + 32);
  }
  return names;
}

/** Contenido de una entrada, saltando a su cabecera local. */
function contentOf(bytes: Uint8Array, name: string): string {
  const u16 = (at: number) => bytes[at] | (bytes[at + 1] << 8);
  const u32 = (at: number) =>
    (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) if (u32(i) === 0x06054b50) { eocd = i; break; }
  let cursor = u32(eocd + 16);
  for (let n = 0; n < u16(eocd + 10); n++) {
    const nameLength = u16(cursor + 28);
    const found = new TextDecoder().decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    if (found === name) {
      const localAt = u32(cursor + 42);
      const size = u32(localAt + 18);
      const dataAt = localAt + 30 + u16(localAt + 26) + u16(localAt + 28);
      const data = bytes.slice(dataAt, dataAt + size);
      expect(crc32(data), `${name}: el CRC no cuadra`).toBe(u32(localAt + 14));
      return new TextDecoder().decode(data);
    }
    cursor += 46 + nameLength + u16(cursor + 30) + u16(cursor + 32);
  }
  throw new Error(`no está en el ZIP: ${name}`);
}

beforeEach(() => tenantQuery.mockReset());

describe("armar el volcado", () => {
  it("consulta TODAS las tablas del plan, ni una menos", async () => {
    // Una tabla que no se consulta es un dato del cliente que se queda aquí.
    tenantQuery.mockResolvedValue([]);
    await buildCompanyExport(ctxOf("owner"), "Tours del Este");
    const consultadas = new Set(tenantQuery.mock.calls.map((c) => c[1]));
    expect(consultadas.size).toBe(companyExportPlan().length);
  });

  it("el ZIP trae el LEEME, el inventario y solo los archivos con datos", async () => {
    tenantQuery.mockImplementation(async (_org: string, table: string) =>
      table === "customer" ? [{ _id: "c1", first_name: "Juan", last_name: "Pérez" }] : []
    );

    const { bytes, total } = await buildCompanyExport(ctxOf("owner"), "Tours del Este");
    const names = namesIn(bytes);

    expect(names).toContain("LEEME.txt");
    expect(names).toContain("_inventario.csv");
    expect(names).toContain("Clientes/clientes.csv");
    // Las ochenta y siete tablas vacías no generan archivo.
    expect(names).toHaveLength(3);
    expect(total).toBe(1);

    // Y el archivo trae los datos, no la cabecera sola.
    expect(contentOf(bytes, "Clientes/clientes.csv")).toContain("Juan");
    // El inventario declara igualmente las que no salieron.
    expect(contentOf(bytes, "_inventario.csv")).toContain("invoice");
  });

  it("pagina hasta agotar la tabla", async () => {
    // Con una sola consulta de 500, una operadora con 1 200 reservas se llevaría
    // 500 y creería que se las llevó todas.
    const page = (n: number) => Array.from({ length: n }, (_, i) => ({ _id: `b${i}` }));
    tenantQuery.mockImplementation(async (_org: string, table: string, q: Record<string, number>) => {
      if (table !== "booking") return [];
      return q._offset === 0 ? page(500) : q._offset === 500 ? page(500) : page(200);
    });

    const { rows } = await buildCompanyExport(ctxOf("owner"), "Tours");
    const booking = rows.find((r) => r.target.table === "booking")!;
    expect(booking.rows).toBe(1200);
    expect(booking.note).toBe("");
  });

  it("al llegar al tope lo dice, en vez de fingir que eso era todo", async () => {
    const page = Array.from({ length: 500 }, (_, i) => ({ _id: `b${i}` }));
    tenantQuery.mockImplementation(async (_org: string, table: string) => (table === "booking" ? page : []));

    const { rows, truncated, bytes } = await buildCompanyExport(ctxOf("owner"), "Tours");
    const booking = rows.find((r) => r.target.table === "booking")!;
    expect(booking.rows).toBe(ROWS_PER_TABLE);
    expect(booking.note).toContain(String(ROWS_PER_TABLE));
    expect(truncated).toContain("booking");
    // Y el LEEME lo avisa: un recorte silencioso es peor que un error.
    expect(contentOf(bytes, "LEEME.txt")).toContain("TABLAS RECORTADAS");
  });

  it("una tabla que el rol no puede leer no se cuela en el archivo", async () => {
    /**
     * La ruta ya exige administrador, así que en la práctica esto no se
     * ejerce. Está porque un rol nuevo con menos alcance no debe convertir este
     * botón en la puerta de atrás para leer lo que su pantalla le niega.
     */
    tenantQuery.mockResolvedValue([{ _id: "x" }]);
    const { rows, bytes } = await buildCompanyExport(ctxOf("manager"), "Tours");

    const auditoria = rows.find((r) => r.target.table === "audit_log")!;
    expect(auditoria.note).toBe("sin permiso para leerla");
    expect(auditoria.rows).toBe(0);
    expect(namesIn(bytes)).not.toContain("Administracion/bitacora-de-auditoria.csv");
    // Y no se consultó siquiera.
    expect(tenantQuery.mock.calls.map((c) => c[1])).not.toContain("audit_log");
    // El LEEME lo explica en vez de dejar un hueco sin motivo.
    expect(contentOf(bytes, "LEEME.txt")).toContain("TABLAS NO INCLUIDAS");
  });

  it("el nombre del archivo lleva la empresa y la fecha", async () => {
    tenantQuery.mockResolvedValue([]);
    const { filename } = await buildCompanyExport(ctxOf("owner"), "Excursiones Bávaro", new Date("2026-09-16T10:00:00Z"));
    expect(filename).toBe("excursiones-bavaro-datos-2026-09-16.zip");
  });

  it("si una tabla falla, falla la exportación: no se entrega un volcado mudo", async () => {
    // Devolver el archivo sin esa tabla y sin decirlo sería el peor final
    // posible: el cliente se muda creyendo que tiene todo.
    tenantQuery.mockImplementation(async (_org: string, table: string) => {
      if (table === "booking") throw new Error("la conexión se cayó");
      return [];
    });
    await expect(buildCompanyExport(ctxOf("owner"), "Tours")).rejects.toThrow("la conexión se cayó");
  });
});
