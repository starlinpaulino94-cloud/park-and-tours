import { describe, it, expect } from "vitest";
import {
  REPORTES, reportePorSlug, gruposDeReportes, valorCrudo, sumaColumna, totalesDe, monedaDe,
  textoCelda, esNumerica, cuadreDe, TOLERANCIA_CUADRE,
} from "@/lib/reportes";
import { RESOURCES } from "@/lib/resources";

describe("el catálogo de reportes", () => {
  it("cada reporte apunta a un recurso que existe", () => {
    /**
     * Es la guarda que justifica el registro. Un `recurso` mal escrito no falla
     * al compilar: falla cuando alguien abre el reporte delante de un cliente y
     * le sale «Recurso desconocido».
     */
    const rotos = REPORTES
      .filter((r) => !(r.recurso in RESOURCES))
      .map((r) => `${r.slug} → ${r.recurso}`);
    expect(rotos, "reportes que apuntan a un recurso inexistente").toEqual([]);
  });

  it("no hay dos reportes con el mismo enlace", () => {
    // Dos slugs iguales serían un reporte que tapa a otro, y el tapado no
    // aparece por ninguna parte.
    const slugs = REPORTES.map((r) => r.slug);
    expect(slugs.length).toBe(new Set(slugs).size);
  });

  it("los totales suman columnas que el reporte de verdad enseña", () => {
    /**
     * Un total de una columna que no está en pantalla es un número que nadie
     * puede comprobar: se ve el resultado y no los sumandos.
     */
    const sueltos: string[] = [];
    for (const r of REPORTES) {
      const columnas = new Set(r.columnas.map((c) => c.clave));
      for (const t of r.totales ?? []) if (!columnas.has(t)) sueltos.push(`${r.slug} → ${t}`);
    }
    expect(sueltos, "totales de columnas que no se enseñan").toEqual([]);
  });

  it("todos tienen título, descripción, columnas y campo de fecha", () => {
    // Sin campo de fecha, el selector de período no acota nada y el reporte
    // saldría con TODO el historial: el peor resultado posible, porque parece
    // correcto.
    for (const r of REPORTES) {
      expect(r.titulo.length, r.slug).toBeGreaterThan(3);
      expect(r.descripcion.length, r.slug).toBeGreaterThan(10);
      expect(r.campoFecha.length, r.slug).toBeGreaterThan(2);
      expect(r.columnas.length, r.slug).toBeGreaterThan(1);
    }
  });

  it("se encuentra por su enlace, y lo que no existe devuelve null", () => {
    expect(reportePorSlug("ventas")?.recurso).toBe("order");
    expect(reportePorSlug("no-existe")).toBeNull();
  });

  it("los grupos conservan el orden del registro", () => {
    // El orden del índice es una decisión editorial: primero lo comercial,
    // luego el dinero. Si se derivara de un objeto, lo decidiría el motor.
    expect(gruposDeReportes().map((g) => g.grupo)).toEqual(
      [...new Set(REPORTES.map((r) => r.grupo))],
    );
  });
});

describe("el valor de una celda", () => {
  it("de una relación expandida saca el texto, no el objeto", () => {
    // Sin esto la columna «Cliente» imprime [object Object], que es el defecto
    // clásico de un listado genérico.
    const fila = { customer: { name: "Laura Gutiérrez", _id: "c1" } };
    expect(valorCrudo(fila, { clave: "customer", titulo: "Cliente", desde: "name" }))
      .toBe("Laura Gutiérrez");
  });

  it("una relación vacía no revienta", () => {
    expect(valorCrudo({ customer: null }, { clave: "customer", titulo: "C", desde: "name" })).toBe(null);
    expect(valorCrudo({}, { clave: "customer", titulo: "C", desde: "name" })).toBe(undefined);
  });

  it("un valor plano se devuelve tal cual", () => {
    expect(valorCrudo({ total: 1200 }, { clave: "total", titulo: "Total" })).toBe(1200);
  });
});

describe("los totales del pie", () => {
  it("suman lo que hay", () => {
    expect(sumaColumna([{ a: 10 }, { a: 5 }, { a: 2.5 }], "a")).toBe(17.5);
  });

  it("lo que no es número no suma, pero tampoco rompe el total", () => {
    /**
     * ──────────────────────────────────────────────────────────────────────
     * POR QUÉ ESTO IMPORTA
     *
     * Las cifras llegan de PostgREST y un `numeric` puede venir como texto.
     * Una suma ingenua daría "0105" concatenando, o NaN en cuanto una fila
     * tuviera el campo vacío — y un total en NaN al pie de un reporte impreso
     * es peor que no poner total.
     */
    expect(sumaColumna([{ a: "10" }, { a: null }, { a: "" }, { a: undefined }, { a: "x" }, { a: 5 }], "a"))
      .toBe(15);
  });

  it("sin filas, el total es cero y no NaN", () => {
    expect(sumaColumna([], "a")).toBe(0);
  });

  it("solo totaliza las columnas declaradas", () => {
    const def = REPORTES.find((r) => r.slug === "cobros")!;
    const t = totalesDe([{ amount: 100, otro: 999 }, { amount: 50 }], def);
    expect(t).toEqual({ amount: 150 });
  });
});

