import { expect, test } from "@playwright/test";
import { login } from "./login";
import {
  ORDEN_PROPIA, ORDEN_DEL_SOCIO, E2E_PARTNER_SUFFIX, emailDerivado,
  CLIENTE_DEL_SOCIO, CLIENTE_DE_LA_VENTA, CLIENTE_DEL_MANIFIESTO,
} from "./global-setup";

/**
 * EL AISLAMIENTO DEL SOCIO, CON UN NAVEGADOR DE VERDAD.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ AÑADE A LAS CIENTOS DE PRUEBAS QUE YA HAY
 *
 * `partners.ts`, `row-scope.ts` y `field-projection.ts` dicen que las REGLAS son
 * correctas. Las pruebas de ruta dicen que las rutas las LLAMAN. Ninguna pasa
 * por la sesión real: el `partnerId` sale de un `mock`, y la cadena que lo
 * produce —membresía en una organización de tipo socio → el enganche del token
 * pone `partner_id` → `auth-context` lo lee → `esDeSocio` acota— no se ejerce
 * nunca de punta a punta.
 *
 * Esta es la única prueba que falla si el enganche deja de mirar `org.kind`, o si
 * `tenant_org_id` deja de colgar al socio de su operadora.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TRES AFIRMACIONES
 *
 *   1. No aterriza en el ERP: el panel interno lo desvía a su portal.
 *   2. Ve su venta y NO la de la operadora.
 *   3. La API tampoco se la da, aunque la pida a mano.
 */

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.skip(!email || !password, "Define E2E_EMAIL y E2E_PASSWORD para ejecutar el aislamiento del socio.");

const entrar = (page: import("@playwright/test").Page) =>
  login(page, {
    email: emailDerivado(email!, E2E_PARTNER_SUFFIX),
    password: password!,
    // El desvío lo decide el SERVIDOR, en el layout del panel. Si esto falla,
    // `/dashboard` ha dejado de echar al socio del ERP interno.
    expectPath: "/portal",
  });

test.describe("un socio solo ve lo suyo", () => {
  test.setTimeout(120_000);

  test("el panel interno lo desvía a su portal", async ({ page }) => {
    await entrar(page);
    // Y tecleando la URL otra vez: el desvío no es del login, es del layout.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/portal/, { timeout: 30_000 });
  });

  test("la API le da su venta y NO la de la operadora", async ({ page }) => {
    /**
     * La pantalla podría estar filtrando en el navegador. Esto pregunta a la API
     * con su sesión y mira la respuesta cruda: es la diferencia entre «no se
     * enseña» y «no se entrega».
     */
    await entrar(page);
    const cuerpo = await page.evaluate(async () => {
      const res = await fetch("/api/erp/order?limit=200", { credentials: "include" });
      return { status: res.status, body: await res.json().catch(() => null) };
    });
    expect(cuerpo.status).toBe(200);
    const numeros = (cuerpo.body?.data ?? []).map((o: { order_number?: string }) => o.order_number);
    expect(numeros).toContain(ORDEN_DEL_SOCIO);
    // La venta del vendedor de la casa no lleva socio: no puede llegarle.
    expect(numeros).not.toContain(ORDEN_PROPIA);
  });

  test("y de la cartera se lleva la SUYA, no la de la operadora", async ({ page }) => {
    /**
     * `customer` NO está denegado al socio, y esta prueba afirmaba que sí.
     *
     * Se le abrió en 0075 —acotada por `partner_id`— porque sin ella no podía
     * terminar una venta: `POST /api/orders` exige `customer_id` y él no tenía
     * forma de buscar ni de crear un cliente. La prueba se escribió después y
     * siguió pidiendo un 403 que ya no era el comportamiento; como el E2E nunca
     * llegó a correr, nadie vio la contradicción.
     *
     * Lo que hay que afirmar de una tabla ACOTADA no es el código de estado: es
     * que el filtro reparte. Por eso se mira por los dos lados —el suyo sale, el
     * de la casa no—: con solo la mitad de abajo, una ruta rota devolviendo
     * lista vacía pasaría la prueba.
     */
    await entrar(page);
    const cuerpo = await page.evaluate(async () => {
      const res = await fetch("/api/erp/customer?limit=200", { credentials: "include" });
      return { status: res.status, body: await res.json().catch(() => null) };
    });
    expect(cuerpo.status).toBe(200);
    const apellidos = (cuerpo.body?.data ?? []).map((c: { last_name?: string }) => c.last_name);
    expect(apellidos, "el socio no ve ni a su propio cliente").toContain(
      CLIENTE_DEL_SOCIO.split(" ")[1]
    );
    for (const ajeno of [CLIENTE_DE_LA_VENTA, CLIENTE_DEL_MANIFIESTO]) {
      expect(apellidos, `se le entregó «${ajeno}», que es de la operadora`)
        .not.toContain(ajeno.split(" ")[1]);
    }
  });
});
