import { describe, it, expect } from "vitest";
import {
  csvCell, toCsv, formatValue, exportColumns, buildExport, exportFilename, prettify, EXCEL_BOM,
} from "@/lib/export";
import { parseDelimited, autoMap, prepareRows, targetByKey } from "@/lib/import";

/**
 * Lo que se exporta tiene que poder volver a entrar. El ciclo real de cualquier
 * operadora es exportar, corregir en Excel y reimportar, y si la vuelta exige
 * traducir cabeceras o formatos a mano, ese ciclo no lo hace nadie.
 *
 * Por eso la prueba central de este archivo no mira el CSV: mira el CÍRCULO
 * COMPLETO —exportar, leer con el parser del importador, mapear y validar— y
 * comprueba que los datos llegan iguales al otro lado.
 */

describe("escribir una celda", () => {
  it("entrecomilla lo que llevaría el archivo a romperse", () => {
    // La dirección con coma y la nota con salto son el primer archivo real, no
    // el caso raro.
    expect(csvCell("Calle 5, Apto 3")).toBe('"Calle 5, Apto 3"');
    expect(csvCell("Primera\nSegunda")).toBe('"Primera\nSegunda"');
    expect(csvCell('Hotel "El Faro"')).toBe('"Hotel ""El Faro"""');
  });

  it("deja en paz lo que no lo necesita", () => {
    expect(csvCell("Juan")).toBe("Juan");
    expect(csvCell("")).toBe("");
  });

  it("con punto y coma, la coma deja de ser peligrosa y el punto y coma lo es", () => {
    expect(csvCell("1,50", ";")).toBe("1,50");
    expect(csvCell("a;b", ";")).toBe('"a;b"');
  });
});

describe("armar el archivo", () => {
  it("lleva el BOM que Excel necesita para los acentos", () => {
    // Sin BOM, «Pérez» se abre como «PÃ©rez» y quien lo ve concluye que el
    // sistema guardó mal los nombres.
    const csv = toCsv(["Nombre"], [["Pérez"]]);
    expect(csv.startsWith(EXCEL_BOM)).toBe(true);
  });

  it("separa las filas con CRLF", () => {
    expect(toCsv(["a"], [["1"], ["2"]], { bom: false })).toBe("a\r\n1\r\n2");
  });

  it("sin filas sigue saliendo la cabecera", () => {
    // Un archivo vacío del todo parece un error de descarga; con la cabecera se
    // ve que la consulta no tenía resultados.
    expect(toCsv(["Nombre", "Correo"], [], { bom: false })).toBe("Nombre,Correo");
  });
});

describe("escribir un valor", () => {
  it("la fecha sale en el formato de aquí", () => {
    expect(formatValue("1990-12-31")).toBe("31/12/1990");
    expect(formatValue("2026-04-03T00:00:00Z")).toBe("03/04/2026");
  });

  it("una marca de tiempo con hora la conserva", () => {
    // Recortar la hora de un movimiento de caja perdería el dato que explica el
    // orden de los movimientos del día.
    expect(formatValue("2026-04-03T14:30:00Z")).toBe("03/04/2026 14:30");
  });

  it("el número va sin separador de miles", () => {
    // Con separador, Excel en español lo lee como TEXTO y la columna deja de
    // sumar: el contador lo nota en la primera factura.
    expect(formatValue(1250.5)).toBe("1250.5");
    expect(formatValue(1250)).toBe("1250");
  });

  it("ni notación científica ni infinitos", () => {
    expect(formatValue(0.0000001)).not.toContain("e");
    expect(formatValue(Infinity)).toBe("");
    expect(formatValue(NaN)).toBe("");
  });

  it("vacío es vacío, no «null» ni «undefined»", () => {
    expect(formatValue(null)).toBe("");
    expect(formatValue(undefined)).toBe("");
  });

  it("una referencia sale por su nombre, no por su uuid", () => {
    expect(formatValue({ _id: "uuid-1", name: "Hotel Bávaro" })).toBe("Hotel Bávaro");
    expect(formatValue({ _id: "uuid-2", first_name: "Juan", last_name: "Pérez" })).toBe("Juan Pérez");
    expect(formatValue({ _id: "uuid-3", code: "TOUR-01" })).toBe("TOUR-01");
  });

  it("una referencia con solo correo sale por el correo, no por su uuid", () => {
    // El `??` encadenado no llegaba aquí: el `join` de nombre y apellido
    // devuelve "" cuando faltan los dos, y "" no es nullish, así que cortaba la
    // cadena y la ficha salía como un identificador ilegible.
    expect(formatValue({ _id: "uuid-5", email: "solo@correo.com" })).toBe("solo@correo.com");
  });

  it("una referencia sin nada legible cae al identificador, no a vacío", () => {
    // Perder la referencia entera sería peor que enseñar un uuid: al menos
    // el uuid permite cruzarla.
    expect(formatValue({ _id: "uuid-4" })).toBe("uuid-4");
  });

  it("una lista se separa con punto y coma dentro de la celda", () => {
    expect(formatValue(["vip", "repetidor"])).toBe("vip; repetidor");
  });

  it("los booleanos salen legibles", () => {
    expect(formatValue(true)).toBe("sí");
    expect(formatValue(false)).toBe("no");
  });
});