describe("la moneda del reporte", () => {
  it("si todas las filas coinciden, esa", () => {
    expect(monedaDe([{ currency: "dop" }, { currency: "dop" }])).toBe("dop");
  });

  it("si hay mezcla, NO se inventa una", () => {
    /**
     * Sumar pesos y dólares bajo un solo símbolo es inventarse una tasa de
     * cambio en un documento que alguien va a firmar. Se cae a la de la
     * empresa, que al menos es una decisión declarada.
     */
    expect(monedaDe([{ currency: "usd" }, { currency: "dop" }], "usd")).toBe("usd");
  });

  it("sin filas, la de la empresa", () => {
    expect(monedaDe([], "dop")).toBe("dop");
  });
});

describe("el texto de una celda", () => {
  it("el dinero sale con su símbolo y dos decimales", () => {
    expect(textoCelda({ total: 1250.5 }, { clave: "total", titulo: "Total", tipo: "dinero" }, "dop"))
      .toBe("RD$1,250.50");
  });

  it("un estado se traduce; NUNCA sale la clave cruda", () => {
    /**
     * Ésta es la guarda del documento impreso. Una hoja que dice
     * `partially_paid` obliga a quien la lee a traducirla mentalmente, y eso ya
     * no es un reporte. El peor caso es que se note cuando está firmada.
     */
    const col = { clave: "status", titulo: "Estado", tipo: "etiqueta" as const };
    const texto = textoCelda({ status: "partially_paid" }, col, "usd");
    expect(texto).not.toContain("_");
    expect(texto.toLowerCase()).not.toBe("partially_paid");
  });

  it("un estado que nadie ha traducido se humaniza en vez de salir con guiones", () => {
    const col = { clave: "status", titulo: "Estado", tipo: "etiqueta" as const };
    expect(textoCelda({ status: "algo_muy_raro" }, col, "usd")).toBe("algo muy raro");
  });

  it("un número entero no arrastra decimales, y uno con decimales los conserva", () => {
    const col = { clave: "horas", titulo: "Horas", tipo: "numero" as const };
    expect(textoCelda({ horas: 8 }, col, "usd")).toBe("8");
    expect(textoCelda({ horas: 7.5 }, col, "usd")).toBe("7.50");
  });

  it("un vacío sale como raya, no como «null» ni como cero", () => {
    // Un cero en una celda vacía es MENTIRA: dice que se midió y dio cero.
    const col = { clave: "amount", titulo: "Importe", tipo: "dinero" as const };
    for (const v of [null, undefined, ""]) {
      expect(textoCelda({ amount: v }, col, "usd")).toBe("—");
    }
  });

  it("una relación expandida imprime su nombre, no [object Object]", () => {
    const col = { clave: "customer", titulo: "Cliente", desde: "name" };
    expect(textoCelda({ customer: { name: "Ana Pérez" } }, col, "usd")).toBe("Ana Pérez");
  });

  it("dinero y números se alinean a la derecha; el resto no", () => {
    expect(esNumerica({ clave: "a", titulo: "A", tipo: "dinero" })).toBe(true);
    expect(esNumerica({ clave: "b", titulo: "B", tipo: "numero" })).toBe(true);
    expect(esNumerica({ clave: "c", titulo: "C", tipo: "etiqueta" })).toBe(false);
    expect(esNumerica({ clave: "d", titulo: "D" })).toBe(false);
  });
});

describe("las columnas de estado están declaradas como etiqueta", () => {
  it("ninguna columna de enum se quedó como texto crudo", () => {
    /**
     * Sin esto, añadir un reporte nuevo con una columna `status` sin `tipo`
     * vuelve a imprimir la clave cruda, y el defecto reaparece reporte a
     * reporte. La lista es la de campos que en este sistema SIEMPRE son enum.
     */
    const ENUMS = new Set([
      "status", "channel", "severity", "priority", "method", "payment_method",
      "payment_type", "movement_type", "source", "quote_type", "cost_type",
      "ticket_type", "incident_type", "order_type", "beneficiary_type",
    ]);
    const crudas: string[] = [];
    for (const r of REPORTES) {
      for (const c of r.columnas) {
        if (ENUMS.has(c.clave) && c.tipo !== "etiqueta") crudas.push(`${r.slug} → ${c.clave}`);
      }
    }
    expect(crudas, "columnas de enum que imprimirían la clave cruda").toEqual([]);
  });
});

