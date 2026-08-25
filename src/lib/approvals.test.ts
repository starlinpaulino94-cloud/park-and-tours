import { describe, it, expect, vi, beforeEach } from "vitest";

const tenantQuery = vi.fn();
const tenantCount = vi.fn();
const tenantCreate = vi.fn();
const tenantFindOne = vi.fn();
const tenantUpdate = vi.fn();
const writeAudit = vi.fn();

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    tenantQuery: (...args: unknown[]) => tenantQuery(...args),
    tenantCount: (...args: unknown[]) => tenantCount(...args),
    tenantCreate: (...args: unknown[]) => tenantCreate(...args),
    tenantFindOne: (...args: unknown[]) => tenantFindOne(...args),
    tenantUpdate: (...args: unknown[]) => tenantUpdate(...args),
  };
});
vi.mock("@/lib/audit", () => ({ writeAudit: (...args: unknown[]) => writeAudit(...args) }));

import {
  DECIDER, countDecidableFor, decide, decidableActionsFor, decidableFilter,
  isTwoSignature, needsApproval, pendingFor, requestApproval, requiresTwoSignatures,
} from "@/lib/approvals";
import type { TenantContext } from "@/lib/tenant";
import type { AppRole } from "@/lib/auth";

const ctxOf = (role: AppRole, userId = "me"): TenantContext & { companyId: string } => ({
  userId, email: `${userId}@x.com`, name: userId, role,
  companyId: "org-1", partnerId: null, company: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  tenantCreate.mockResolvedValue({ _id: "ap-1" });
  tenantUpdate.mockImplementation(async (_org, _table, id, data) => ({ _id: id, ...data }));
  tenantQuery.mockResolvedValue([]);
  tenantCount.mockResolvedValue(0);
});

describe("approvals — rango mínimo por acción", () => {
  it("un vendedor no puede decidir nada", () => {
    expect(decidableActionsFor("seller")).toEqual([]);
    expect(decidableFilter(ctxOf("seller"))).toBeNull();
  });

  it("operaciones decide justo lo que le corresponde", () => {
    expect(decidableActionsFor("operations").sort()).toEqual(["capacity_override", "schedule_change"]);
  });

  it("un manager no alcanza las acciones reservadas a admin", () => {
    const actions = decidableActionsFor("manager");
    expect(actions).toContain("refund");
    expect(actions).not.toContain("payout");
    expect(actions).not.toContain("clawback");
    expect(actions).not.toContain("commission_override");
  });

  it("el dueño y el admin alcanzan todo el catálogo", () => {
    expect(decidableActionsFor("owner")).toHaveLength(Object.keys(DECIDER).length);
    expect(decidableActionsFor("admin")).toHaveLength(Object.keys(DECIDER).length);
  });
});

describe("approvals — filtro de solicitudes decidibles", () => {
  const now = new Date("2026-08-25T15:00:00Z");
  const filter = decidableFilter(ctxOf("admin"), now)!;

  it("solo cuenta las pendientes", () => {
    expect(filter.status).toBe("pending");
  });

  it("excluye las solicitudes propias (nadie aprueba lo suyo)", () => {
    const groups = filter._and as Array<Record<string, unknown>>;
    expect(groups[0]).toEqual({ _or: [{ requested_by: null }, { requested_by: { ne: "me" } }] });
  });

  it("excluye las expiradas y conserva las que no caducan", () => {
    const groups = filter._and as Array<Record<string, unknown>>;
    expect(groups[1]).toEqual({
      _or: [{ expires_at: null }, { expires_at: { gt: now.toISOString() } }],
    });
  });

  it("excluye aquellas donde yo ya puse la primera firma", () => {
    const groups = filter._and as Array<Record<string, unknown>>;
    expect(groups[2]).toEqual({
      _or: [{ requires_two: false }, { approved_by: null }, { approved_by: { ne: "me" } }],
    });
  });

  it("restringe por acción según el rol", () => {
    expect(filter.action_type).toEqual({ in: decidableActionsFor("admin") });
  });
});

describe("approvals — consultas y contadores", () => {
  it("un rol sin autorización ni siquiera consulta la base de datos", async () => {
    await expect(pendingFor(ctxOf("seller"))).resolves.toEqual([]);
    await expect(countDecidableFor(ctxOf("seller"))).resolves.toBe(0);
    expect(tenantQuery).not.toHaveBeenCalled();
    expect(tenantCount).not.toHaveBeenCalled();
  });

  it("la lista y el contador usan el MISMO filtro de dominio", async () => {
    const ctx = ctxOf("admin");
    await pendingFor(ctx);
    await countDecidableFor(ctx);

    const listFilter = tenantQuery.mock.calls[0][2]._filter;
    const countFilter = tenantCount.mock.calls[0][2];
    // El instante difiere por milisegundos; el resto de la regla es idéntico.
    expect({ ...listFilter, _and: undefined }).toEqual({ ...countFilter, _and: undefined });
    expect(JSON.stringify(listFilter._and).length).toBe(JSON.stringify(countFilter._and).length);
  });

  it("siempre consulta dentro de la empresa del usuario", async () => {
    await pendingFor(ctxOf("admin"));
    expect(tenantQuery.mock.calls[0][0]).toBe("org-1");
    expect(tenantQuery.mock.calls[0][1]).toBe("approval_request");
  });
});

