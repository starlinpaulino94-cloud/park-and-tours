import { describe, it, expect } from "vitest";
import {
  parseDelimited, detectDelimiter, normalizeHeader, autoMap, prepareRows, summarize,
  parseNumber, parseDate, normalizePhone, sampleCsv, targetByKey, IMPORT_TARGETS,
} from "@/lib/import";

/**
 * El archivo lo exporta una persona desde su Excel, no una API. Aquí se prueban
 * los casos que de verdad llegan: punto y coma, BOM, comas dentro de una
 * dirección, saltos de línea dentro de una nota, «1.250,50», «31/12/2026» y
 * cabeceras con acentos. Cada uno de estos, sin cubrir, se manifiesta como una
 * importación que dice «listo» y deja los datos mal.
 */

const customer = targetByKey("customer")!;

describe("leer el archivo", () => {
  it("una coma dentro de una celda entrecomillada no parte la fila", () => {
    // El fallo del `split(",")`: la primera dirección con coma corre todas las
    // columnas siguientes y el teléfono acaba en el país.
    const { headers, rows } = parseDelimited('nombre,direccion\nJuan,"Calle 5, Apto 3"');
    expect(headers).toEqual(["nombre", "direccion"]);
    expect(rows[0]).toEqual(["Juan", "Calle 5, Apto 3"]);
  });

  it("un salto de línea dentro de una celda no crea una fila nueva", () => {
    const { rows } = parseDelimited('nombre,notas\nJuan,"Primera línea\nSegunda línea"\nAna,ok');
    expect(rows).toHaveLength(2);
    expect(rows[0][1]).toBe("Primera línea\nSegunda línea");
    expect(rows[1][0]).toBe("Ana");
  });

  it("las comillas escapadas se devuelven como una sola", () => {
    const { rows } = parseDelimited('nombre\n"Hotel ""El Faro"""');
    expect(rows[0][0]).toBe('Hotel "El Faro"');
  });

  it("el BOM de Excel no contamina la primera cabecera", () => {
    // Sin quitarlo, `nombre` deja de coincidir con su alias y el usuario ve
    // «columna sin reconocer» sobre una columna perfectamente escrita.
    const { headers } = parseDelimited("\uFEFFnombre,correo\nJuan,j@x.com");
    expect(headers[0]).toBe("nombre");
    expect(headers[0].charCodeAt(0)).toBe(110);
  });

  it("acepta el punto y coma del Excel en español", () => {
    const parsed = parseDelimited("nombre;correo\nJuan;j@x.com");
    expect(parsed.delimiter).toBe(";");
    expect(parsed.rows[0]).toEqual(["Juan", "j@x.com"]);
  });

  it("el separador se detecta FUERA de las comillas", () => {
    // «Pérez, Juan» en la primera celda haría elegir la coma a un contador
    // ingenuo, y entonces el archivo entero se lee mal.
    expect(detectDelimiter('"Pérez, Juan";correo;telefono')).toBe(";");
  });

  it("CRLF de Windows y la última línea sin salto", () => {
    const { rows } = parseDelimited("a,b\r\n1,2\r\n3,4");
    expect(rows).toEqual([["1", "2"], ["3", "4"]]);
  });

  it("las filas vacías se ignoran y las descuadradas se señalan", () => {
    // Quitar en silencio una fila con columnas de más es cómo se pierden veinte
    // clientes en una importación que dijo que todo salió bien.
    const parsed = parseDelimited("a,b\n1,2\n\n3,4,5\n");
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.ragged).toEqual([1]);
  });
});

describe("reconocer las columnas", () => {
  it("normaliza acentos, mayúsculas y signos", () => {
    expect(normalizeHeader("  Teléfono Móvil ")).toBe("telefono movil");
    expect(normalizeHeader("E-Mail")).toBe("e mail");
  });

  it("mapea las cabeceras típicas sin que nadie toque nada", () => {
    const headers = ["Nombre", "Apellidos", "Correo electrónico", "Teléfono", "País"];
    const mapping = autoMap(headers, customer);
    expect(mapping[0]).toBe("first_name");
    expect(mapping[1]).toBe("last_name");
    expect(mapping[2]).toBe("email");
    expect(mapping[3]).toBe("phone");
    expect(mapping[4]).toBe("country");
  });

  it("el alias exacto gana: «teléfono» no le roba la columna a «whatsapp»", () => {
    const mapping = autoMap(["WhatsApp", "Teléfono"], customer);
    expect(mapping[0]).toBe("whatsapp");
    expect(mapping[1]).toBe("phone");
  });

  it("dos columnas para el mismo campo: la primera se lo queda, la segunda se ignora", () => {
    // Pisar la buena con la segunda sería peor que dejar una fuera.
    const mapping = autoMap(["Teléfono", "Telefono 2"], customer);
    expect(mapping[0]).toBe("phone");
    expect(mapping[1]).toBeNull();
  });

  it("una columna desconocida se ignora, no rompe", () => {
    const mapping = autoMap(["Nombre", "Color favorito"], customer);
    expect(mapping[0]).toBe("first_name");
    expect(mapping[1]).toBeNull();
  });
});

