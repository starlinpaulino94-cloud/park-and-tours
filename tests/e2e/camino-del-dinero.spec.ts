import { expect, test } from "@playwright/test";
import { login } from "./login";
import { EXCURSION_E2E, PRECIO_EXCURSION_E2E } from "./global-setup";

/**
 * EL CAMINO DEL DINERO, EN UN NAVEGADOR DE VERDAD (T-001).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ AÑADE ESTO A LO QUE YA HAY
 *
 * Vender, cobrar y cancelar tienen cientos de pruebas unitarias —el servicio,
 * la ruta, las guardas— y ninguna pasaba por la PANTALLA. La auditoría lo dejó
 * escrito como su riesgo más alto: «Nada recorre vender→cobrar→cancelar en un
 * navegador». Un botón que llama al endpoint equivocado, un diálogo que manda
 * el importe como texto, un toast que dice «registrado» sobre un 500: nada de
 * eso lo ve una prueba unitaria, y todo eso lo ve el cajero con el cliente
 * delante.
 *
 * Aquí entra una persona con su contraseña, vende por el punto de venta, cobra
 * con tarjeta y cancela desde Reservas. Y al final se comprueba la letra
 * pequeña contra la API con la MISMA sesión, porque la pantalla podría estar
 * contando algo distinto de lo que quedó escrito.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE SE AFIRMA
 *
 *   1. La venta sale del POS con el precio SEMBRADO, no con 0 ni con otro.
 *   2. El cobro deja la reserva «Pagada» en la pantalla que la administra.
 *   3. La cancelación la deja «Cancelada», con su motivo escrito.
 *   4. La orden entera queda cancelada en la base, no solo la reserva.
 *   5. Cancelar OTRA VEZ se rechaza con 409 — es la guarda del doble
 *      reembolso (AUD-B03), ejercida por la sesión real.
 */

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.skip(!email || !password, "Define E2E_EMAIL y E2E_PASSWORD para ejecutar el camino del dinero.");

