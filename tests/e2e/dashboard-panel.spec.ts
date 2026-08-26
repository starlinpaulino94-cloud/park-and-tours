import { expect, test } from "@playwright/test";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.skip(!email || !password, "Define E2E_EMAIL y E2E_PASSWORD para ejecutar la prueba real del Panel ejecutivo.");

test("Panel ejecutivo carga, expone filtros legibles y no desborda", async ({ page }) => {
  test.setTimeout(90_000);

  await page.goto("/login?redirect=/dashboard");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Contraseña").fill(password!);
  await page.getByRole("button", { name: "Entrar" }).click();

  await page.waitForURL((url) => url.pathname === "/dashboard", { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Panel ejecutivo" })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: /Filtros/ }).click();
  await expect(page.getByRole("region", { name: "Filtros del panel ejecutivo" })).toBeVisible();
  await expect(page.getByLabel("Producto")).toBeVisible();
  await expect(page.getByLabel("Sucursal")).toBeVisible();
  await expect(page.getByLabel("Vendedor")).toBeVisible();
  await expect(page.getByLabel("Tour center")).toBeVisible();
  await expect(page.getByLabel("Canal")).toBeVisible();

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
