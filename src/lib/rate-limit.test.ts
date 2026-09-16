import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const warn = vi.fn();
vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));
vi.mock("@/lib/backend-logger", () => ({ logger: { warn: (...a: unknown[]) => warn(...a), info: vi.fn(), error: vi.fn() } }));

import { hit, retryAfterFrom, assertRateLimit, resetLocalBuckets, rateLimitKey } from "@/lib/rate-limit";

/**
 * El limitador tiene dos capas y las dos importan por motivos distintos: la de
 * memoria rechaza la ráfaga sin gastar un viaje a la base, y la de la base es
 * el contador de VERDAD —el único que no se multiplica por el número de
 * instancias—. Lo que se prueba aquí es que ninguna de las dos se salte a la
 * otra, y que cuando la base falla el límite degrade en vez de desaparecer.
 */

const ok = (allowed: boolean, retry = 30) => ({ data: [{ allowed, hits: 1, retry_after: retry }], error: null });

beforeEach(() => {
  rpc.mockReset();
  warn.mockReset();
  resetLocalBuckets();
});

describe("la cuenta de la ventana", () => {
  it("el tope es «hasta N», no «más de N»", () => {
    // Con límite 2, el tercero se rechaza. Un `>` en vez de `>=` aquí regala un
    // intento por ventana, que en un intento de contraseña sí se nota.
    let bucket = hit(undefined, 1000, 2, 60_000);
    expect(bucket.allowed).toBe(true);
    bucket = hit(bucket.bucket, 1001, 2, 60_000);
    expect(bucket.allowed).toBe(true);
    bucket = hit(bucket.bucket, 1002, 2, 60_000);
    expect(bucket.allowed).toBe(false);
  });

  it("la ventana vencida se reinicia en 1, no en 0", () => {
    // La petición que reinicia la ventana también cuenta: es la diferencia
    // entre 5 y 6 intentos por minuto sostenidos.
    const primera = hit(undefined, 0, 5, 1000);
    const despues = hit(primera.bucket, 2000, 5, 1000);
    expect(despues.bucket.hits).toBe(1);
    expect(despues.allowed).toBe(true);
  });

  it("dentro de la ventana el vencimiento no se mueve", () => {
    // Si cada intento empujara el vencimiento, quien insiste sin parar se
    // bloquearía para siempre a sí mismo.
    const primera = hit(undefined, 0, 5, 60_000);
    const segunda = hit(primera.bucket, 30_000, 5, 60_000);
    expect(segunda.bucket.resetAt).toBe(primera.bucket.resetAt);
  });

  it("nunca dice «reintenta en 0 segundos»", () => {
    expect(retryAfterFrom(1000, 999)).toBe(1);
    expect(retryAfterFrom(0, 5000)).toBe(1);
  });

  it("un límite de 0 no deja pasar ni la primera", () => {
    expect(hit(undefined, 0, 0, 1000).allowed).toBe(false);
  });
});

describe("la clave", () => {
  const reqWith = (headers: Record<string, string>) => new Request("https://x.test", { headers });

  it("prefiere el sujeto autenticado a la IP", () => {
    // Dos personas tras la misma IP de oficina no se estorban.
    expect(rateLimitKey(reqWith({}), "login", "user-1")).toBe("login:user-1");
  });

  it("sin sujeto cae a la IP del cliente, no a una sola clave global", () => {
    // Con una clave global, el intento de cualquiera bloquearía a todos.
    expect(rateLimitKey(reqWith({ "x-forwarded-for": "8.8.8.8, 10.0.0.1" }), "login")).toBe("login:8.8.8.8");
  });
});

describe("las dos capas juntas", () => {
  it("consulta el contador compartido en cada petición que pasa la memoria", async () => {
    rpc.mockResolvedValue(ok(true));
    await assertRateLimit({ key: "k1", limit: 5, windowMs: 60_000 });
    expect(rpc).toHaveBeenCalledWith("rate_limit_hit", { p_key: "k1", p_limit: 5, p_window_ms: 60_000 });
  });

  it("el contador compartido rechaza aunque esta instancia no haya visto nada", async () => {
    /**
     * Esta es la prueba que justifica la migración entera: la petición número
     * 200 de un ataque cae en una instancia recién levantada, donde la memoria
     * está vacía. Antes pasaba. Ahora la frena el contador de la base.
     */
    rpc.mockResolvedValue(ok(false, 42));
    await expect(assertRateLimit({ key: "k2", limit: 5, windowMs: 60_000 }))
      .rejects.toMatchObject({ status: 429, retryAfter: 42 });
  });

  it("la memoria rechaza sin gastar un viaje a la base", async () => {
    rpc.mockResolvedValue(ok(true));
    await assertRateLimit({ key: "k3", limit: 1, windowMs: 60_000 });
    rpc.mockClear();

    await expect(assertRateLimit({ key: "k3", limit: 1, windowMs: 60_000 })).rejects.toMatchObject({ status: 429 });
    expect(rpc, "la ráfaga local no debería costar una consulta").not.toHaveBeenCalled();
  });

  it("si la base falla, degrada al límite en memoria: no se abre del todo", async () => {
    /**
     * Un limitador caído no puede tumbar el sistema —rechazar todo sería peor
     * que el problema que resuelve—, pero tampoco puede desaparecer. Se queda
     * el veredicto de la memoria, que es lo que había antes de 0043.
     */
    rpc.mockResolvedValue({ data: null, error: { message: "conexión rechazada" } });

    // Pasa mientras la memoria lo permita...
    await assertRateLimit({ key: "k4", limit: 2, windowMs: 60_000 });
    await assertRateLimit({ key: "k4", limit: 2, windowMs: 60_000 });
    // ...y la memoria sigue frenando.
    await expect(assertRateLimit({ key: "k4", limit: 2, windowMs: 60_000 })).rejects.toMatchObject({ status: 429 });

    // Y queda registrado: un límite que deja de aplicarse en silencio es peor
    // que uno que falla.
    expect(warn).toHaveBeenCalled();
  });

  it("una excepción del cliente de la base tampoco tumba la petición", async () => {
    rpc.mockRejectedValue(new Error("sin red"));
    await expect(assertRateLimit({ key: "k5", limit: 2, windowMs: 60_000 })).resolves.toBeUndefined();
  });

  it("una respuesta con forma inesperada no se interpreta como «rechazado»", async () => {
    // Rechazar por una respuesta que no se entiende convertiría un cambio de
    // versión de la biblioteca en una caída del sistema.
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(assertRateLimit({ key: "k6", limit: 2, windowMs: 60_000 })).resolves.toBeUndefined();
  });

  it("«solo local» no toca la base", async () => {
    rpc.mockResolvedValue(ok(true));
    await assertRateLimit({ key: "k7", limit: 5, windowMs: 60_000, localOnly: true });
    expect(rpc).not.toHaveBeenCalled();
  });
});
