"use client";

/**
 * Typed client-side fetch service.
 *
 * All client components MUST use these helpers instead of raw `fetch()`
 * so every call/response follows the same `{ ok, data?, error? }` shape.
 */

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  total?: number;
  error?: any;
  /**
   * El código HTTP, o 0 cuando no hubo respuesta (sin red, tiempo agotado).
   *
   * Hace falta para decidir si algo se reintenta: un 409 no mejora esperando y
   * un «sin conexión» sí. Sin esta distinción, la cola del check-in sin señal
   * reintentaría para siempre lo que el servidor ya rechazó.
   */
  status?: number;
}

async function request<T>(
  url: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    const res = await fetch(url, options);
    const json = (await res.json()) as ApiResponse<T>;
    json.status = res.status;
    const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - started;
    if (process.env.NODE_ENV !== "production" && elapsed > 800) {
      console.warn(`[api] ${options?.method || "GET"} ${url} tardó ${Math.round(elapsed)}ms`);
    }
    return json;
  } catch (err) {
    const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - started;
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[api] ${options?.method || "GET"} ${url} falló tras ${Math.round(elapsed)}ms`);
    }
    // Cero es «no hubo respuesta»: ni siquiera se llegó al servidor.
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export const api = {
  get<T>(url: string, init?: Pick<RequestInit, "signal">): Promise<ApiResponse<T>> {
    return request<T>(url, init);
  },

  post<T>(url: string, body: unknown): Promise<ApiResponse<T>> {
    return request<T>(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },

  put<T>(url: string, body: unknown): Promise<ApiResponse<T>> {
    return request<T>(url, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },

  delete<T>(url: string): Promise<ApiResponse<T>> {
    return request<T>(url, { method: "DELETE", credentials: "same-origin" });
  },
};
