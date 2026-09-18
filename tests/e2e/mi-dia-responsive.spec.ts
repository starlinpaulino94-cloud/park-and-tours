import { expect, test } from "@playwright/test";
import { login } from "./login";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.skip(!email || !password, "Define E2E_EMAIL y E2E_PASSWORD para ejecutar la prueba real de Mi día.");

test("Mi día no genera desbordamiento horizontal", async ({ page }) => {
  test.setTimeout(90_000);

  // `login` comprueba el pathname destino —no la URL entera, que lleva la ruta
  // en el query— y, si no se entra, dice por qué: el mensaje de pantalla, el
  // rechazo de la petición de sesión o el silencio de la ruta destino.
  await login(page, { email: email!, password: password!, expectPath: "/dashboard/inicio/mi-dia" });
  await expect(page.getByRole("heading", { name: "Mi día" })).toBeVisible({ timeout: 30_000 });

  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForLoadState("networkidle");

    const overflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));

    expect(overflow.scrollWidth, `${width}px no debe tener scroll horizontal`).toBeLessThanOrEqual(overflow.clientWidth);
  }
});
