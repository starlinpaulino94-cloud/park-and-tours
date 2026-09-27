import { expect, test } from "@playwright/test";
import { login } from "./login";
import {
  ORDEN_PROPIA, ORDEN_DEL_SOCIO, E2E_PARTNER_SUFFIX, emailDerivado,
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

  test("y no se lleva la lista de clientes de la operadora", async ({ page }) => {
    // `customer` está denegado al socio a propósito: sus clientes son los que él
    // trajo, y esos viajan dentro de su reserva.
    await entrar(page);
    const status = await page.evaluate(async () => {
      const res = await fetch("/api/erp/customer?limit=5", { credentials: "include" });
      return res.status;
    });
    expect(status).toBeGreaterThanOrEqual(400);
  });
});