describe("approvals — doble firma con booleanos reales", () => {
  it("las acciones de doble firma se marcan con true, no con la cadena 'yes'", async () => {
    await requestApproval(ctxOf("admin"), { action: "payout", reason: "Pago a la red" });
    expect(tenantCreate.mock.calls[0][2].requires_two).toBe(true);
    expect(tenantCreate.mock.calls[0][2].requires_two).not.toBe("yes");
  });

  it("las acciones de firma simple se marcan con false", async () => {
    await requestApproval(ctxOf("admin"), { action: "refund", reason: "Reembolso" });
    expect(tenantCreate.mock.calls[0][2].requires_two).toBe(false);
  });

  it("la lectura interpreta el booleano de Postgres, nunca una cadena", () => {
    expect(isTwoSignature({ requires_two: true })).toBe(true);
    expect(isTwoSignature({ requires_two: false })).toBe(false);
    expect(isTwoSignature({ requires_two: null })).toBe(false);
    expect(requiresTwoSignatures("clawback")).toBe(true);
    expect(requiresTwoSignatures("refund")).toBe(false);
  });
});

describe("approvals — decidir", () => {
  const pending = (over: Record<string, unknown> = {}) => ({
    _id: "ap-1", code: "AP-001", action_type: "refund", status: "pending",
    requires_two: false, requested_by: "otra-persona", approved_by: null,
    amount: 250, currency: "usd", expires_at: null, ...over,
  });

  it("nadie aprueba su propia solicitud", async () => {
    tenantFindOne.mockResolvedValue(pending({ requested_by: "me" }));
    await expect(decide(ctxOf("admin"), "ap-1", "approve")).rejects.toThrow(/tu propia solicitud/);
  });

  it("un rol insuficiente no puede decidir", async () => {
    tenantFindOne.mockResolvedValue(pending({ action_type: "payout" }));
    await expect(decide(ctxOf("manager"), "ap-1", "approve")).rejects.toThrow(/rol admin o superior/);
  });

  it("una solicitud expirada no se aprueba y pasa a 'expired'", async () => {
    tenantFindOne.mockResolvedValue(pending({ expires_at: "2020-01-01T00:00:00Z" }));
    await expect(decide(ctxOf("admin"), "ap-1", "approve")).rejects.toThrow(/expiró/);
    expect(tenantUpdate).toHaveBeenCalledWith("org-1", "approval_request", "ap-1", { status: "expired" });
  });

  it("una solicitud ya resuelta no se vuelve a decidir", async () => {
    tenantFindOne.mockResolvedValue(pending({ status: "approved" }));
    await expect(decide(ctxOf("admin"), "ap-1", "approve")).rejects.toThrow(/ya fue/);
  });

  it("la primera firma NO cierra una solicitud de doble firma", async () => {
    tenantFindOne.mockResolvedValue(pending({ action_type: "payout", requires_two: true }));
    const result = await decide(ctxOf("admin", "firmante-1"), "ap-1", "approve");

    expect(result).toMatchObject({ pendingSecondSignature: true });
    const payload = tenantUpdate.mock.calls[0][3];
    expect(payload.approved_by).toBe("firmante-1");
    expect(payload.status).toBeUndefined();
  });

  it("la misma persona no puede poner la segunda firma", async () => {
    tenantFindOne.mockResolvedValue(
      pending({ action_type: "payout", requires_two: true, approved_by: "firmante-1" })
    );
    await expect(decide(ctxOf("admin", "firmante-1"), "ap-1", "approve"))
      .rejects.toThrow(/segunda firma debe ser de otra persona/);
  });

  it("una segunda persona distinta cierra la solicitud", async () => {
    tenantFindOne.mockResolvedValue(
      pending({ action_type: "payout", requires_two: true, approved_by: "firmante-1" })
    );
    await decide(ctxOf("admin", "firmante-2"), "ap-1", "approve", "Verificado");

    const payload = tenantUpdate.mock.calls[0][3];
    expect(payload.status).toBe("approved");
    expect(payload.second_approver).toBe("firmante-2");
    expect(payload.approved_by).toBeUndefined();
  });

  it("una aprobación de firma simple se cierra en un paso", async () => {
    tenantFindOne.mockResolvedValue(pending());
    await decide(ctxOf("manager"), "ap-1", "approve");

    const payload = tenantUpdate.mock.calls[0][3];
    expect(payload.status).toBe("approved");
    expect(payload.approved_by).toBe("me");
  });

  it("toda decisión queda registrada en auditoría", async () => {
    tenantFindOne.mockResolvedValue(pending());
    await decide(ctxOf("manager"), "ap-1", "reject", "No procede");

    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      companyId: "org-1", userId: "me",
      action: "approval_rejected", entityType: "approval_request", entityId: "ap-1",
      severity: "critical",
    }));
  });
});

describe("approvals — umbrales", () => {
  it("solo pide aprobación por encima del límite", () => {
    expect(needsApproval("refund", 50)).toBe(false);
    expect(needsApproval("refund", 500)).toBe(true);
    // Sin umbral configurado, siempre requiere aprobación.
    expect(needsApproval("void_sale", 1)).toBe(true);
  });
});
