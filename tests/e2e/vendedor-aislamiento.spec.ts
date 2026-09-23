import { expect, test } from "@playwright/test";
import { login } from "./login";
import { ORDEN_PROPIA, ORDEN_AJENA, E2E_SELLER_SUFFIX, emailDerivado } from "./global-setup";

/**
 * EL AISLAMIENTO DEL VENDEDOR, CON UN NAVEGADOR DE VERDAD.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ AÑADE ESTO A LO QUE YA HAY
 *
 * Las pruebas de `seller-scope.ts` dicen que la REGLA es correcta. Las de ruta
 * (`erp-ambito-vendedor.test.ts`) dicen que la ruta la LLAMA. Ninguna de las
 * dos pasa por la sesión real: el rol sale de un `mock`, y el vínculo
 * cuenta↔ficha —que es de donde sale todo— no se ejerce nunca.
 *
 * Aquí entra una persona con su contraseña, el enganche de la base le mete el
 * rol en el token, `auth-context` resuelve su ficha consultando
 * `seller.user_id`, y lo que se comprueba es lo que esa persona VE. Es la única
 * prueba de toda la cadena que fallaría si el enganche dejara de inyectar el
 * rol, o si `seller.user_id` dejara de consultarse.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TRES AFIRMACIONES, Y LAS TRES SON «NO»
 *
 *   1. No aterriza en el panel de la empresa, sino en lo suyo.
 *   2. No ve la venta de su compañero, ni siquiera buscándola.
 *   3. No entra a comisiones tecleando la URL —el menú no es la barrera—.
 */

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.skip(!email || !password, "Define E2E_EMAIL y E2E_PASSWORD para ejecutar el aislamiento del vendedor.");

test.describe("un vendedor solo ve lo suyo", () => {
  test.setTimeout(120_000);

  test("aterriza en su apartado, con su venta y sin la de su compañero", async ({ page }) => {
    await login(page, {
      email: emailDerivado(email!, E2E_SELLER_SUFFIX),
      password: password!,
      // El aterrizaje se decide en el SERVIDOR: si esto falla, `/dashboard` ya
      // no desvía al rango más bajo a su apartado.
      expectPath: "/dashboard/mi-espacio",
    });

    await expect(page.getByText("Mi espacio").first()).toBeVisible({ timeout: 30_000 });

    // Su ficha está vinculada: si no lo estuviera, saldría el aviso en vez de
    // las cifras, y esta prueba distingue las dos cosas a propósito.
    await expect(page.getByText("no está vinculada")).toHaveCount(0);

    await page.goto("/dashboard/mi-espacio/ventas");
    await expect(page.getByText(ORDEN_PROPIA)).toBeVisible({ timeout: 30_000 });
    // Lo que de verdad se prueba: la venta del compañero NO aparece.
    await expect(page.getByText(ORDEN_AJENA)).toHaveCount(0);
  });

  test("la API no le da la venta ajena aunque la pida por su nombre", async ({ page }) => {
    /**
     * La pantalla podría estar filtrando en el navegador. Esto pregunta a la
     * API con la sesión de esa persona y mira la respuesta cruda: es la
     * diferencia entre «no se enseña» y «no se entrega».
     */
    await login(page, {
      email: emailDerivado(email!, E2E_SELLER_SUFFIX),
      password: password!,
      expectPath: "/dashboard/mi-espacio",
    });

    const cuerpo = await page.evaluate(async () => {
      const res = await fetch("/api/erp/order?limit=200", { credentials: "include" });
      return res.json();
    });
    const numeros = (cuerpo?.data ?? []).map((o: { order_number?: string }) => o.order_number);
    expect(numeros).toContain(ORDEN_PROPIA);
    expect(numeros).not.toContain(ORDEN_AJENA);
  });

  test("tecleando /dashboard/comisiones se topa con una negativa, no con la lista", async ({ page }) => {
    // El menú esconde esa entrada; la URL no. La guarda vive en el servidor.
    await login(page, {
      email: emailDerivado(email!, E2E_SELLER_SUFFIX),
      password: password!,
      expectPath: "/dashboard/mi-espacio",
    });

    await page.goto("/dashboard/comisiones");
    await expect(page.getByText("Hace falta rango de gerencia")).toBeVisible({ timeout: 30_000 });
  });
});
