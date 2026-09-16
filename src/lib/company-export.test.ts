import { describe, it, expect } from "vitest";
import {
  COMPANY_EXPORT_AREAS, companyExportPlan, inventoryCsv, filesToWrite, readmeText,
  companyExportFilename, slug, type CompanyExportRow,
} from "@/lib/company-export";
import { RESOURCES, readRoleFor } from "@/lib/resources";
import { parseDelimited } from "@/lib/import";

const fila = (path: string, table: string, rows: number, note = ""): CompanyExportRow => ({
  target: { resource: table, table, area: path.split("/")[0], path },
  rows,
  note,
});

/**
 * La prueba que importa de este archivo es la PRIMERA: que no falte ninguna
 * tabla. Todo lo demás del volcado puede estar perfecto y, si una tabla nueva se
 * quedó fuera, el cliente se lleva sus datos incompletos creyendo que se lleva
 * todo — y no lo descubre hasta que ya se fue.
 */
describe("el mapa cubre la empresa entera", () => {
  it("cada recurso del ERP está en exactamente una carpeta", () => {
    const enElMapa = COMPANY_EXPORT_AREAS.flatMap((a) => Object.keys(a.files));
    const faltan = Object.keys(RESOURCES).filter((r) => !enElMapa.includes(r));
    expect(
      faltan,
      `estas tablas no saldrían en «llévate tus datos»: ${faltan.join(", ")}. ` +
      "Añádelas a la carpeta que les corresponda en COMPANY_EXPORT_AREAS."
    ).toEqual([]);

    const repetidos = enElMapa.filter((r, i) => enElMapa.indexOf(r) !== i);
    expect(repetidos, "una tabla en dos carpetas se exportaría dos veces").toEqual([]);
  });

  it("no hay recursos inventados en el mapa", () => {
    // Un nombre mal escrito aquí no rompe nada: simplemente esa tabla no sale.
    const sobran = COMPANY_EXPORT_AREAS
      .flatMap((a) => Object.keys(a.files))
      .filter((r) => !RESOURCES[r]);
    expect(sobran, `no existen en RESOURCES: ${sobran.join(", ")}`).toEqual([]);
  });

  it("ningún recurso se llama «company»: taparía la ruta del volcado", () => {
    /**
     * `/api/export/company` es una ruta estática y gana sobre `[resource]`. Un
     * recurso con ese nombre dejaría de poder exportarse y, peor, su botón
     * devolvería el volcado completo de la empresa a quien pidió una lista.
     */
    expect(Object.keys(RESOURCES)).not.toContain("company");
  });

  it("el plan tiene una ruta distinta por tabla", () => {
    const plan = companyExportPlan();
    expect(plan).toHaveLength(Object.keys(RESOURCES).length);
    expect(new Set(plan.map((p) => p.path)).size).toBe(plan.length);
  });

  it("los nombres de archivo aguantan cualquier sistema de archivos", () => {
    // Un acento o un espacio en el nombre sobrevive al ZIP, pero no siempre a lo
    // que el cliente haga después con el archivo.
    for (const { path } of companyExportPlan()) {
      expect(path, `${path} no debería llevar acentos, espacios ni mayúsculas raras`)
        .toMatch(/^[A-Z][a-zA-Z]+\/[a-z0-9-]+\.csv$/);
    }
  });
});

describe("el inventario", () => {
  const rows = [
    fila("Clientes/clientes.csv", "customer", 120),
    fila("Finanzas/facturas.csv", "invoice", 0),
    fila("Comercial/reservas.csv", "booking", 5000, "recortada en 5000 registros"),
  ];

  it("declara también las tablas vacías", () => {
    // Sin esto, «esta empresa no facturaba» y «la exportación se dejó la
    // facturación» se ven exactamente igual: un archivo que no está.
    const csv = inventoryCsv(rows);
    expect(csv).toContain("invoice");
    expect(csv).toContain("sin registros");
  });

  it("es un CSV de verdad, legible por el lector del importador", () => {
    const parsed = parseDelimited(inventoryCsv(rows));
    expect(parsed.headers).toEqual(["Carpeta", "Archivo", "Tabla", "Registros", "Nota"]);
    expect(parsed.rows).toHaveLength(3);
  });

  it("la tabla vacía no anuncia un archivo que no existe", () => {
    const parsed = parseDelimited(inventoryCsv(rows));
    const vacia = parsed.rows.find((cells) => cells[2] === "invoice")!;
    expect(vacia[1]).toBe("");
  });

  it("solo se escriben los archivos con datos", () => {
    expect(filesToWrite(rows).map((r) => r.target.table)).toEqual(["customer", "booking"]);
  });
});

