import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { TenantContext } from "@/lib/tenant";
import type { AppRole } from "@/lib/auth";

/**
 * La acción rápida "completar" se autoriza en el SERVIDOR. El frontend decide
 * qué botón dibuja, pero nunca es la barrera: aquí se comprueba que una tarea
 * ajena se rechaza aunque la petición llegue directamente a la API.
 */

const requireTenant = vi.fn();
const tenantFindOne = vi.fn();
const tenantUpdate = vi.fn();
const writeAudit = vi.fn();

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    requireTenant: (...args: unknown[]) => requireTenant(...args),
    tenantFindOne: (...args: unknown[]) => tenantFindOne(...args),
    tenantUpdate: (...args: unknown[]) => tenantUpdate(...args),
  };
});
vi.mock("@/lib/audit", () => ({ writeAudit: (...args: unknown[]) => writeAudit(...args) }));
vi.mock("@/lib/csrf", () => ({ assertSameOriginMutation: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ assertRateLimit: vi.fn(), rateLimitKey: () => "k" }));

import { POST } from "./[id]/complete/route";

const ctxOf = (role: AppRole, userId = "user-1"): TenantContext & { companyId: string } => ({
  userId, email: `${userId}@x.com`, name: userId, role,
  companyId: "org-1", partnerId: null, company: null,
});

const req = {} as NextRequest;

const call = async (id = "t1") => {
  const res = await POST(req, { params: Promise.resolve({ id }) });
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  tenantUpdate.mockImplementation(async (_o, _t, id, data) => ({ _id: id, ...data }));
});

describe("POST /api/tasks/:id/complete", () => {
  it("completa la tarea propia y la registra en auditoría", async () => {
    requireTenant.mockResolvedValue(ctxOf("seller"));
    tenantFindOne.mockResolvedValue({ _id: "t1", title: "Cerrar caja", status: "todo", assigned_to_id: "user-1" });

    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(tenantUpdate.mock.calls[0][3].status).toBe("done");
    expect(tenantUpdate.mock.calls[0][3].completed_at).toBeTruthy();
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "task_completed" }));
  });

  it("rechaza completar la tarea de otra persona", async () => {
    requireTenant.mockResolvedValue(ctxOf("seller"));
    tenantFindOne.mockResolvedValue({ _id: "t1", title: "Ajena", status: "todo", assigned_to_id: "user-9" });

    const { status, body } = await call();
    expect(status).toBe(403);
    expect(body.error.message).toMatch(/asignadas a ti/);
    expect(tenantUpdate).not.toHaveBeenCalled();
  });

  it("un rol de gestión sí puede cerrar la tarea de su equipo", async () => {
    requireTenant.mockResolvedValue(ctxOf("manager"));
    tenantFindOne.mockResolvedValue({ _id: "t1", title: "Ajena", status: "todo", assigned_to_id: "user-9" });

    expect((await call()).status).toBe(200);
  });

  it("no permite completar dos veces", async () => {
    requireTenant.mockResolvedValue(ctxOf("manager"));
    tenantFindOne.mockResolvedValue({ _id: "t1", title: "Hecha", status: "done", assigned_to_id: "user-1" });

    const { status } = await call();
    expect(status).toBe(409);
    expect(tenantUpdate).not.toHaveBeenCalled();
  });

  it("no permite completar una tarea cancelada", async () => {
    requireTenant.mockResolvedValue(ctxOf("manager"));
    tenantFindOne.mockResolvedValue({ _id: "t1", title: "X", status: "cancelled", assigned_to_id: "user-1" });
    expect((await call()).status).toBe(409);
  });

  it("una tarea de otra empresa no existe para el usuario", async () => {
    requireTenant.mockResolvedValue(ctxOf("manager"));
    tenantFindOne.mockRejectedValue(Object.assign(new Error("Registro no encontrado"), { status: 404 }));

    const { status } = await call("de-otro-tenant");
    expect(status).toBe(404);
    expect(tenantUpdate).not.toHaveBeenCalled();
  });

  it("sin sesión no se completa nada", async () => {
    const { TenantError } = await import("@/lib/tenant");
    requireTenant.mockRejectedValue(new TenantError("No autenticado", 401));

    const { status } = await call();
    expect(status).toBe(401);
  });
});
