import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { SELLER_SCOPED } from "@/lib/seller-scope";

/**
 * EL INVENTARIO DE RUTAS, CONVERTIDO EN GUARDA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DE DÓNDE SALE ESTA PRUEBA
 *
 * El ámbito del vendedor se aplica en `buildListFilter`, que comparten el
 * listado genérico y su exportación. Pero hay rutas que NO pasan por ahí: arman
 * su propio filtro contra `tenantQuery`. `/api/orders` y `/api/quotes` eran dos
 * —y son justo las que leen las pantallas de ventas—, así que cerrar solo el
 * CRUD genérico habría sido cosmético.
 *
 * Se cerraron a mano. El problema es que «a mano» no se sostiene: la siguiente
 * ruta que consulte una tabla con dimensión de vendedor nacerá sin ámbito y
 * nadie lo notará, porque un filtro que falta no da error — devuelve la empresa
 * entera.
 *
 * Esta prueba recorre TODAS las rutas de la API y exige que cada una que toque
 * una tabla con dimensión de vendedor esté en uno de estos tres casos:
 *
 *   a) pide un rango POR ENCIMA de vendedor, así que un vendedor no la alcanza;
 *   b) aplica el ámbito (`sellerFilterFor`, `assertSellerOwnsRow`, …);
 *   c) está en la lista de EXCEPCIONES de abajo, con su motivo escrito.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTA PRUEBA NO PUEDE VER
 *
 * Lee el código fuente, no lo ejecuta. Toma el rango MÍNIMO que aparece en el
 * fichero, así que una ruta con dos manejadores de rango distinto se clasifica
 * por el más bajo —conservador, que es el lado correcto del error—. Y una
 * guarda condicional (la del portal) no la entiende: por eso existe la lista de
 * excepciones y por eso cada entrada lleva su razón.
 */

const ROOT = path.resolve(__dirname, "../..");
const API = path.join(ROOT, "src/app/api");

const RANGO: Record<string, number> = {
  superadmin: 100, owner: 90, admin: 80, manager: 60, operations: 40, cashier: 40, seller: 20, partner: 10,
};
const RANGO_VENDEDOR = RANGO.seller;

/** Rutas que tocan estas tablas y NO se acotan, cada una con su motivo. */
const EXCEPCIONES: Record<string, string> = {
  "payments/route.ts":
    "Cobrar es OPERATIVO: el cliente llega al mostrador a pagar una venta que " +
    "pudo hacer cualquiera del equipo, y exigir que sea del vendedor que atiende " +
    "dejaría a ese cliente sin poder pagar. Residuo consciente: la respuesta " +
    "devuelve la orden actualizada, así que quien cobre una venta ajena la ve. " +
    "Se prefiere a romper el cobro.",
  "portal/summary/route.ts":
    "Acotada por SOCIO, no por vendedor: filtra por `partnerId` y sin socio " +
    "responde 403, así que un vendedor no saca nada de ella. Su rango aparece " +
    "como `manager` solo en la rama de «ver el de otro socio».",
};

function rutas(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) rutas(full, out);
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

const TABLAS = Object.keys(SELLER_SCOPED);
const CONSULTA = new RegExp(
  `(tenantQuery|tenantCount|tenantFindOne)\\s*(<[^>]*>)?\\s*\\(\\s*[A-Za-z_.]+\\s*,\\s*"(${TABLAS.join("|")})"`,
  "g"
);
const APLICA_AMBITO =
  /sellerFilterFor|assertSellerOwnsRow|sellerCanReadRow|ventaSelladaPorVendedor|assertGerenciaOVendedorDe/;

function rangoMinimo(src: string): number {
  const encontrados = [...src.matchAll(/requireAtLeast\([A-Za-z_.]+, "([a-z]+)"\)/g)]
    .map((m) => RANGO[m[1]] ?? 0);
  // Sin ninguna comprobación de rango, cualquiera con sesión entra.
  return encontrados.length ? Math.min(...encontrados) : 0;
}

describe("toda ruta que toque una tabla con dimensión de vendedor está resuelta", () => {
  const ficheros = rutas(API);

  it("el barrido encuentra rutas de verdad", () => {
    // Una prueba que no mira nada pasa siempre.
    expect(ficheros.length).toBeGreaterThan(100);
  });

  it("ninguna queda sin rango, sin ámbito y sin motivo", () => {
    const sinResolver: string[] = [];

    for (const file of ficheros) {
      const src = readFileSync(file, "utf8");
      const tablas = [...src.matchAll(CONSULTA)].map((m) => m[3]);
      if (tablas.length === 0) continue;

      const rel = path.relative(API, file);
      if (EXCEPCIONES[rel]) continue;            // c) motivo escrito
      if (rangoMinimo(src) > RANGO_VENDEDOR) continue;  // a) fuera de su alcance
      if (APLICA_AMBITO.test(src)) continue;     // b) acotada

      sinResolver.push(`${rel} → ${[...new Set(tablas)].join(", ")}`);
    }

    expect(
      sinResolver,
      "Estas rutas leen datos con vendedor, las alcanza un vendedor y no las acota " +
      "nadie. Acótalas, súbeles el rango, o añádelas a EXCEPCIONES con su motivo."
    ).toEqual([]);
  });

  it("cada excepción sigue existiendo y sigue tocando esas tablas", () => {
    // Una excepción que sobrevive a la ruta que excusaba es una puerta abierta
    // con permiso escrito: deja de proteger y nadie la revisa.
    for (const [rel, motivo] of Object.entries(EXCEPCIONES)) {
      const file = path.join(API, rel);
      let src = "";
      expect(() => { src = readFileSync(file, "utf8"); }, `${rel} ya no existe`).not.toThrow();
      expect([...src.matchAll(CONSULTA)].length, `${rel} ya no consulta esas tablas`).toBeGreaterThan(0);
      expect(motivo.length, `${rel} sin motivo escrito`).toBeGreaterThan(80);
    }
  });
});
