import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ACCENTED, PLAIN, normalizeSearch, searchTerms, MAX_TERMS, MIN_TERM_LENGTH,
  escapeLike, normalizedFilter, fallbackFilter, searchFilterFor,
  NORMALIZED_TABLES, NORMALIZED_COLUMN,
} from "@/lib/search";

/**
 * Una búsqueda que no encuentra lo que existe no parece un fallo: parece que no
 * está. Y entonces alguien crea la ficha otra vez, y ya hay dos.
 *
 * Por eso lo que más se prueba aquí es que los dos lados de la normalización
 * —el de TypeScript y el de la base— digan exactamente lo mismo. Si se
 * separan, la búsqueda deja de encontrar en silencio.
 */

describe("normalizar", () => {
  it("quita acentos y baja a minúsculas", () => {
    expect(normalizeSearch("José Pérez")).toBe("jose perez");
    expect(normalizeSearch("MÜLLER")).toBe("muller");
    expect(normalizeSearch("Gonçalves")).toBe("goncalves");
    expect(normalizeSearch("Núñez")).toBe("nunez");
  });

  it("lo que no es texto no rompe la búsqueda", () => {
    expect(normalizeSearch(null)).toBe("");
    expect(normalizeSearch(undefined)).toBe("");
    expect(normalizeSearch(42)).toBe("");
  });

  it("las dos tablas de caracteres tienen la misma longitud", () => {
    // Una letra de más en un lado desplazaría TODAS las siguientes: la «ñ»
    // pasaría a ser otra cosa, y nadie lo vería hasta que un Núñez no aparece.
    expect(ACCENTED.length).toBe(PLAIN.length);
  });
});

describe("las palabras", () => {
  it("el orden deja de importar porque se exigen TODAS", () => {
    expect(searchTerms("pérez josé")).toEqual(["perez", "jose"]);
  });

  it("una letra suelta no es una búsqueda", () => {
    // «j p» buscando a José Pérez traería media agenda, y quien escribe una
    // inicial suelta no está buscando: está tecleando.
    expect(MIN_TERM_LENGTH).toBe(2);
    expect(searchTerms("j perez")).toEqual(["perez"]);
  });

  it("los espacios de más no crean palabras vacías", () => {
    expect(searchTerms("  jose   perez  ")).toEqual(["jose", "perez"]);
  });

  it("se topan, porque cada palabra es una condición más contra la base", () => {
    expect(MAX_TERMS).toBe(6);
    expect(searchTerms("uno dos tres cuatro cinco seis siete ocho")).toHaveLength(6);
  });

  it("sin nada que buscar, ninguna palabra", () => {
    expect(searchTerms("")).toEqual([]);
    expect(searchTerms("   ")).toEqual([]);
    expect(searchTerms(null)).toEqual([]);
  });
});

describe("los comodines", () => {
  it("un «%» escrito por una persona es un porcentaje, no «lo que sea»", () => {
    // Sin escaparlo, buscar «%» devolvía la tabla entera.
    expect(escapeLike("50%")).toBe("50\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("c:\\ruta")).toBe("c:\\\\ruta");
  });

  it("un punto NO se escapa: en un LIKE no significa nada", () => {
    // El código anterior escapaba los metacaracteres de expresión regular —que
    // aquí no sirven de nada— y dejaba sin escapar los dos que SÍ son comodines.
    expect(escapeLike("juan.perez@correo.com")).toBe("juan.perez@correo.com");
  });
});

describe("el filtro", () => {
  it("una tabla con columna normalizada busca contra ella, palabra por palabra", () => {
    const filtro = searchFilterFor("customer", ["first_name"], "Pérez José");
    expect(filtro).toEqual({
      _and: [
        { search_text: { regex: "perez" } },
        { search_text: { regex: "jose" } },
      ],
    });
  });

  it("y no con varias claves del mismo nombre, que se pisarían", () => {
    // Un objeto solo puede tener una `search_text`: dos palabras se perderían
    // quedándose con la última, y la búsqueda encontraría de más.
    const filtro = normalizedFilter(NORMALIZED_COLUMN, "ana maria") as Record<string, unknown>;
    expect(Object.keys(filtro)).toEqual(["_and"]);
    expect((filtro._and as unknown[])).toHaveLength(2);
  });

  it("una tabla sin columna normalizada busca campo por campo, como siempre", () => {
    const filtro = searchFilterFor("invoice", ["number", "notes"], "A010");
    expect(filtro).toEqual({
      _or: [{ number: { regex: "A010" } }, { notes: { regex: "A010" } }],
    });
  });

  it("sin nada que buscar no se devuelve un filtro que no filtra", () => {
    // Un filtro vacío es peor que ninguno, porque parece que sí.
    expect(searchFilterFor("customer", ["first_name"], "")).toBeNull();
    expect(searchFilterFor("customer", ["first_name"], "  ")).toBeNull();
    expect(fallbackFilter([], "algo")).toBeNull();
    expect(normalizedFilter("search_text", "j")).toBeNull();
  });

  it("las tablas normalizadas son las que tienen la columna, y ninguna más", () => {
    expect([...NORMALIZED_TABLES].sort()).toEqual(["customer", "product", "seller", "supplier"]);
  });
});

describe("los dos lados dicen lo mismo", () => {
  /**
   * La prueba que de verdad importa.
   *
   * La columna la calcula Postgres con `app.search_normalize`; lo que el usuario
   * escribe lo normaliza TypeScript. Si las dos tablas de caracteres se
   * separan, la búsqueda deja de encontrar lo que hay guardado — y no da error:
   * devuelve cero resultados, que es exactamente lo que parece «no existe».
   */
  const migration = readFileSync(
    path.resolve(__dirname, "../../supabase/migrations/0062_accent_insensitive_search.sql"),
    "utf8"
  );

  it("la tabla de acentos de la base es la misma que la de TypeScript", () => {
    const [, acentuadas, llanas] = /translate\(\s*coalesce\(txt, ''\),\s*'([^']+)',\s*'([^']+)'/.exec(migration) ?? [];
    expect(acentuadas, "no se pudo leer la tabla de la migración").toBeTruthy();
    expect(acentuadas).toBe(ACCENTED);
    expect(llanas).toBe(PLAIN);
  });

  it("la función de la base es IMMUTABLE, o la columna generada no existiría", () => {
    // Una columna generada solo admite expresiones inmutables. Con `STABLE`,
    // Postgres rechaza la migración entera — y por eso no se usa `unaccent()`.
    expect(migration).toMatch(/create or replace function app\.search_normalize[\s\S]*?\nimmutable\n/);
  });

  it("cada tabla normalizada tiene su columna y su índice de trigramas", () => {
    // Sin el índice GIN, la columna acierta pero cada búsqueda lee la tabla
    // entera: funciona con dos mil clientes y no con veinte mil.
    for (const table of NORMALIZED_TABLES) {
      expect(migration, `${table} sin columna generada`).toMatch(
        new RegExp(`alter table ${table}\\s+add column if not exists ${NORMALIZED_COLUMN}[\\s\\S]*?\\) stored;`)
      );
      expect(migration, `${table} sin índice de trigramas`).toMatch(
        new RegExp(`on ${table} using gin \\(${NORMALIZED_COLUMN} gin_trgm_ops\\)`)
      );
    }
  });
});
