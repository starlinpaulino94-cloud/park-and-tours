import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * El cron es la única pieza que escribe estados de aprobación sin una sesión de
 * usuario detrás, así que su credencial es la barrera. Aquí se comprueba que no
 * hay forma de dispararlo sin ella y que la sentencia respeta las solicitudes
 * de plazo abierto.
 */

const select = vi.fn();
const lt = vi.fn((_col: string, _value: string) => ({ select }));
const eq = vi.fn((_col: string, _value: string) => ({ lt }));
const update = vi.fn((_patch: Record<string, unknown>) => ({ eq }));
const from = vi.fn((_table: string) => ({ update }));
const writeAudit = vi.fn();

vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => ({ from }) }));
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAudit: (...args: unknown[]) => writeAudit(...args) }));

import { GET } from "./expire-approvals/route";

const request = (auth?: string) =>
  ({ headers: { get: (name: string) => (name === "authorization" ? auth ?? null : null) } }) as NextRequest;

const call = async (auth?: string) => {
  const res = await GET(request(auth));
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  process.env.CRON_SECRET = "s3cr3t";
  select.mockResolvedValue({ data: [], error: null });
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("GET /api/cron/expire-approvals", () => {
  it("caduca las solicitudes pendientes con plazo vencido", async () => {
    select.mockResolvedValue({ data: [{ id: "a" }, { id: "b" }], error: null });

    const { status, body } = await call("Bearer s3cr3t");
    expect(status).toBe(200);
    expect(body.data.expired).toBe(2);
    expect(from).toHaveBeenCalledWith("approval_request");
    expect(update).toHaveBeenCalledWith({ status: "expired" });
    expect(eq).toHaveBeenCalledWith("status", "pending");
  });

  it("no toca las solicitudes de plazo abierto", async () => {
    await call("Bearer s3cr3t");
    // `lt` sobre expires_at: una fila con NULL nunca satisface la comparación.
    expect(lt.mock.calls[0][0]).toBe("expires_at");
    expect(typeof lt.mock.calls[0][1]).toBe("string");
  });

  it("registra en auditoría solo cuando caducó algo", async () => {
    await call("Bearer s3cr3t");
    expect(writeAudit).not.toHaveBeenCalled();

    select.mockResolvedValue({ data: [{ id: "a" }], error: null });
    await call("Bearer s3cr3t");
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "approvals_expired" }));
  });

  it("rechaza una petición sin credencial", async () => {
    const { status } = await call();
    expect(status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  it("rechaza una credencial incorrecta", async () => {
    const { status } = await call("Bearer otra-cosa");
    expect(status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  it("no se ejecuta si el entorno no define el secreto", async () => {
    delete process.env.CRON_SECRET;
    const { status } = await call("Bearer s3cr3t");
    expect(status).toBe(503);
    expect(update).not.toHaveBeenCalled();
  });

  it("propaga un fallo de base de datos en vez de fingir éxito", async () => {
    select.mockResolvedValue({ data: null, error: { message: "conexión perdida" } });
    const { status, body } = await call("Bearer s3cr3t");
    expect(status).toBe(500);
    expect(body.ok).toBe(false);
  });
});
