import { expect, test, type Page } from "@playwright/test";
import { login } from "./login";
import { EXCURSION_E2E, PRECIO_EXCURSION_E2E, CLIENTE_DE_LA_VENTA } from "./global-setup";

/**
 * VENDER → COBRAR → CANCELAR, EN UN NAVEGADOR DE VERDAD (T-001).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ERA T-001, Y QUÉ QUEDABA DE ÉL
 *
 * «Nada recorre vender→cobrar→cancelar en un navegador.» La primera mitad del
 * hallazgo —«dos ficheros de Playwright»— ya no era cierta: hay cinco. La
 * segunda sí: las cinco son de AISLAMIENTO. Entran, miran, y afirman que no se
 * ve lo ajeno. **Ninguna escribe nada.**
 *
 * Y el camino que ninguna recorre es justo el que ha concentrado casi todos los
 * hallazgos de esta auditoría: la retención de plaza (0099), el cupo del socio
 * (0100), la comisión, el monedero, el arqueo. Cada pieza tiene sus pruebas
 * unitarias; lo que no tenía ninguna prueba es que las piezas ENCAJEN con una
 * sesión real, la RLS puesta y el enganche del token metiendo el rol.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ LOS PASOS SE HACEN CON EL RATÓN Y LAS AFIRMACIONES POR LA API
 *
 * Pinchar es lo que prueba que la pantalla sirve. Pero una pantalla puede
 * enseñar «cobrado» y no haber escrito nada, y ahí el verde sería mentira. Así
 * que cada paso se hace en la interfaz y se comprueba contra la API **con la
 * misma sesión del navegador**: lo que se afirma es lo que quedó ESCRITO.
 *
 * Es además lo que hace el fallo diagnosticable, que es la política de
 * `login.ts`: si esto se pone rojo, el mensaje dice en qué paso y con qué
 * cifras, no «timeout esperando un selector».
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTA PRUEBA DEJA DETRÁS
 *
 * Cancela lo que vende, así que la plaza vuelve. La orden se queda, como las
 * sembradas. Y si la corrida se cae a mitad, `global-setup` limpia las reservas
 * de esta salida en la siguiente: sin eso, a las cuarenta corridas el CI
 * empezaría a fallar por capacidad agotada y el fallo no se parecería en nada a
 * su causa.
 */

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.skip(!email || !password, "Define E2E_EMAIL y E2E_PASSWORD para ejecutar la venta completa.");

/** Pregunta a la API con la sesión del navegador y devuelve el cuerpo. */
async function api<T = unknown>(page: Page, ruta: string): Promise<T> {
  return page.evaluate(async (r) => {
    const res = await fetch(r, { credentials: "include" });
    return res.json();
  }, ruta) as Promise<T>;
}

interface OrdenLeida {
  _id: string; order_number?: string; status?: string;
  total?: number; paid_total?: number; balance?: number;
}
interface ReservaLeida {
  _id: string; booking_number?: string; status?: string; pax_total?: number;
}

/** Las plazas libres de la salida del E2E, leídas por donde las lee el punto de venta. */
async function plazasLibres(page: Page): Promise<number> {
  // `catalog`, no `products`: es el nombre que devuelve la ruta. Leyendo una
  // clave que no existe esto daba cero plazas sin fallar en ninguna parte —el
  // `?? []` convertía «me equivoqué de nombre» en «la salida está llena»— y el
  // fallo salía cuatro líneas más abajo, acusando al sembrador.
  const ctx = await api<{ data?: { catalog?: { name?: string; departures?: { available_pax?: number | null }[] }[] } }>(
    page, "/api/pos/context"
  );
  const producto = (ctx?.data?.catalog ?? []).find((p) => p.name === EXCURSION_E2E);
  const salida = producto?.departures?.[0];
  return Number(salida?.available_pax ?? 0);
}

