import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "@/lib/api";

/**
 * EL AYUDANTE DE SUBIDA, PROBADO POR COMPORTAMIENTO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO BASTABA UNA GUARDA DE TEXTO
 *
 * `api.upload` existe para mandar multipart, y la única forma de romperlo es
 * SUTIL: poner `Content-Type: application/json` como hacen los demás verbos. Con
 * eso el navegador no añade el `boundary`, `req.formData()` del servidor no lee
 * nada, y la subida falla con un error que no dice eso.
 *
 * La mutación que lo añadía **sobrevivió** a las guardas de texto: ninguna mira lo
 * que el ayudante manda, solo que el componente lo llame. Y es de las peores para
 * cazar leyendo, porque la línea que lo rompe se parece a las tres de al lado.
 *
 * Así que se mira lo que sale: se sustituye `fetch` y se comprueba la petición.
 */

const original = globalThis.fetch;

function fetchFalso(json: unknown = { ok: true, data: {} }) {
  // Los parámetros se declaran aunque no se usen: sin ellos `mock.calls[0]` se
  // tipa como tupla vacía y no se puede leer el `init`, que es justo lo que esta
  // prueba mira.
  const espia = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
    status: 200,
    json: async () => json,
  }) as unknown as Response);
  globalThis.fetch = espia as unknown as typeof fetch;
  return espia;
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { globalThis.fetch = original; });

describe("api.upload manda multipart de verdad", () => {
  it("NO fija el content-type: lo pone el navegador con su boundary", async () => {
    const espia = fetchFalso();
    const form = new FormData();
    form.append("file", new Blob(["x"]), "foto.png");
    await api.upload("/api/storage/upload", form);

    const init = espia.mock.calls[0][1] as RequestInit;
    const cabeceras = (init.headers ?? {}) as Record<string, string>;
    const nombres = Object.keys(cabeceras).map((k) => k.toLowerCase());
    expect(nombres, "fijar el content-type rompe el multipart: el boundary lo pone el navegador")
      .not.toContain("content-type");
  });

  it("manda el FormData tal cual, sin serializarlo", async () => {
    const espia = fetchFalso();
    const form = new FormData();
    form.append("entity", "product");
    await api.upload("/api/storage/upload", form);

    const init = espia.mock.calls[0][1] as RequestInit;
    expect(init.body, "el cuerpo dejó de ser el FormData").toBe(form);
    expect(init.method).toBe("POST");
    // La cookie de sesión tiene que viajar, o la ruta contesta 401.
    expect(init.credentials).toBe("same-origin");
  });

  it("y devuelve la misma envoltura que el resto", async () => {
    fetchFalso({ ok: true, data: { url: "https://x/y.png" } });
    const res = await api.upload<{ url: string }>("/api/storage/upload", new FormData());
    expect(res.ok).toBe(true);
    expect(res.data?.url).toBe("https://x/y.png");
    expect(res.status).toBe(200);
  });

  it("un fallo de red no lanza: se contesta con status 0", async () => {
    globalThis.fetch = (() => Promise.reject(new Error("sin red"))) as unknown as typeof fetch;
    const res = await api.upload("/api/storage/upload", new FormData());
    expect(res.ok).toBe(false);
    // Cero es «no hubo respuesta»: es lo que distingue reintentar de no reintentar.
    expect(res.status).toBe(0);
  });
});

describe("y los verbos de JSON siguen fijándolo", () => {
  it("post manda json con su content-type", async () => {
    const espia = fetchFalso();
    await api.post("/api/x", { a: 1 });
    const init = espia.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });
});