describe("las pantallas piden los listados con los nombres que la ruta lee", () => {
  it("ninguna pantalla manda `_limit`, `_sort` ni `_offset` en la URL", async () => {
    /**
     * ESTA GUARDA NACE DE UN FALLO REAL.
     *
     * La bitácora pedía `_limit=200&_sort=occurred_at:desc`. La ruta
     * `/api/erp/:recurso` lee `limit` y `sort` —sin guion bajo—, así que los
     * ignoraba EN SILENCIO: el reporte salía con 50 eventos, en el orden por
     * defecto, con pinta de estar completo. El guion bajo es la forma interna
     * de `tenantQuery`, no la de la URL, y confundirlas no da ningún error.
     *
     * Solo se miran las pantallas (cliente). En el servidor `_limit` es
     * correcto: ahí se le habla directo a `tenantQuery`.
     */
    const { readFileSync } = await import("node:fs");
    const { execSync } = await import("node:child_process");
    const archivos = execSync(
      "grep -rl 'new URLSearchParams' src/app/dashboard src/components --include=*.tsx || true",
      { encoding: "utf8" },
    ).split("\n").filter(Boolean);

    const culpables: string[] = [];
    for (const archivo of archivos) {
      const fuente = readFileSync(archivo, "utf8");
      // Solo dentro de un literal `new URLSearchParams({ ... })`.
      for (const m of fuente.matchAll(/new URLSearchParams\(\{([\s\S]*?)\}\)/g)) {
        for (const clave of m[1].matchAll(/(^|[\s,{])(_[A-Za-z]\w*)\s*:/g)) {
          culpables.push(`${archivo} → ${clave[2]}`);
        }
      }
      // Y en los `qs.set("_x", …)` que se añaden sueltos.
      for (const m of fuente.matchAll(/\.set\(\s*["'](_[A-Za-z]\w*)["']/g)) {
        culpables.push(`${archivo} → ${m[1]}`);
      }
    }
    expect(culpables, "parámetros que la ruta del ERP ignora en silencio").toEqual([]);
  });
});

describe("todo reporte del registro se puede abrir", () => {
  it("existe la pantalla genérica que los pinta", async () => {
    // Sin ella, el registro sería una lista de reportes que no existen.
    const { existsSync } = await import("node:fs");
    expect(existsSync("src/app/dashboard/reportes/[slug]/page.tsx")).toBe(true);
  });

  it("el índice se construye desde el registro, no a mano", async () => {
    /**
     * Un reporte al que no se llega es un reporte que no existe: nadie va a
     * adivinar la URL. Y si el índice los enumerase a mano, el que se añada al
     * registro mañana no aparecería, sin que nada fallara.
     */
    const { readFileSync } = await import("node:fs");
    const indice = readFileSync("src/app/dashboard/analitica/reportes/page.tsx", "utf8");
    expect(indice).toContain("gruposDeReportes()");
    expect(indice).toContain("/dashboard/reportes/${r.slug}");
  });
});

describe("el cuadre de un libro", () => {
  const diario = REPORTES.find((r) => r.slug === "libro-diario")!;

  it("un libro cuadrado lo dice", () => {
    const filas = [{ debit: 100, credit: 0 }, { debit: 0, credit: 100 }];
    expect(cuadreDe(filas, diario)).toMatchObject({ debe: 100, haber: 100, cuadra: true });
  });

  it("un descuadre real se señala con su diferencia", () => {
    /**
     * Es lo más importante que una hoja de libro diario puede decir. Dejarlo a
     * que alguien reste de cabeza dos totales impresos es no decirlo.
     */
    const filas = [{ debit: 100, credit: 0 }, { debit: 0, credit: 85 }];
    const c = cuadreDe(filas, diario)!;
    expect(c.cuadra).toBe(false);
    expect(c.diferencia).toBe(15);
  });

  it("un residuo de redondeo de un centavo NO es un descuadre", () => {
    // Los importes son numeric(14,2): sumar doscientas líneas deja residuos que
    // no son un descuadre. Gritar por un centavo entrena a ignorar el aviso.
    const filas = [{ debit: 100, credit: 0 }, { debit: 0, credit: 99.99 }];
    expect(cuadreDe(filas, diario)!.cuadra).toBe(true);
    expect(TOLERANCIA_CUADRE).toBe(0.01);
  });

  it("dos centavos SÍ lo son", () => {
    const filas = [{ debit: 100, credit: 0 }, { debit: 0, credit: 99.98 }];
    expect(cuadreDe(filas, diario)!.cuadra).toBe(false);
  });

  it("un reporte sin cuadre declarado no inventa uno", () => {
    expect(cuadreDe([{ total: 5 }], reportePorSlug("ventas")!)).toBeNull();
  });

  it("las dos columnas del cuadre se enseñan y se suman", () => {
    /**
     * Si el debe y el haber no salieran en el pie, el lector vería el veredicto
     * («descuadra en 15») sin los sumandos con los que comprobarlo.
     */
    const problemas: string[] = [];
    for (const r of REPORTES) {
      if (!r.cuadre) continue;
      const columnas = new Set(r.columnas.map((c) => c.clave));
      const totales = new Set(r.totales ?? []);
      for (const clave of [r.cuadre.debe, r.cuadre.haber]) {
        if (!columnas.has(clave)) problemas.push(`${r.slug}: ${clave} no se enseña`);
        if (!totales.has(clave)) problemas.push(`${r.slug}: ${clave} no se totaliza`);
      }
      expect(r.cuadre.etiqueta.length, r.slug).toBeGreaterThan(3);
    }
    expect(problemas, "cuadres sin sus sumandos a la vista").toEqual([]);
  });
});

describe("toda hoja de reportes se puede archivar", () => {
  it("cada pantalla de /dashboard/reportes lleva encabezado impreso y se puede imprimir", async () => {
    /**
     * UNA HOJA SIN ENCABEZADO NO SE PUEDE ARCHIVAR.
     *
     * Dentro de seis meses alguien la encuentra en una carpeta y no sabe de qué
     * empresa es, de qué documento ni de qué período. Es exactamente lo que
     * `hoja-impresa.tsx` viene a resolver, y la única forma de que siga
     * resuelto es que una pantalla nueva no pueda saltárselo.
     *
     * Se aceptan las dos vías: las piezas compartidas directamente, o
     * `ReportShell`, que ya las usa.
     */
    const { readFileSync, readdirSync, existsSync } = await import("node:fs");
    const raiz = "src/app/dashboard/reportes";

    const paginas: string[] = [];
    for (const entrada of readdirSync(raiz, { withFileTypes: true })) {
      if (!entrada.isDirectory()) continue;
      const pagina = `${raiz}/${entrada.name}/page.tsx`;
      if (existsSync(pagina)) paginas.push(pagina);
    }
    expect(paginas.length, "no se encontró ninguna pantalla de reportes").toBeGreaterThan(3);

    const mudas: string[] = [];
    const sinImprimir: string[] = [];
    for (const pagina of paginas) {
      const fuente = readFileSync(pagina, "utf8");
      // Se busca el USO en el JSX, no el import: quitar la etiqueta y dejar el
      // import es exactamente cómo se rompe esto sin querer, y con `includes`
      // a secas la guarda no se enteraba.
      const conMarco = /<ReportShell[\s>]/.test(fuente);
      if (!conMarco && !/<EncabezadoImpreso[\s/>]/.test(fuente)) mudas.push(pagina);
      if (!conMarco && !/<CabeceraDocumento[\s/>]/.test(fuente) && !fuente.includes("window.print()")) {
        sinImprimir.push(pagina);
      }
    }
    expect(mudas, "hojas que saldrían sin empresa, documento ni período").toEqual([]);
    expect(sinImprimir, "reportes sin forma de imprimirse").toEqual([]);
  });

  it("el encabezado impreso se escribe en UN solo sitio", async () => {
    /**
     * Antes había dos copias del mismo encabezado y venían tres más. Cinco
     * copias es garantía de que a los seis meses tres digan la empresa y dos
     * no, y de que el día que haya que añadir el RNC solo se añada en una.
     *
     * Lo que se comprueba: ninguna pantalla escribe su propio bloque impreso
     * con el nombre de la empresa dentro. Quien lo necesite, que use la pieza.
     */
    const { readFileSync } = await import("node:fs");
    const { execSync } = await import("node:child_process");
    const archivos = execSync(
      "grep -rl 'print-only' src/app src/components --include=*.tsx || true",
      { encoding: "utf8" },
    ).split("\n").filter(Boolean);

    const copias = archivos.filter((archivo) => {
      if (archivo.endsWith("hoja-impresa.tsx")) return false;
      const fuente = readFileSync(archivo, "utf8");
      // Un bloque `print-only` que además nombra a la empresa es un encabezado
      // o un pie propios: justo lo que no puede haber por duplicado.
      return fuente.includes("print-only") && /companyName/.test(fuente);
    });
    expect(copias, "encabezados o pies impresos escritos por su cuenta").toEqual([]);
  });
});
