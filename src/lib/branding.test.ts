import { describe, it, expect } from "vitest";
import {
  normalizeColor, brandColor, toRgb, luminance, contrastRatio, readableOn,
  hasReadableContrast, logoProblem, LOGO_PROBLEM_MESSAGE, embeddableLogo,
  imageKindOf, documentBrand, brandingGaps, brandingDeSocio,
  DEFAULT_BRAND_COLOR, MIN_CONTRAST,
} from "@/lib/branding";

/**
 * Un documento con la marca mal puesta falla de dos maneras, y las dos son
 * visibles para el cliente: o no se abre —un color inválido convertido a NaN—,
 * o se abre y no se lee —texto blanco sobre amarillo—. Lo que se prueba aquí
 * son esas dos, más el logo que el formato PDF no sabe incrustar.
 */

describe("el color se valida antes de usarse", () => {
  it("acepta la forma larga, con y sin almohadilla", () => {
    expect(normalizeColor("#1A2B3C")).toBe("#1a2b3c");
    expect(normalizeColor("1a2b3c")).toBe("#1a2b3c");
  });

  it("acepta la forma corta, que es la que la gente copia de su guía de marca", () => {
    expect(normalizeColor("#abc")).toBe("#aabbcc");
  });

  it("rechaza lo que no es un color", () => {
    for (const malo of ["#gggggg", "rojo", "", "#12345", "#1234567", null, 42, undefined]) {
      expect(normalizeColor(malo), String(malo)).toBeNull();
    }
  });

  it("sin color válido se usa el de casa, nunca algo que no se pueda pintar", () => {
    expect(brandColor("rojo")).toBe(DEFAULT_BRAND_COLOR);
    expect(brandColor(null)).toBe(DEFAULT_BRAND_COLOR);
    expect(brandColor("#abc")).toBe("#aabbcc");
  });

  it("la conversión a RGB nunca devuelve NaN: un PDF con NaN no se abre", () => {
    for (const entrada of ["#ffffff", "rojo", "", "#abc"]) {
      const { r, g, b } = toRgb(entrada);
      expect([r, g, b].every(Number.isFinite), entrada).toBe(true);
      expect(r >= 0 && r <= 1 && g >= 0 && g <= 1 && b >= 0 && b <= 1).toBe(true);
    }
  });

  it("blanco y negro dan los extremos", () => {
    expect(toRgb("#ffffff")).toEqual({ r: 1, g: 1, b: 1 });
    expect(toRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe("el contraste", () => {
  it("usa la luminancia del estándar, no el promedio de los canales", () => {
    // Un verde puro es MUCHO más luminoso que un azul puro con el mismo valor.
    // Con un promedio simple los dos darían 1/3 y saldría el mismo texto.
    expect(luminance("#00ff00")).toBeGreaterThan(luminance("#0000ff") * 5);
  });

  it("blanco sobre negro es el contraste máximo", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
  });

  it("un color consigo mismo no contrasta", () => {
    expect(contrastRatio("#123456", "#123456")).toBe(1);
  });

  it("sobre un amarillo de marca elige texto OSCURO, no blanco", () => {
    // Es el caso que rompe la intuición: el amarillo parece un color «fuerte»
    // y el blanco encima no se lee.
    expect(readableOn("#ffd400")).toBe("#111111");
  });

  it("sobre un azul marino elige texto claro", () => {
    expect(readableOn("#0b1f3a")).toBe("#ffffff");
  });

  it("el color por defecto es legible de verdad", () => {
    expect(hasReadableContrast(DEFAULT_BRAND_COLOR)).toBe(true);
    expect(contrastRatio(DEFAULT_BRAND_COLOR, readableOn(DEFAULT_BRAND_COLOR)))
      .toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it("avisa cuando un color no llega al mínimo NI con blanco NI con oscuro", () => {
    // Hay una franja estrecha de luminancia (~0,175 a ~0,20) donde ninguno de
    // los dos llega a 4,5. Un gris medio corriente SÍ pasa contra el texto
    // oscuro, así que el caso hay que buscarlo donde de verdad está.
    expect(hasReadableContrast("#7a7a7a")).toBe(false);
    expect(contrastRatio("#7a7a7a", "#ffffff")).toBeLessThan(MIN_CONTRAST);
    expect(contrastRatio("#7a7a7a", "#111111")).toBeLessThan(MIN_CONTRAST);
    // Y el gris de al lado sí pasa: la guarda no es «todo gris está mal».
    expect(hasReadableContrast("#808080")).toBe(true);
  });
});

describe("el logo", () => {
  it("un PNG o un JPG están bien", () => {
    expect(logoProblem("https://x.com/logo.png")).toBeNull();
    expect(logoProblem("https://x.com/logo.JPEG")).toBeNull();
    expect(logoProblem("/subidas/logo.jpg")).toBeNull();
  });

  it("un SVG o un WebP se ven en pantalla pero NO en el PDF, y se dice por qué", () => {
    const p = logoProblem("https://x.com/logo.svg")!;
    expect(p).toBe("not_pdf_format");
    expect(LOGO_PROBLEM_MESSAGE[p]).toMatch(/PNG o JPG/);
    expect(logoProblem("https://x.com/logo.webp")).toBe("not_pdf_format");
  });

  it("el tipo declarado manda sobre la extensión", () => {
    expect(logoProblem("https://x.com/logo.png", "image/svg+xml")).toBe("not_pdf_format");
    expect(logoProblem("https://x.com/archivo", "image/png")).toBeNull();
    expect(logoProblem("https://x.com/logo.png", "application/pdf")).toBe("not_image");
  });

  it("una URL sin extensión reconocible se intenta igual: puede ser una ruta firmada", () => {
    expect(logoProblem("https://storage.example/object?token=abc")).toBeNull();
  });

  it("lo que no es una dirección se rechaza", () => {
    expect(logoProblem("javascript:alert(1)")).toBe("not_url");
    expect(logoProblem("logo.png")).toBe("not_url");
  });

  it("sin logo no hay problema: no es obligatorio", () => {
    expect(logoProblem("")).toBeNull();
    expect(logoProblem(null)).toBeNull();
    expect(embeddableLogo(null)).toBeNull();
  });

  it("solo llega al PDF lo que el PDF sabe incrustar", () => {
    expect(embeddableLogo("https://x.com/logo.png")).toBe("https://x.com/logo.png");
    expect(embeddableLogo("https://x.com/logo.svg")).toBeNull();
    expect(embeddableLogo("javascript:alert(1)")).toBeNull();
  });

  it("reconoce el formato para poder incrustarlo", () => {
    expect(imageKindOf("https://x.com/a.png")).toBe("png");
    expect(imageKindOf("https://x.com/a.jpg")).toBe("jpg");
    expect(imageKindOf("https://x.com/a.jpeg?v=2")).toBe("jpg");
    expect(imageKindOf("https://x.com/a", "image/png")).toBe("png");
    expect(imageKindOf("https://x.com/a")).toBeNull();
  });
});

describe("la marca resuelta de un documento", () => {
  const EMPRESA = {
    name: "Caribe Tours", legal_name: "Caribe Tours SRL", tax_id: "131234567",
    phone: "809-555-0101", email: "hola@caribe.do", address: "Av. Duarte 12", city: "Bávaro",
    logo_url: "https://x.com/logo.png", brand_color: "#0b5fff",
    document_footer: "RM 12345 · Autorizada por MITUR",
    voucher_terms: "Presentar este voucher con documento de identidad.",
    invoice_terms: "Régimen ordinario. Pago a 30 días.",
  };

  it("sin nombre comercial usa la razón social", () => {
    expect(documentBrand({ legal_name: "Caribe Tours SRL" }, "voucher").name).toBe("Caribe Tours SRL");
  });

  it("sin ninguno de los dos deja vacío en vez de inventar un nombre", () => {
    // Un «Mi empresa» por defecto acabaría impreso en un voucher de verdad.
    expect(documentBrand(null, "voucher").name).toBe("");
    expect(documentBrand({}, "voucher").name).toBe("");
  });

  it("no repite la razón social cuando es igual al nombre comercial", () => {
    expect(documentBrand({ name: "X", legal_name: "X" }, "voucher").legalName).toBeNull();
    expect(documentBrand(EMPRESA, "voucher").legalName).toBe("Caribe Tours SRL");
  });

  it("la línea de contacto no deja separadores huérfanos", () => {
    const solo = documentBrand({ email: "a@b.c" }, "voucher");
    expect(solo.contact).toBe("a@b.c");
    expect(documentBrand({}, "voucher").contact).toBe("");
  });

  it("el WhatsApp cubre la falta de teléfono", () => {
    expect(documentBrand({ whatsapp: "809-555-0102" }, "voucher").contact).toContain("809-555-0102");
  });

  it("las condiciones dependen del documento", () => {
    // Las del voucher no pintan nada en una factura, ni al revés.
    expect(documentBrand(EMPRESA, "voucher").terms).toMatch(/documento de identidad/);
    expect(documentBrand(EMPRESA, "invoice").terms).toMatch(/Régimen ordinario/);
    expect(documentBrand(EMPRESA, "manifest").terms).toBeNull();
    expect(documentBrand(EMPRESA, "quote").terms).toBeNull();
  });

  it("el pie legal es común a todos", () => {
    for (const kind of ["voucher", "invoice", "manifest", "quote"] as const) {
      expect(documentBrand(EMPRESA, kind).footer, kind).toBe("RM 12345 · Autorizada por MITUR");
    }
  });

  it("el RNC sale etiquetado, no como un número suelto", () => {
    expect(documentBrand(EMPRESA, "invoice").taxLine).toBe("RNC 131234567");
    expect(documentBrand({}, "invoice").taxLine).toBeNull();
  });

  it("el color viene con su texto legible ya decidido", () => {
    const b = documentBrand({ brand_color: "#ffd400" }, "voucher");
    expect(b.color).toBe("#ffd400");
    expect(b.onColor).toBe("#111111");
  });

  it("un color inválido no llega al documento", () => {
    expect(documentBrand({ brand_color: "verde" }, "voucher").color).toBe(DEFAULT_BRAND_COLOR);
  });

  it("un logo que el PDF no sabe incrustar no llega al documento", () => {
    expect(documentBrand({ ...EMPRESA, logo_url: "https://x.com/l.svg" }, "voucher").logo).toBeNull();
  });
});

describe("lo que falta por configurar", () => {
  it("una empresa vacía tiene mucho que decir", () => {
    const gaps = brandingGaps({});
    expect(gaps.length).toBeGreaterThan(4);
    expect(gaps.join(" ")).toMatch(/RNC/);
  });

  it("una empresa completa no tiene avisos", () => {
    expect(brandingGaps({
      name: "X", tax_id: "131234567", phone: "809", address: "Av. 1",
      logo_url: "https://x.com/l.png", document_footer: "RM 1", brand_color: "#0b5fff",
    })).toEqual([]);
  });

  it("avisa del color poco legible sin tratarlo como un error", () => {
    const gaps = brandingGaps({
      name: "X", tax_id: "1", phone: "8", address: "a",
      logo_url: "https://x.com/l.png", document_footer: "f", brand_color: "#7a7a7a",
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatch(/poco legible/);
  });
});

describe("la marca del tour center en el documento que entrega él", () => {
  const operadora = {
    name: "Caribe Tours", legal_name: "Caribe Tours SRL", logo_url: "https://x/op.png",
    document_footer: "RM 12345", voucher_terms: "No reembolsable con 24 h.",
    brand_color: "#123456", phone: "809-000", tax_id: "130000001",
  };
  const socio = {
    commercial_name: "Macao Beach Tours", name: "Macao SRL",
    logo_url: "https://x/socio.png", phone: "809-111", email: "hola@macao.test",
  };

  it("la identidad es del socio", () => {
    /**
     * El turista compró en el mostrador del tour center: no sabe que detrás hay
     * una operadora, y no tiene por qué. Un voucher con el logo de otra empresa
     * le hace dudar de lo que acaba de pagar —o le enseña a quién llamar la
     * próxima vez sin pasar por quien se lo vendió—.
     */
    const marca = brandingDeSocio(socio, operadora)!;
    expect(marca.name).toBe("Macao Beach Tours");
    expect(marca.logo_url).toBe("https://x/socio.png");
    expect(marca.phone).toBe("809-111");
  });

  it("y las condiciones y el pie son de la operadora", () => {
    // Al revés produciría un documento que promete en nombre de quien no puede
    // cumplir: el servicio lo presta ella y la letra pequeña la firma ella.
    const marca = brandingDeSocio(socio, operadora)!;
    expect(marca.voucher_terms).toBe("No reembolsable con 24 h.");
    expect(marca.document_footer).toBe("RM 12345");
  });

  it("el color de marca NO se hereda", () => {
    /**
     * No hay dónde guardarlo en la ficha del socio, y arrastrar el de la
     * operadora pintaría el documento del tour center con los colores de quien
     * no lo firma — que es justo la confusión que esto viene a quitar.
     */
    expect(brandingDeSocio(socio, operadora)!.brand_color).toBeNull();
  });

  it("sin nombre no se sustituye nada", () => {
    // Mejor el documento con la marca de la operadora que sin ninguna.
    expect(brandingDeSocio({ logo_url: "https://x/s.png" }, operadora)).toBeNull();
    expect(brandingDeSocio(null, operadora)).toBeNull();
    expect(brandingDeSocio({ commercial_name: "   " }, operadora)).toBeNull();
  });

  it("el nombre comercial manda sobre el legal", () => {
    // Es el que el turista vio en la puerta del local.
    expect(brandingDeSocio({ name: "Macao SRL", commercial_name: "Macao Beach" }, operadora)!.name)
      .toBe("Macao Beach");
  });
});