test.describe("el camino del dinero", () => {
  test.setTimeout(240_000);

  test("vender → cobrar → cancelar, y la segunda cancelación se rechaza", async ({ page }) => {
    await login(page, { email: email!, password: password!, expectPath: "/dashboard" });

    // ---- VENDER, desde el punto de venta --------------------------------
    await page.goto("/dashboard/pos");
    await expect(page.getByRole("heading", { name: "Punto de venta" })).toBeVisible({ timeout: 30_000 });

    await page
      .getByPlaceholder("Buscar excursión por nombre, código, categoría o ubicación…")
      .fill(EXCURSION_E2E);
    const tarjeta = page.locator("article").filter({ hasText: EXCURSION_E2E }).first();
    await expect(tarjeta).toBeVisible({ timeout: 30_000 });
    await tarjeta.getByRole("button", { name: "Añadir a la venta" }).click();

    // La línea entra con su salida preseleccionada y 1 adulto.
    await expect(page.getByText(/Excursiones en la venta \(1\)/)).toBeVisible({ timeout: 15_000 });

    // El cliente se da de alta desde el mostrador y el POS lo deja elegido.
    await page.getByRole("button", { name: "Nuevo" }).click();
    const alta = page.getByRole("dialog").filter({ hasText: "Nuevo cliente" });
    await expect(alta).toBeVisible();
    // Los campos del alta no llevan `htmlFor`, así que se rellenan por orden:
    // Nombre, Apellidos, Email, Teléfono, País.
    const campos = alta.getByRole("textbox");
    await campos.nth(0).fill("Zacarías");
    await campos.nth(1).fill("Caminodinero");
    await alta.getByRole("button", { name: "Crear cliente" }).click();
    await expect(alta).toBeHidden({ timeout: 15_000 });

    /**
     * El botón enseña el TOTAL, y el total tiene que ser el precio sembrado.
     * Si aquí dijera $0.00, todo lo que sigue «pasaría» cobrando nada — que es
     * exactamente la clase de verde mentiroso que este spec viene a impedir.
     */
    const confirmar = page.getByRole("button", { name: /Confirmar venta/ });
    await expect(confirmar).toContainText(String(PRECIO_EXCURSION_E2E), { timeout: 20_000 });
    await confirmar.click();

    // El resguardo: la venta existe, con su número y su reserva.
    const resguardo = page.getByRole("dialog").filter({ hasText: /Venta ORD-.+ registrada/ });
    await expect(resguardo).toBeVisible({ timeout: 30_000 });
    const titulo = (await resguardo.getByText(/Venta ORD-.+ registrada/).textContent()) ?? "";
    const orden = titulo.match(/ORD-[A-Z0-9-]+/i)?.[0] ?? "";
    expect(orden, `el resguardo no trae el número de la venta: «${titulo}»`).toMatch(/^ORD-/);
    const reserva = ((await resguardo.locator("p", { hasText: /RSV-/ }).first().textContent()) ?? "").trim();
    expect(reserva).toMatch(/^RSV-/);

    // ---- COBRAR, con tarjeta (sin caja abierta el efectivo se rechaza) ---
    // El importe viene prellenado con el total de la orden.
    await resguardo.getByRole("button", { name: "Cobrar ahora" }).click();
    // «Cobro registrado» a secas, o «… · Factura B…», o «… pero la factura no
    // salió»: las tres empiezan igual, y las tres significan que el dinero
    // quedó registrado. La factura tiene su propia red en unitarias.
    await expect(page.getByText(/Cobro registrado/).first()).toBeVisible({ timeout: 30_000 });

    // ---- la reserva quedó PAGADA, en la pantalla que la administra -------
    await page.goto("/dashboard/reservas");
    await page
      .getByPlaceholder("Buscar por número de reserva, voucher o habitación…")
      .fill(reserva);
    await expect(page.getByText(reserva).first()).toBeVisible({ timeout: 30_000 });
    // La lista queda filtrada a esta reserva: la columna Saldo dice «Pagada».
    await expect(page.getByText("Pagada").first()).toBeVisible({ timeout: 30_000 });

    await page.getByText(reserva).first().click();
    const ficha = page.getByRole("dialog").filter({ hasText: reserva });
    // El badge de estado de la ficha, y el desglose con lo cobrado.
    await expect(ficha.getByText("Pagada").first()).toBeVisible({ timeout: 30_000 });
    await expect(ficha.getByText("Cobrado")).toBeVisible({ timeout: 15_000 });

    // ---- CANCELAR, con su motivo ----------------------------------------
    await ficha.getByRole("button", { name: "Cancelar reserva" }).click();
    // Dos botones se llaman «Cancelar reserva»: el de la ficha y el del
    // diálogo. El diálogo se distingue por su título, «Cancelar RSV-…».
    const cancelar = page.getByRole("dialog").filter({ hasText: `Cancelar ${reserva}` });
    await expect(cancelar).toBeVisible();
    await cancelar
      .getByPlaceholder("Cliente enfermo, mal tiempo, cambio de planes…")
      .fill("Prueba E2E del camino del dinero");
    await cancelar.getByRole("button", { name: "Cancelar reserva" }).click();
    await expect(page.getByText(/Reserva cancelada/).first()).toBeVisible({ timeout: 30_000 });

    // La lista sigue filtrada por esta reserva: su estado ahora es Cancelada.
    await expect(page.getByText(reserva).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Cancelada").first()).toBeVisible({ timeout: 30_000 });

    // ---- la letra pequeña, contra la API con la MISMA sesión -------------
    // La pantalla podría estar contando otra cosa. Esto lee lo que quedó
    // escrito: el estado de la reserva, el de la ORDEN entera, y que cancelar
    // otra vez se rechaza en vez de reembolsar de nuevo.
    const escrito = await page.evaluate(async (numeros) => {
      const [reservas, ordenes] = await Promise.all([
        fetch(`/api/erp/booking?q=${encodeURIComponent(numeros.reserva)}&limit=10`, { credentials: "include" })
          .then((r) => r.json()),
        fetch("/api/erp/order?limit=200", { credentials: "include" }).then((r) => r.json()),
      ]);
      const fila = (reservas?.data ?? []).find(
        (b: { booking_number?: string }) => b.booking_number === numeros.reserva
      );
      const venta = (ordenes?.data ?? []).find(
        (o: { order_number?: string }) => o.order_number === numeros.orden
      );

      const segundoIntento = fila
        ? await fetch(`/api/bookings/${fila._id}/cancel`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ reason: "segundo intento, debe rechazarse" }),
          }).then((r) => r.status)
        : null;

      return {
        reserva: fila
          ? { status: fila.status, total: fila.total_amount, balance: fila.balance_amount }
          : null,
        orden: venta ? { status: venta.status } : null,
        segundoIntento,
      };
    }, { reserva, orden });

    expect(escrito.reserva, "la reserva no aparece por la API").not.toBeNull();
    expect(escrito.reserva?.status).toBe("cancelled");
    expect(escrito.reserva?.total).toBe(PRECIO_EXCURSION_E2E);
    expect(escrito.reserva?.balance).toBe(0);
    expect(escrito.orden, "la orden no aparece por la API").not.toBeNull();
    // Era su única reserva: la orden entera tiene que quedar cancelada, no
    // viva con una reserva muerta dentro (AUD-M04).
    expect(escrito.orden?.status).toBe("cancelled");
    // Y cancelar dos veces NO reembolsa dos veces (AUD-B03): 409, no 200.
    expect(escrito.segundoIntento, "la segunda cancelación debe rechazarse").toBe(409);
  });
});