describe("el LEEME", () => {
  const base = { company: "Tours del Este SRL", at: new Date("2026-09-16T14:30:00Z"), rowLimit: 5000 };

  it("explica el formato y por qué las referencias son identificadores", () => {
    // Es lo único que no se deduce mirando los CSV, y sin esa explicación el
    // técnico del otro sistema concluye que el volcado está roto.
    const texto = readmeText({ ...base, rows: [fila("Clientes/clientes.csv", "customer", 3)] });
    expect(texto).toContain("TOURS DEL ESTE SRL");
    expect(texto).toContain("DD/MM/AAAA");
    expect(texto).toMatch(/identificador/i);
    expect(texto).toContain("_inventario.csv");
  });

  it("avisa de lo que salió recortado, con su nombre", () => {
    const texto = readmeText({
      ...base,
      rows: [fila("Comercial/reservas.csv", "booking", 5000, "recortada en 5000 registros")],
    });
    expect(texto).toContain("TABLAS RECORTADAS");
    expect(texto).toContain("Comercial/reservas.csv");
    expect(texto).toContain("5000");
  });

  it("no inventa un aviso de recorte cuando nada se recortó", () => {
    const texto = readmeText({ ...base, rows: [fila("Clientes/clientes.csv", "customer", 3)] });
    expect(texto).not.toContain("TABLAS RECORTADAS");
  });

  it("dice qué tablas no salieron por permisos, en vez de callarlo", () => {
    // Un volcado al que le faltan tablas y no lo dice es peor que uno que falla.
    const texto = readmeText({
      ...base,
      rows: [fila("Administracion/bitacora-de-auditoria.csv", "audit_log", 0, "sin permiso para leerla")],
    });
    expect(texto).toContain("TABLAS NO INCLUIDAS");
    expect(texto).toContain("audit_log");
  });

  it("cuenta los registros, no los archivos", () => {
    const texto = readmeText({
      ...base,
      rows: [fila("a/b.csv", "customer", 120), fila("a/c.csv", "booking", 80), fila("a/d.csv", "invoice", 0)],
    });
    expect(texto).toContain("200 registro(s)");
    expect(texto).toContain("2 archivo(s)");
  });
});

describe("el nombre del ZIP", () => {
  it("lleva la empresa y la fecha, sin acentos ni espacios", () => {
    expect(companyExportFilename("Excursiones Bávaro, S.R.L.", new Date("2026-09-16T10:00:00Z")))
      .toBe("excursiones-bavaro-s-r-l-datos-2026-09-16.zip");
  });

  it("una empresa sin nombre legible no produce un archivo sin nombre", () => {
    expect(slug("   ")).toBe("empresa");
    expect(slug("...")).toBe("empresa");
  });

  it("un nombre larguísimo no produce una ruta imposible", () => {
    expect(slug("A".repeat(200)).length).toBeLessThanOrEqual(40);
  });
});

describe("el gobierno de la cuenta no se lee desde cualquier rol", () => {
  it("la bitácora, los conectores y las secuencias fiscales exigen administrador", () => {
    /**
     * Estaban protegidas en el menú y en la escritura, pero su LECTURA por la
     * API genérica estaba abierta: un vendedor podía pedir `/api/erp/audit_log`
     * y leer el rastro completo de la empresa. El menú nunca es la barrera.
     *
     * La guarda vive junto a la exportación porque el volcado completo aplica
     * este mismo `readRoleFor` tabla por tabla: aflojarlo aquí abriría las dos
     * puertas a la vez.
     */
    for (const table of ["audit_log", "integration", "ncf_sequence"]) {
      expect(readRoleFor(table), `${table} se podría leer sin ser administrador`).toBe("admin");
    }
  });
});
