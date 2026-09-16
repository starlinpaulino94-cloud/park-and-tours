import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { TenantContext } from "@/lib/tenant";
import type { AppRole } from "@/lib/auth";

/**
 * Restablecer el segundo factor de otra persona le quita su protección. Estas
 * pruebas fijan las tres cosas que lo hacen aceptable: hace falta rango, no se
 * puede hacia arriba, y la marca del token se apaga junto con los factores —si
 * quedara puesta, la persona seguiría atascada pidiéndole un código a una cuenta
 * que ya no tiene ninguno, que es el peor final posible de un restablecimiento.
 */

const requireTenantWrite = vi.fn();
const writeAudit = vi.fn();
const listFactors = vi.fn();
const deleteFactor = vi.fn();
const updateUserById = vi.fn();
let membershipRow: Record<string, unknown> | null = null;

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return { ...actual, requireTenantWrite: (...a: unknown[]) => requireTenantWrite(...a) };
});
vi.mock("@/lib/audit", () => ({ writeAudit: (...a: unknown[]) => writeAudit(...a) }));
vi.mock("@/lib/csrf", () => ({ assertSameOriginMutation: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ assertRateLimit: vi.fn(), rateLimitKey: () => "k" }));
vi.mock("@/lib/supabase/service", () => ({
  supabaseService: () => ({
    auth: {
      admin: {
        mfa: {
          listFactors: (...a: unknown[]) => listFactors(...a),
          deleteFactor: (...a: unknown[]) => deleteFactor(...a),
        },
        updateUserById: (...a: unknown[]) => updateUserById(...a),
      },
    },
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: membershipRow, error: null }) }) }) }),
    }),
  }),
}));

import { POST } from "./mfa-reset/route";

const ctxOf = (role: AppRole): TenantContext & { companyId: string } => ({
  userId: "user-1", email: "admin@x.com", name: "Admin", role,
  companyId: "org-1", partnerId: null, company: null,
});

const call = async (userId = "otro") => {
  const req = { json: async () => ({ user_id: userId }), headers: new Headers() } as unknown as NextRequest;
  const res = await POST(req);
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  membershipRow = { role: "cashier", status: "active" };
  listFactors.mockResolvedValue({ data: { factors: [{ id: "f1" }] }, error: null });
  deleteFactor.mockResolvedValue({ error: null });
  updateUserById.mockResolvedValue({ error: null });
});

describe("POST /api/team/mfa-reset", () => {
  it("quita los factores y apaga la marca del token", async () => {
    requireTenantWrite.mockResolvedValue(ctxOf("admin"));
    const { status, body } = await call();

    expect(status).toBe(200);
    expect(body.data.removed).toBe(1);
    expect(deleteFactor).toHaveBeenCalledWith({ id: "f1", userId: "otro" });
    expect(updateUserById).toHaveBeenCalledWith("otro", { app_metadata: { mfa_enabled: false } });
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "mfa_reset", severity: "critical",
    }));
  });

  it("no se puede hacer sobre alguien de más rango", async () => {
    // Un administrador no toca la cuenta del propietario: quitarle el segundo
    // factor es quitarle su protección.
    requireTenantWrite.mockResolvedValue(ctxOf("admin"));
    membershipRow = { role: "owner", status: "active" };

    const { status, body } = await call();
    expect(status).toBe(403);
    expect(body.error.message).toMatch(/más rango/);
    expect(deleteFactor).not.toHaveBeenCalled();
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("un gerente no puede restablecer a nadie", async () => {
    requireTenantWrite.mockResolvedValue(ctxOf("manager"));
    const { status } = await call();
    expect(status).toBe(403);
    expect(listFactors).not.toHaveBeenCalled();
  });

  it("alguien de otra empresa no existe para esta ruta", async () => {
    // El aislamiento primero: sin esta comprobación, un identificador de otra
    // empresa serviría para desproteger una cuenta ajena.
    requireTenantWrite.mockResolvedValue(ctxOf("admin"));
    membershipRow = null;

    const { status } = await call();
    expect(status).toBe(404);
    expect(deleteFactor).not.toHaveBeenCalled();
  });

  it("sin factores igual apaga la marca: no deja a nadie atascado", async () => {
    /**
     * El caso de la cuenta a medias: marca puesta y ningún factor. Sin esto, la
     * persona seguiría viendo la pantalla del código para siempre y el
     * restablecimiento no la arreglaría.
     */
    requireTenantWrite.mockResolvedValue(ctxOf("owner"));
    listFactors.mockResolvedValue({ data: { factors: [] }, error: null });

    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.data.removed).toBe(0);
    expect(updateUserById).toHaveBeenCalledWith("otro", { app_metadata: { mfa_enabled: false } });
  });
});