test.describe("una venta entera, de la pantalla a la base", () => {
  // El recorrido completo tarda: son cuatro pantallas y tres escrituras.
  test.setTimeout(180_000);

  test("se vende, se cobra, se toma la plaza y al cancelar vuelve", async ({ page }) => {
    await login(page, { email: email!, password: password!, expectPath: "/dashboard" });

    await page.goto("/dashboard/pos");
    await expect(page.getByPlaceholder("Buscar excursión por nombre, código, categoría o ubicación…"))
      .toBeVisible({ timeout: 30_000 });

    const libresAntes = await plazasLibres(page);
    expect(libresAntes, "la salida del E2E no tiene plazas: revisa el sembrador").toBeGreaterThan(0);

    // ── 1. AL CARRITO ───────────────────────────────────────────────────────
    await page.getByPlaceholder("Buscar excursión por nombre, código, categoría o ubicación…")
      .fill(EXCURSION_E2E);
    const tarjeta = page.locator("article").filter({ hasText: EXCURSION_E2E }).first();
    await expect(tarjeta, `no aparece «${EXCURSION_E2E}» en el catálogo`).toBeVisible({ timeout: 30_000 });
    await tarjeta.getByRole("button", { name: "Añadir a la venta" }).click();

    // ── 2. EL CLIENTE ───────────────────────────────────────────────────────
    // Sin cliente el botón de confirmar está deshabilitado a propósito, así que
    // esto no es decoración: es lo que desbloquea la venta.
    await page.getByPlaceholder("Buscar por nombre, email, teléfono o documento…").fill("Compratest");
    await page.getByRole("combobox").filter({ hasText: "Selecciona el cliente" }).click();
    await page.getByRole("option", { name: new RegExp(CLIENTE_DE_LA_VENTA.split(" ")[1], "i") }).click();

    // ── 3. CONFIRMAR ────────────────────────────────────────────────────────
    const confirmar = page.getByRole("button", { name: /Confirmar venta/ });
    await expect(confirmar, "el botón de confirmar sigue bloqueado").toBeEnabled({ timeout: 30_000 });
    await confirmar.click();

    // El diálogo de cobro se abre SOLO si la venta se escribió.
    await expect(page.getByRole("button", { name: "Cobrar ahora" }))
      .toBeVisible({ timeout: 60_000 });

    // Lo que quedó escrito, no lo que dice la pantalla.
    const { data: ordenes } = await api<{ data: OrdenLeida[] }>(page, "/api/erp/order?limit=5&sort=-createdAt");
    const orden = ordenes?.[0];
    expect(orden, "no se escribió ninguna orden").toBeTruthy();
    expect(Number(orden!.total), `la venta salió por ${orden!.total} y el producto vale ${PRECIO_EXCURSION_E2E}`)
      .toBeGreaterThan(0);
    expect(Number(orden!.balance ?? 0), "una venta recién hecha no puede estar saldada").toBeGreaterThan(0);

    // ── 4. LA PLAZA, TOMADA ─────────────────────────────────────────────────
    // Es la mitad de 0099 y de 0100: si esto no baja, la venta no apartó nada y
    // la siguiente persona compra el mismo asiento.
    const libresTrasVender = await plazasLibres(page);
    expect(libresTrasVender, "vender no descontó ninguna plaza de la salida")
      .toBeLessThan(libresAntes);

    // ── 5. COBRAR ───────────────────────────────────────────────────────────
    await page.getByRole("button", { name: "Cobrar ahora" }).click();
    await expect(page.getByRole("button", { name: "Cobrar ahora" }))
      .toHaveCount(0, { timeout: 60_000 });

    const { data: trasCobrar } = await api<{ data: OrdenLeida[] }>(
      page, `/api/erp/order?filter._id=${orden!._id}&limit=1`
    );
    const saldada = trasCobrar?.[0];
    expect(Number(saldada?.paid_total ?? 0), "el cobro no dejó rastro en la orden").toBeGreaterThan(0);
    expect(Number(saldada?.balance ?? -1), "la orden quedó con saldo después de cobrarla entera").toBe(0);
    expect(saldada?.status, "el estado no llegó a pagada").toBe("paid");

    // ── 6. CANCELAR, Y QUE LA PLAZA VUELVA ──────────────────────────────────
    const { data: reservas } = await api<{ data: ReservaLeida[] }>(
      page, `/api/erp/booking?filter.order=${orden!._id}&limit=5`
    );
    const reserva = reservas?.[0];
    expect(reserva, "la venta no dejó ninguna reserva").toBeTruthy();

    await page.goto("/dashboard/reservas");
    await page.getByPlaceholder(/Buscar/).first().fill(reserva!.booking_number ?? "");
    await page.getByText(reserva!.booking_number ?? "").first().click();
    await page.getByRole("button", { name: "Cancelar reserva" }).first().click();
    // El diálogo trae otro botón con el mismo nombre: el de confirmar.
    await page.getByRole("button", { name: "Cancelar reserva" }).last().click();

    await expect
      .poll(async () => {
        const { data } = await api<{ data: ReservaLeida[] }>(
          page, `/api/erp/booking?filter._id=${reserva!._id}&limit=1`
        );
        return data?.[0]?.status;
      }, { timeout: 60_000, message: "la reserva no llegó a cancelarse" })
      .toBe("cancelled");

    // Y la plaza vuelve al inventario: sin esto, cancelar deja el asiento
    // muerto y la excursión sale medio vacía con la lista de espera llena.
    await expect
      .poll(() => plazasLibres(page), {
        timeout: 60_000,
        message: "cancelar no devolvió la plaza a la salida",
      })
      .toBe(libresAntes);
  });

  test("el servidor rechaza vender por encima del cupo, no solo la pantalla", async ({ page }) => {
    /**
     * La pantalla esconde las salidas llenas. Esto pide la venta POR LA API con
     * la sesión de una persona real y con más pasajeros de los que caben.
     *
     * Es la única comprobación de toda la casa que ejerce el camino entero
     * —sesión, rol en el token, RLS, ruta, `reserve_departure_capacity`— contra
     * la base de verdad. La carrera de `db-test.sh` prueba la FUNCIÓN; esto
     * prueba que la ruta la llama y que la llamada manda.
     */
    await login(page, { email: email!, password: password!, expectPath: "/dashboard" });
    await page.goto("/dashboard/pos");

    const ctx = await api<{ data?: {
      catalog?: { _id: string; name?: string; departures?: { _id: string; capacity: number }[] }[];
    } }>(page, "/api/pos/context");
    const producto = (ctx?.data?.catalog ?? []).find((p) => p.name === EXCURSION_E2E);
    const salida = producto?.departures?.[0];
    expect(salida, "sin salida no se puede probar el techo").toBeTruthy();

    const respuesta = await page.evaluate(async (payload) => {
      const res = await fetch("/api/orders", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      return { status: res.status, cuerpo: await res.json().catch(() => null) };
    }, {
      // Mil pasajeros en una salida de cuarenta. Ni con la pantalla más rota
      // del mundo debería escribirse esto.
      items: [{ product_id: producto!._id, departure_id: salida!._id, adults: 1000 }],
    });

    /**
     * ────────────────────────────────────────────────────────────────────────
     * SE EXIGE EL MOTIVO, NO SOLO QUE FALLE
     *
     * La primera versión afirmaba `status >= 400` y habría pasado con un **404**
     * — es decir, si me hubiera equivocado en la ruta, la prueba daría verde sin
     * haber ejercido nada. Un rechazo por «no existe» y uno por «no caben» se
     * parecen mucho en un número y no se parecen en nada en lo que prueban.
     *
     * Así que se exige que la ruta EXISTA (nada de 404) y que la negativa hable
     * de plazas, que es lo que dice `OversellError`.
     */
    expect(respuesta.status, "la ruta de ventas no existe: la prueba no estaba probando nada")
      .not.toBe(404);
    expect(respuesta.status, `el servidor aceptó vender 1000 plazas (${JSON.stringify(respuesta.cuerpo)})`)
      .toBeGreaterThanOrEqual(400);
    const motivo = JSON.stringify(respuesta.cuerpo ?? {});
    expect(motivo, `rechazó, pero no por el cupo: ${motivo}`).toMatch(/plaza|cupo/i);
  });
});
