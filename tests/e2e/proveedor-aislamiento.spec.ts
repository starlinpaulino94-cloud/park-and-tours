import { expect, test, type Page } from "@playwright/test";
import { login } from "./login";
import {
  E2E_SUPPLIER_SUFFIX, emailDerivado,
  CLIENTE_DEL_MANIFIESTO, TELEFONO_DEL_CLIENTE, HABITACION_DEL_CLIENTE,
  LIQUIDACION_PROPIA, LIQUIDACION_AJENA,
} from "./global-setup";

/**
 * EL AISLAMIENTO DEL PROVEEDOR, CON UN NAVEGADOR DE VERDAD.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ES EL ACTOR CON MÁS DATOS PERSONALES DE TERCEROS A TIRO
 *
 * Lo dice el propio plan. Un manifiesto es una lista de clientes con su hotel, su
 * habitación, su teléfono y lo que deben; una hoja de ruta, lo mismo parada por
 * parada. Las fases 8.1-8.9 cerraron esas puertas una por una, y **cada
 * afirmación de este fichero corresponde a una de ellas**:
 *
 *   · el panel interno lo desvía a su portal            → 9.1 (lo cerró esta ola)
 *   · el manifiesto es de uso interno                   → 8.8
 *   · el PDF del manifiesto, también                    → 8.8
 *   · la mesa de despacho exige ser de dentro y rango   → 8.5
 *   · su lista de servicios no lleva datos del cliente  → 8.3 + 0085
 *   · solo ve SU flota, y sin la tarifa diaria          → 8.9
 *   · solo ve SU liquidación                            → 8.7
 *   · el libro de cuentas por pagar le está negado      → 8.7 (exclusión deliberada)
 *
 * Todo eso está probado regla a regla en pruebas unitarias. Lo que NINGUNA
 * comprueba es la cadena entera: membresía → `supplier.user_id` → el enganche
 * pone `supplier_id` en el token → `auth-context` lo revalida contra la ficha →
 * `esDeProveedor` acota. Si el enganche dejara de acotar la ficha a la empresa de
 * la membresía, o si `supplierSigueActivo` dejara de fallar cerrado, todas las
 * unitarias seguirían verdes.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ LAS NEGATIVAS SE PIDEN CON UN IDENTIFICADOR INVENTADO
 *
 * En el manifiesto y en el despacho la guarda corre ANTES de buscar la fila. Con
 * un uuid que no existe, la respuesta correcta sigue siendo 403 —«esto es de uso
 * interno»— y NO 404: si alguien quitara la guarda, la ruta pasaría a buscar y
 * contestaría 404 o 500. O sea que el 403 sobre un identificador inventado prueba
 * algo más fuerte que el 403 sobre uno real: prueba que no llega ni a mirar.
 */

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.skip(!email || !password, "Define E2E_EMAIL y E2E_PASSWORD para ejecutar el aislamiento del proveedor.");

/** Bien formado y de nadie: un uuid inválido daría 400 por otro motivo. */
const UUID_INVENTADO = "00000000-0000-4000-8000-000000000000";

const entrar = (page: Page) =>
  login(page, {
    email: emailDerivado(email!, E2E_SUPPLIER_SUFFIX),
    password: password!,
    expectPath: "/proveedor",
  });

/** Pide una ruta con la sesión del navegador y devuelve estado y cuerpo crudo. */
async function pedir(page: Page, url: string): Promise<{ status: number; texto: string }> {
  return page.evaluate(async (u) => {
    const res = await fetch(u, { credentials: "include" });
    return { status: res.status, texto: await res.text().catch(() => "") };
  }, url);
}