describe("números y fechas escritos por una persona", () => {
  it("lee el formato de la región y el anglosajón", () => {
    expect(parseNumber("1.250,50")).toBe(1250.5);
    expect(parseNumber("1,250.50")).toBe(1250.5);
    expect(parseNumber("$ 1,500")).toBe(1500);
    expect(parseNumber("1250")).toBe(1250);
    expect(parseNumber("0,5")).toBe(0.5);
  });

  it("«1.250» son mil doscientos cincuenta, no uno coma veinticinco", () => {
    // La ambigüedad real de cualquier hoja de cálculo de la región. Leerlo como
    // 1,25 convierte un tour de 1.250 pesos en uno de peso y pico.
    expect(parseNumber("1.250")).toBe(1250);
    expect(parseNumber("1.25")).toBe(1.25);
  });

  it("lo que no es un número devuelve null en vez de NaN", () => {
    expect(parseNumber("gratis")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });

  it("la fecha es DÍA/MES/AÑO, que es como se escribe aquí", () => {
    // Leer «03/04/2026» como 4 de marzo le cambia el cumpleaños a medio archivo.
    expect(parseDate("03/04/2026")).toBe("2026-04-03");
    expect(parseDate("31/12/1990")).toBe("1990-12-31");
    expect(parseDate("1-2-99")).toBe("2099-02-01");
  });

  it("el ISO se reconoce aparte porque no es ambiguo", () => {
    expect(parseDate("2026-04-03")).toBe("2026-04-03");
  });

  it("una fecha imposible se rechaza en vez de rebotar al mes siguiente", () => {
    // `new Date(2026, 1, 31)` da el 3 de marzo sin quejarse: guardaría una
    // fecha que el usuario no escribió.
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("45/12/2026")).toBeNull();
    expect(parseDate("mañana")).toBeNull();
  });

  it("el teléfono queda comparable, conservando el prefijo internacional", () => {
    expect(normalizePhone("(809) 555-0101")).toBe("8095550101");
    expect(normalizePhone("+1 809 555 0101")).toBe("+18095550101");
  });
});

