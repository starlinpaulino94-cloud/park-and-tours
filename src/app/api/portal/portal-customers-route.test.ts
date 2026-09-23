import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { TenantContext } from "@/lib/tenant";

/**
 * EL ALTA DE CLIENTE DEL PORTAL, CONTRA LA RUTA.
 *
 * Lo que protege al sistema no es que la regla exista, es que la ruta la
 * llame. Aquí hay dos: de quién es el cliente lo pone el SERVIDOR, y el cuerpo
 * de la petición no puede traer campos que nadie declaró.
 */

const requireTenantWrite = vi.fn();
const tenantCreate = vi.fn();
const writeAudit = vi.fn();

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    requireTenantWrite: (...a: unknown[]) => requireTenantWrite(...a),
    tenantCreate: (...a: unknown[]) => tenantCreate(...a),
  };
});
vi.mock("@/lib/audit", () => ({ writeAudit: (...a: unknown[]) => writeAudit(...a) }));
vi.mock("@/lib/csrf", () => ({ assertSameOriginMutation: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ assertRateLimit: vi.fn(), rateLimitKey: () => "k" }));

import { POST as crear } from "./customers/route";

const ctxSocio = (extra: Partial<TenantContext> = {}): TenantContext & { companyId: string } => ({
  userId: "u-1", email: "reservas@tourcenter.test", name: "Reservas",
  role: "partner", companyId: "op-1", partnerId: "soc-1",
  isPartnerMember: true, partnerStatus: "active", company: null,
  ...extra,
} as TenantContext & { companyId: string });

const req = (body: unknown) => ({
  json: async () => body,
  nextUrl: { origin: "https://parkandtours.membego.com", searchParams: new URLSearchParams() },
  headers: new Headers(),
}) as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  tenantCreate.mockResolvedValue({ _id: "c-1" });
  requireTenantWrite.mockResolvedValue(ctxSocio());
});

describe("POST /api/portal/customers", () => {
  it("sella el socio desde el contexto y no desde el cuerpo", async () => {
    /**
     * Si viniera del cuerpo, un tour center daría de alta clientes a nombre de
     * otro —o de la operadora— y se los quitaría de la cartera al siguiente.
     */
    const res = await crear(req({ first_name: "Ana", partner_id: "soc-AJENO" }));
    expect(res.status).toBe(200);
    const [, tabla, payload] = tenantCreate.mock.calls[0];
    expect(tabla).toBe("customer");
    expect((payload as Record<string, unknown>).partner_id).toBe("soc-1");
  });

  it("y descarta lo que no está declarado", async () => {
    // El cuerpo no se copia: un `...body` dejaría escribir `status`, `tags` o
    // cualquier columna que el formulario del portal no ofrece.
    await crear(req({ first_name: "Ana", status: "vip", assigned_seller: "v-9", notes: "  " }));
    const payload = tenantCreate.mock.calls[0][2] as Record<string, unknown>;
    expect(payload.status).toBeUndefined();
    expect(payload.assigned_seller).toBeUndefined();
    // Y un campo declarado pero en blanco tampoco viaja: escribiría cadenas
    // vacías donde la ficha espera ausencia.
    expect(payload.notes).toBeUndefined();
    expect(payload.first_name).toBe("Ana");
  });

  it("el personal interno no da de alta por aquí", async () => {
    // Tiene su propio CRUD, y por ahí el cliente nace SIN socio, que es lo
    // correcto para la cartera de la operadora.
    requireTenantWrite.mockResolvedValue(ctxSocio({
      role: "admin", partnerId: null, isPartnerMember: false,
    }));
    const res = await crear(req({ first_name: "Ana" }));
    expect(res.status).toBe(403);
    expect(tenantCreate).not.toHaveBeenCalled();
  });

  it("un tour center pendiente de activación tampoco", async () => {
    requireTenantWrite.mockResolvedValue(ctxSocio({ partnerStatus: "pending" }));
    const res = await crear(req({ first_name: "Ana" }));
    expect(res.status).toBe(403);
    expect(tenantCreate).not.toHaveBeenCalled();
  });

  it("sin nombre no se crea nada", async () => {
    const res = await crear(req({ phone: "809" }));
    expect(res.status).toBe(400);
    expect(tenantCreate).not.toHaveBeenCalled();
  });

  it("y queda en la bitácora con el socio dentro", async () => {
    await crear(req({ first_name: "Ana" }));
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "record_created", entityType: "customer",
      metadata: { partner: "soc-1" },
    }));
  });
});
