import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const dispatchQueue = vi.fn();
const serviceStore = vi.fn(() => ({ marker: "service" }));
const after = vi.fn();

vi.mock("@/lib/messaging/outbox", () => ({
  dispatchQueue: (...args: unknown[]) => dispatchQueue(...args),
}));
vi.mock("@/lib/messaging/service-store", () => ({
  serviceStore: () => serviceStore(),
}));
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => after(fn),
}));

import { drainOutbox, flushOutboxAfterResponse } from "@/lib/messaging/flush";

const company = { _id: "org", name: "Caribe Tours" } as never;

describe("el drenado de la cola tras la respuesta", () => {
  beforeEach(() => {
    dispatchQueue.mockReset();
    serviceStore.mockClear();
    after.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("entrega con el cliente de servicio, no con las ayudas de inquilino", async () => {
    // Esto corre DESPUÉS de la respuesta: no hay garantía de que la sesión siga
    // resolviéndose desde las cookies, y leer cero mensajes diciendo que no hay
    // nada que mandar es el peor fallo posible en una cola.
    dispatchQueue.mockResolvedValue({ picked: 2, sent: 2, failed: 0, waiting: 0, notConfigured: [] });
    await drainOutbox(company, "org-1");
    expect(serviceStore).toHaveBeenCalled();
    const [, companyId, , store] = dispatchQueue.mock.calls[0];
    expect(companyId).toBe("org-1");
    expect(store).toEqual({ marker: "service" });
  });

  it("un fallo del proveedor no escala: la operación ya terminó", async () => {
    dispatchQueue.mockRejectedValue(new Error("Resend caído"));
    await expect(drainOutbox(company, "org-1")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it("no dice nada cuando la cola estaba vacía", async () => {
    dispatchQueue.mockResolvedValue({ picked: 0, sent: 0, failed: 0, waiting: 0, notConfigured: [] });
    await drainOutbox(company, "org-1");
    expect(console.log).not.toHaveBeenCalled();
  });

  it("acota cuántos intenta por petición", async () => {
    dispatchQueue.mockResolvedValue({ picked: 0, sent: 0, failed: 0, waiting: 0, notConfigured: [] });
    await drainOutbox(company, "org-1");
    const [, , limit] = dispatchQueue.mock.calls[0];
    expect(limit).toBeGreaterThan(0);
    expect(limit).toBeLessThanOrEqual(25);
  });

  it("programa el drenado con after(), no lo ejecuta en línea", () => {
    flushOutboxAfterResponse(company, "org-1");
    expect(after).toHaveBeenCalledTimes(1);
    // Lo importante: al volver de la llamada NO se ha entregado nada todavía.
    expect(dispatchQueue).not.toHaveBeenCalled();
  });

  it("el callback que programa es el que drena", async () => {
    dispatchQueue.mockResolvedValue({ picked: 1, sent: 1, failed: 0, waiting: 0, notConfigured: [] });
    flushOutboxAfterResponse(company, "org-1");
    await after.mock.calls[0][0]();
    expect(dispatchQueue).toHaveBeenCalledTimes(1);
  });

  it("sin contexto de petición no rompe: el barrido diario lo recoge", () => {
    after.mockImplementation(() => {
      throw new Error("after() was called outside a request scope");
    });
    expect(() => flushOutboxAfterResponse(company, "org-1")).not.toThrow();
    expect(console.warn).toHaveBeenCalled();
  });
});