describe("validar el archivo entero", () => {
  const parse = (csv: string) => {
    const parsed = parseDelimited(csv);
    return prepareRows(parsed, autoMap(parsed.headers, customer), customer);
  };

  it("una fila mala no arrastra a las buenas", () => {
    // En un archivo de trescientos clientes siempre hay tres con el correo mal.
    // Rechazar el archivo completo obliga a corregir a ciegas.
    const prepared = parse(
      "Nombre,Correo\nJuan,juan@x.com\nAna,esto-no-es-correo\nLuis,luis@x.com"
    );
    expect(prepared.valid).toHaveLength(2);
    expect(prepared.valid.map((r) => r.values.first_name)).toEqual(["Juan", "Luis"]);
    const error = prepared.issues.find((i) => i.severity === "error")!;
    expect(error.line).toBe(3);
    expect(error.message).toContain("correo");
  });

  it("el número de fila es el que el usuario ve en su Excel", () => {
    // La cabecera es la 1, así que el primer dato es la 2. Decir «fila 0» o
    // «fila 1» manda a la persona a corregir la fila equivocada.
    const prepared = parse("Nombre,Correo\nJuan,mal");
    expect(prepared.issues.find((i) => i.severity === "error")!.line).toBe(2);
  });

  it("sin la columna obligatoria no se importa nada", () => {
    const prepared = parse("Correo,Teléfono\njuan@x.com,809");
    expect(prepared.valid).toHaveLength(0);
    expect(prepared.issues[0].message).toContain("Nombre");
  });

  it("un obligatorio vacío falla solo en su fila", () => {
    const prepared = parse("Nombre,Correo\n,juan@x.com\nAna,ana@x.com");
    expect(prepared.valid).toHaveLength(1);
    expect(prepared.issues.some((i) => i.message.includes("obligatorio"))).toBe(true);
  });

  it("dos filas con el mismo correo: la segunda se omite y se avisa", () => {
    const prepared = parse("Nombre,Correo\nJuan,j@x.com\nJuan C,j@x.com");
    expect(prepared.valid).toHaveLength(1);
    const warn = prepared.issues.find((i) => i.severity === "warning")!;
    expect(warn.line).toBe(3);
    expect(warn.message).toContain("fila 2");
  });

  it("dos personas con el mismo nombre NO son un duplicado", () => {
    // Hay muchos Juan Pérez. La identidad es el correo o el teléfono.
    const prepared = parse("Nombre,Apellido,Teléfono\nJuan,Pérez,809\nJuan,Pérez,829");
    expect(prepared.valid).toHaveLength(2);
  });

  it("los valores llegan ya convertidos y normalizados", () => {
    const prepared = parse("Nombre,Correo,Teléfono,Fecha de nacimiento,Etiquetas\n" +
      "Juan,  JUAN@X.COM ,(809) 555-0101,31/12/1990,vip;repetidor");
    const row = prepared.valid[0].values;
    expect(row.email).toBe("juan@x.com");
    expect(row.phone).toBe("8095550101");
    expect(row.birth_date).toBe("1990-12-31");
    expect(row.tags).toEqual(["vip", "repetidor"]);
  });

  it("un valor fuera del dominio de la base se rechaza antes de escribir", () => {
    // La moneda la acota un enum en Postgres: dejarla pasar convertiría un
    // error del archivo en un fallo de base a mitad de la importación.
    const product = targetByKey("product")!;
    const parsed = parseDelimited("Nombre,Moneda\nTour,pesos");
    const prepared = prepareRows(parsed, autoMap(parsed.headers, product), product);
    expect(prepared.valid).toHaveLength(0);
    expect(prepared.issues[0].message).toContain("usd");
  });
});

describe("el resumen que se enseña antes de confirmar", () => {
  it("separa lo que se crea de lo que se actualiza", () => {
    const parsed = parseDelimited("Nombre,Correo\nJuan,j@x.com\nAna,a@x.com");
    const prepared = prepareRows(parsed, autoMap(parsed.headers, customer), customer);
    const summary = summarize(prepared, new Set(["email:j@x.com"]));
    expect(summary.create).toBe(1);
    expect(summary.update).toBe(1);
    expect(summary.total).toBe(2);
  });

  it("cuenta como omitidas las filas que no van a entrar", () => {
    const parsed = parseDelimited("Nombre,Correo\nJuan,j@x.com\nAna,mal");
    const prepared = prepareRows(parsed, autoMap(parsed.headers, customer), customer);
    const summary = summarize(prepared, new Set());
    expect(summary.skipped).toBe(1);
    expect(summary.errors).toBe(1);
  });
});

describe("los destinos", () => {
  it("cada destino tiene al menos un campo obligatorio y una regla de duplicado", () => {
    for (const target of IMPORT_TARGETS) {
      expect(target.fields.some((f) => f.required), target.key).toBe(true);
      expect(target.dedupeBy.length, target.key).toBeGreaterThan(0);
      // Toda regla de duplicado apunta a un campo que existe: una regla sobre un
      // campo inventado no detectaría nada y nadie se enteraría.
      for (const rule of target.dedupeBy) {
        for (const field of rule) {
          expect(target.fields.map((f) => f.name), `${target.key}.${field}`).toContain(field);
        }
      }
    }
  });

  it("el archivo de ejemplo se puede volver a leer con el mapeo automático", () => {
    // El ejemplo que se descarga tiene que importarse sin tocar nada: si sus
    // propias cabeceras no se reconocen, la plantilla es una trampa.
    for (const target of IMPORT_TARGETS) {
      const parsed = parseDelimited(sampleCsv(target));
      const mapping = autoMap(parsed.headers, target);
      const mapped = Object.values(mapping).filter(Boolean);
      for (const field of target.fields.filter((f) => f.required)) {
        expect(mapped, `${target.key}: el ejemplo no mapea ${field.name}`).toContain(field.name);
      }
    }
  });
});