test.describe("un proveedor solo ve lo suyo", () => {
  test.setTimeout(120_000);

  test("aterriza en su portal, y el ERP interno lo devuelve a él", async ({ page }) => {
    /**
     * Su ficha está vinculada: si no lo estuviera, el token saldría sin
     * `supplier_id`, el layout del portal lo mandaría a `/dashboard` y el login
     * fallaría con `expectPath`. Esta prueba distingue las dos cosas.
     */
    await entrar(page);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/proveedor/, { timeout: 30_000 });
  });

  test("EL MANIFIESTO ES DE USO INTERNO, y la negativa llega antes de buscar", async ({ page }) => {
    await entrar(page);
    for (const ruta of [
      `/api/departures/${UUID_INVENTADO}/manifest`,
      `/api/departures/${UUID_INVENTADO}/manifest/pdf`,
    ]) {
      const res = await pedir(page, ruta);
      expect(res.status, ruta).toBe(403);
    }
  });

  test("y la mesa de despacho tampoco es suya", async ({ page }) => {
    // Hasta 8.5 estas tres rutas solo exigían sesión, y `loadRunSheet` devolvía
    // nombres, habitaciones y teléfonos de CUALQUIER ruta a cualquiera.
    await entrar(page);
    for (const ruta of [
      "/api/operations/dispatch",
      `/api/operations/routes/${UUID_INVENTADO}/run-sheet`,
    ]) {
      const res = await pedir(page, ruta);
      expect(res.status, ruta).toBe(403);
    }
  });

  test("SU LISTA DE SERVICIOS NO LLEVA NI UN DATO DEL CLIENTE", async ({ page }) => {
    /**
     * La afirmación central de toda la fase. Se busca sobre el cuerpo CRUDO y no
     * sobre la pantalla: lo que importa es que el servidor no lo entregue, no que
     * la pantalla no lo pinte.
     */
    await entrar(page);
    const res = await pedir(page, "/api/proveedor/servicios?ventana=proximos");
    expect(res.status).toBe(200);

    for (const dato of [CLIENTE_DEL_MANIFIESTO, TELEFONO_DEL_CLIENTE, HABITACION_DEL_CLIENTE]) {
      expect(res.texto, `se entregó «${dato}»`).not.toContain(dato);
    }

    // Y sí trae lo suyo: el servicio que opera él, y solo ese. El del proveedor
    // de enfrente está sembrado sobre la MISMA salida con el papel de guía.
    const cuerpo = JSON.parse(res.texto);
    const servicios = (cuerpo?.data?.servicios ?? []) as { detalle?: string }[];
    expect(servicios).toHaveLength(1);
    expect(servicios[0].detalle).toBe("vehicle");
  });

  test("y pidiendo el de otro proveedor por parámetro no cambia nada", async ({ page }) => {
    /**
     * La ruta se acota por la FICHA, no por el parámetro. Atender un
     * `?supplier_id=` la habría convertido en la forma de leer los servicios del
     * transportista de enfrente, con sus puntos de recogida dentro.
     */
    await entrar(page);
    const res = await pedir(page, `/api/proveedor/servicios?supplier_id=${UUID_INVENTADO}`);
    expect(res.status).toBe(200);
    const servicios = (JSON.parse(res.texto)?.data?.servicios ?? []) as { detalle?: string }[];
    expect(servicios).toHaveLength(1);
    expect(servicios[0].detalle).toBe("vehicle");
  });

  test("solo ve SU liquidación, no la del vecino", async ({ page }) => {
    await entrar(page);
    const res = await pedir(page, "/api/erp/settlement?limit=200");
    expect(res.status).toBe(200);
    const codigos = (JSON.parse(res.texto)?.data ?? []).map((s: { code?: string }) => s.code);
    expect(codigos).toContain(LIQUIDACION_PROPIA);
    expect(codigos).not.toContain(LIQUIDACION_AJENA);
  });

  test("solo ve SU flota, y sin la tarifa diaria", async ({ page }) => {
    /**
     * `vehicle` entró en su ámbito en 8.9 para que pudiera elegir qué manda. El
     * filtro decide qué filas; la lista blanca, qué columnas — y esa segunda mitad
     * importa porque la tarifa diaria de una guagua va al lado de la matrícula.
     */
    await entrar(page);
    const res = await pedir(page, "/api/erp/vehicle?limit=50");
    expect(res.status).toBe(200);
    expect(res.texto).not.toContain("daily_rate");
  });

  test("y lo que no es suyo le está NEGADO, no vacío", async ({ page }) => {
    /**
     * Denegado y no «lista vacía»: una lista vacía es indistinguible de «no hay
     * nada», y el día que el filtro se rompiera nadie lo notaría. `payable` está
     * fuera a propósito —es el libro de la operadora— y `customer` también.
     */
    await entrar(page);
    for (const recurso of ["payable", "customer", "payment", "commission"]) {
      const res = await pedir(page, `/api/erp/${recurso}?limit=5`);
      expect(res.status, recurso).toBeGreaterThanOrEqual(400);
    }
  });
});