describe("elegir las columnas", () => {
  const rows = [
    { _id: "1", first_name: "Juan", last_name: "Pérez", email: "j@x.com", organization_id: "org", createdAt: "2026-01-01" },
  ];

  it("no saca el inquilino ni las marcas internas", () => {
    const headers = exportColumns("customer", rows).map((c) => c.field);
    expect(headers).not.toContain("organization_id");
    expect(headers).not.toContain("createdAt");
  });

  it("los campos importables van primero y con SU cabecera", () => {
    const columns = exportColumns("customer", rows);
    expect(columns[0]).toEqual({ field: "first_name", header: "Nombre" });
    expect(columns.find((c) => c.field === "email")!.header).toBe("Correo");
  });

  it("los campos que no se importan salen igual, con nombre legible", () => {
    // Quien exporta quiere TODO lo que tiene, no solo lo que un día decidimos
    // que se podía importar.
    const columns = exportColumns("customer", [{ ...rows[0], internal_score: 9 }]);
    expect(columns.find((c) => c.field === "internal_score")!.header).toBe("Internal score");
  });

  it("una columna presente solo en algunas filas también sale", () => {
    const columns = exportColumns("customer", [{ first_name: "Juan" }, { first_name: "Ana", notes: "vip" }]);
    expect(columns.map((c) => c.field)).toContain("notes");
  });

  it("prettify deja el nombre de columna presentable", () => {
    expect(prettify("pickup_offset_min")).toBe("Pickup offset min");
    expect(prettify("supplier_id")).toBe("Supplier");
  });
});

describe("el círculo completo: exportar y volver a importar", () => {
  it("lo exportado se lee, se mapea y se valida sin tocar nada", () => {
    /**
     * Esta es la prueba que justifica todas las decisiones de formato de este
     * archivo. Si alguien cambia las fechas a ISO, mete separador de miles o
     * renombra una cabecera «para que se vea mejor», el círculo se rompe aquí
     * y no en el archivo de un cliente a medio migrar.
     */
    const customer = targetByKey("customer")!;
    const origen = [
      {
        _id: "uuid-1",
        first_name: "Juan", last_name: "Pérez",
        email: "juan@ejemplo.com",
        phone: "8095550101",
        birth_date: "1990-12-31",
        tags: ["vip", "repetidor"],
        address: "Calle 5, Apto 3",
        notes: 'Prefiere el "tour largo"\ny ventana',
        organization_id: "org-1",
      },
    ];

    const { csv } = buildExport("customer", origen);

    // La vuelta, con el lector del importador.
    const parsed = parseDelimited(csv);
    const mapping = autoMap(parsed.headers, customer);
    const prepared = prepareRows(parsed, mapping, customer);

    expect(prepared.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(prepared.valid).toHaveLength(1);

    const vuelta = prepared.valid[0].values;
    expect(vuelta.first_name).toBe("Juan");
    expect(vuelta.last_name).toBe("Pérez");
    expect(vuelta.email).toBe("juan@ejemplo.com");
    expect(vuelta.phone).toBe("8095550101");
    // La fecha sobrevivió al viaje de ida y vuelta.
    expect(vuelta.birth_date).toBe("1990-12-31");
    expect(vuelta.tags).toEqual(["vip", "repetidor"]);
    // Y lo que rompe los CSV mal escritos: coma, comillas y salto de línea.
    expect(vuelta.address).toBe("Calle 5, Apto 3");
    expect(vuelta.notes).toBe('Prefiere el "tour largo"\ny ventana');
  });

  it("el círculo se sostiene para todos los destinos importables", () => {
    for (const target of [targetByKey("product")!, targetByKey("supplier")!, targetByKey("hotel")!]) {
      const fila: Record<string, unknown> = { _id: "uuid" };
      for (const field of target.fields) {
        fila[field.name] =
          field.type === "number" ? 12.5
          : field.type === "date" ? "2026-04-03"
          : field.type === "email" ? "a@b.com"
          : field.type === "enum" ? field.values?.[0]
          : field.type === "list" ? ["uno", "dos"]
          : `Valor de ${field.label}`;
      }
      const { csv } = buildExport(target.resource, [fila]);
      const parsed = parseDelimited(csv);
      const prepared = prepareRows(parsed, autoMap(parsed.headers, target), target);
      expect(
        prepared.issues.filter((i) => i.severity === "error"),
        `${target.key}: el archivo exportado no se puede reimportar`
      ).toEqual([]);
    }
  });
});

describe("el nombre del archivo", () => {
  it("lleva el recurso y la fecha, sin espacios", () => {
    expect(exportFilename("customer", new Date("2026-09-16T10:00:00Z"))).toBe("customer-2026-09-16.csv");
  });
});

describe("las marcas de tiempo", () => {
  const rows = [{ _id: "1", first_name: "Juan", created_at: "2026-01-02T10:00:00Z", updated_at: "2026-03-04T11:00:00Z" }];

  it("en el listado no salen: dos columnas que nadie mira", () => {
    expect(exportColumns("customer", rows).map((c) => c.field)).not.toContain("created_at");
  });

  it("en el volcado completo sí, porque son parte del registro", () => {
    // «Cuándo se creó esta reserva» no se reconstruye de ninguna otra parte, y
    // quien recibe el volcado para mudarse lo necesita.
    const columns = exportColumns("customer", rows, { keepTimestamps: true }).map((c) => c.field);
    expect(columns).toContain("created_at");
    expect(columns).toContain("updated_at");
  });

  it("salen con cabecera en español, no «Created at»", () => {
    // En un archivo en español una cabecera en inglés canta, y en el volcado
    // que se lleva un cliente canta el doble.
    const columns = exportColumns("customer", rows, { keepTimestamps: true });
    expect(columns.find((c) => c.field === "created_at")!.header).toBe("Creado el");
    expect(columns.find((c) => c.field === "updated_at")!.header).toBe("Actualizado el");
    expect(columns.find((c) => c.field === "_id")!.header).toBe("Id interno");
  });

  it("el inquilino no sale ni con marcas de tiempo", () => {
    const columns = exportColumns("customer", [{ ...rows[0], organization_id: "org" }], { keepTimestamps: true });
    expect(columns.map((c) => c.field)).not.toContain("organization_id");
  });
});
