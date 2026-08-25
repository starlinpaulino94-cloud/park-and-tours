import { expect, test } from "@playwright/test";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.skip(!email || !password, "Define E2E_EMAIL y E2E_PASSWORD para ejecutar la prueba real de Mi día.");

test("Mi día no genera desbordamiento horizontal", async ({ page }) => {
  await page.goto("/login?redirect=/dashboard/inicio/mi-dia");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Contraseña").fill(password!);
  await page.getByRole("button", { name: "Entrar" }).click();

  await page.waitForURL(/\/dashboard\/inicio\/mi-dia/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Mi día" })).toBeVisible();

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
