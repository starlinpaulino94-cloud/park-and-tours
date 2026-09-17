import { describe, it, expect } from "vitest";
import {
  SUPPORTED_LOCALES, DEFAULT_LOCALE, isLocale, normalizeLocale,
  parseAcceptLanguage, pickLocale,
  PUBLIC_DICTIONARY, DOC_DICTIONARY, translate, translator, missingKeys,
  formatDateFor, formatTimeFor,
} from "@/lib/i18n";

/**
 * El idioma falla en silencio: nadie se queja de que la web le hable en
 * español, simplemente no reserva. Lo que se prueba aquí son las formas
 * concretas de equivocarse — el `en-US` que se queda en español, la cabecera
 * con pesos que se lee en orden de aparición, y la clave del diccionario
 * enseñada tal cual en una pantalla.
 */

describe("qué idiomas existen", () => {
  it("español e inglés, y el español manda cuando no se sabe", () => {
    expect([...SUPPORTED_LOCALES]).toEqual(["es", "en"]);
    expect(DEFAULT_LOCALE).toBe("es");
  });

  it("cualquier otra cosa no es un idioma", () => {
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(7)).toBe(false);
  });
});

describe("normalizar lo que llega", () => {
  it("en-US, EN y en_GB son todos inglés", () => {
    // Sin normalizar, un navegador estadounidense —que manda en-US— se quedaría
    // en español.
    expect(normalizeLocale("en-US")).toBe("en");
    expect(normalizeLocale("EN")).toBe("en");
    expect(normalizeLocale("en_GB")).toBe("en");
  });

  it("lo que no soportamos se descarta en vez de colarse", () => {
    expect(normalizeLocale("fr-CA")).toBeNull();
    expect(normalizeLocale("")).toBeNull();
    expect(normalizeLocale(null)).toBeNull();
  });
});

describe("leer Accept-Language", () => {
  it("respeta el peso y no el orden de aparición", () => {
    // Un francófono con inglés preferente: el español aparece después pero pesa
    // menos. Leer por orden le hablaría en español.
    expect(parseAcceptLanguage("fr-CA,fr;q=0.9,en;q=0.8,es;q=0.5")).toBe("en");
  });

  it("sin q explícita, el peso es 1", () => {
    expect(parseAcceptLanguage("en,es;q=0.9")).toBe("en");
  });

  it("un idioma con peso cero no se elige", () => {
    expect(parseAcceptLanguage("en;q=0")).toBeNull();
  });

  it("una cabecera sin ningún idioma soportado no decide nada", () => {
    expect(parseAcceptLanguage("fr,de,it")).toBeNull();
    expect(parseAcceptLanguage(null)).toBeNull();
    expect(parseAcceptLanguage("basura")).toBeNull();
  });
});

describe("el orden de autoridad", () => {
  it("lo que el huésped eligió a mano gana siempre", () => {
    // Seguir hablándole en español porque su navegador lo dice sería ignorar lo
    // único que dijo de forma explícita.
    expect(pickLocale({ chosen: "en", acceptLanguage: "es-DO" })).toBe("en");
    expect(pickLocale({ chosen: "es", acceptLanguage: "en-US" })).toBe("es");
  });

  it("después, lo que quedó guardado en su ficha", () => {
    // Los avisos de la víspera salen cuando ya no hay navegador de por medio.
    expect(pickLocale({ stored: "en", acceptLanguage: "es-DO" })).toBe("en");
  });

  it("después, el navegador", () => {
    expect(pickLocale({ acceptLanguage: "en-GB,en;q=0.9" })).toBe("en");
  });

  it("y si nada dice nada, español", () => {
    expect(pickLocale({})).toBe("es");
    expect(pickLocale({ chosen: "fr", stored: "de", acceptLanguage: "it" })).toBe("es");
  });
});

describe("traducir", () => {
  it("da el texto del idioma pedido", () => {
    expect(translate(PUBLIC_DICTIONARY, "en", "engine.submit")).toBe("Request my spot");
    expect(translate(PUBLIC_DICTIONARY, "es", "engine.submit")).toBe("Pedir mi lugar");
  });

  it("NUNCA enseña la clave: sin traducción, el español", () => {
    // Una pantalla que dice `engine.submit` parece rota; el español se entiende
    // con el contexto mucho mejor que eso.
    const parcial = { es: { "a.b": "Hola" }, en: {} };
    expect(translate(parcial, "en", "a.b")).toBe("Hola");
  });

  it("solo devuelve la clave cuando no existe en ningún idioma, que es un fallo del programador", () => {
    expect(translate(PUBLIC_DICTIONARY, "en", "no.existe")).toBe("no.existe");
  });

  it("sustituye las variables", () => {
    expect(translate(PUBLIC_DICTIONARY, "en", "engine.seatsLeft", { seats: 3 })).toBe("3 spots left");
    expect(translate(PUBLIC_DICTIONARY, "es", "engine.seatsLeft", { seats: 3 })).toBe("Quedan 3 plazas");
  });

  it("una variable que no se pasa se deja visible en vez de imprimirse vacía", () => {
    // Un «Quedan  plazas» parece un fallo de datos; «{seats}» delata el fallo
    // real, que es de la llamada.
    expect(translate(PUBLIC_DICTIONARY, "es", "engine.seatsLeft")).toBe("Quedan {seats} plazas");
  });

  it("el traductor atado a un idioma hace lo mismo", () => {
    const t = translator(PUBLIC_DICTIONARY, "en");
    expect(t("engine.date")).toBe("Date");
    expect(t("engine.seatsLeft", { seats: 1 })).toBe("1 spots left");
  });
});

describe("los diccionarios están completos", () => {
  it("al inglés de la página pública no le falta ninguna clave", () => {
    // Una clave que falta no rompe nada —cae al español— y por eso nadie se
    // entera nunca. Un botón en español en medio de una página en inglés.
    expect(missingKeys(PUBLIC_DICTIONARY)).toEqual({});
  });

  it("ni al de los documentos", () => {
    expect(missingKeys(DOC_DICTIONARY)).toEqual({});
  });

  it("y la comprobación detecta de verdad una que falte", () => {
    const roto = { es: { a: "1", b: "2" }, en: { a: "One" } };
    expect(missingKeys(roto)).toEqual({ en: ["b"] });
  });
});

describe("fechas y horas en el idioma del huésped", () => {
  it("la misma fecha se escribe distinto en cada idioma", () => {
    // Un voucher que mezcla formatos se lee dos veces, y en la puerta de un
    // autobús a las siete de la mañana eso importa.
    const es = formatDateFor("es", "2026-11-17T13:00:00Z");
    const en = formatDateFor("en", "2026-11-17T13:00:00Z");
    expect(es).not.toBe(en);
    expect(en).toMatch(/Nov/);
  });

  it("una fecha inválida o vacía no imprime «Invalid Date» en un documento", () => {
    expect(formatDateFor("en", null)).toBe("");
    expect(formatDateFor("en", "ayer")).toBe("");
    expect(formatTimeFor("es", undefined)).toBe("");
  });
});
