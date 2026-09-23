import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TenantContext } from "@/lib/tenant";

/**
 * NINGÚN TOUR CENTER PODÍA ENTRAR, Y NADIE LO SABÍA.
 *
 * El formulario de Configuración → Equipo pedía «Tour center» desde el
 * principio y lo enviaba. `/api/team` no contenía la palabra `partner_id` en
 * NINGUNA línea: lo descartaba y creaba la membresía sobre la operadora. Como
 * el identificador de socio solo se emite cuando la organización de la
 * membresía es de tipo socio, ese usuario llegaba al portal sin socio y recibía
 * 403.
 *
 * El administrador creía haberle dado acceso a su tour center. Lo que había
 * creado era un usuario más de su propia empresa — con el rol que fuera.
 */

let organizacion: Record<string, unknown> | null = null;

vi.mock("@/lib/supabase/service", () => ({
  supabaseService: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: organizacion, error: null }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/plan-service", () => ({ assertWithinLimit: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));

const { resolveMembershipOrg } = await import("@/lib/team-invite");

const ctx = { companyId: "op-1", role: "admin", email: "a@x.com", userId: "u1" } as unknown as
  TenantContext & { companyId: string };

beforeEach(() => { organizacion = null; });

describe("de dónde cuelga la membresía", () => {
  it("sin tour center, de la operadora y con el rol pedido", async () => {
    const d = await resolveMembershipOrg(ctx, null, "manager");
    expect(d).toEqual({ organizationId: "op-1", role: "manager", esSocio: false });
  });

  it("con tour center, de ESE socio", async () => {
    organizacion = { id: "soc-1", kind: "partner", tenant_org_id: "op-1", status: "active" };
    const d = await resolveMembershipOrg(ctx, "soc-1", "manager");
    expect(d.organizationId).toBe("soc-1");
    expect(d.esSocio).toBe(true);
  });

  it("EL CERROJO: el rol se fuerza a socio", async () => {
    /**
     * Mientras el aislamiento siga decidiéndose por el NOMBRE del rol —repetido
     * en veintinueve sitios—, un empleado de un tour center dado de alta como
     * `seller` o `cashier` entraría al ERP INTERNO de la operadora: tendría
     * identificador de socio, que sí se emite, y un rol que ninguna de esas
     * condiciones reconoce.
     *
     * Una línea, y permite arreglar la puerta sin esperar a las veintinueve.
     */
    organizacion = { id: "soc-1", kind: "partner", tenant_org_id: "op-1", status: "active" };
    for (const pedido of ["owner", "admin", "manager", "cashier", "seller"] as const) {
      const d = await resolveMembershipOrg(ctx, "soc-1", pedido);
      expect(d.role, `pidiendo ${pedido}`).toBe("partner");
    }
  });
});

describe("las dos comprobaciones", () => {
  it("tiene que ser un SOCIO, no una organización cualquiera", async () => {
    // Colgarla de algo que no es socio no emite identificador de socio: el
    // usuario acabaría en el ERP interno creyendo todos que está en el portal.
    organizacion = { id: "otra", kind: "tenant", tenant_org_id: "otra", status: "active" };
    await expect(resolveMembershipOrg(ctx, "otra", "manager")).rejects.toThrow(/no es una empresa asociada/);
  });

  it("y tiene que ser DE ESTA OPERADORA", async () => {
    /**
     * Es la que de verdad importa. Los identificadores son uuid y el formulario
     * los manda tal cual: sin esta comprobación, un administrador engancha a
     * alguien a un socio de OTRA operadora y ese usuario sale con la empresa
     * equivocada en el token. No es un error de escritura — es cruzar el
     * aislamiento entre inquilinos por el único sitio donde se puede.
     */
    organizacion = { id: "soc-ajeno", kind: "partner", tenant_org_id: "op-2", status: "active" };
    await expect(resolveMembershipOrg(ctx, "soc-ajeno", "manager")).rejects.toThrow(/no es de tu empresa/);
  });

  it("un socio inactivo no recibe accesos nuevos", async () => {
    organizacion = { id: "soc-1", kind: "partner", tenant_org_id: "op-1", status: "inactive" };
    await expect(resolveMembershipOrg(ctx, "soc-1", "manager")).rejects.toThrow(/inactivo/);
  });

  it("un tour center que no existe se rechaza igual que uno ajeno", async () => {
    organizacion = null;
    await expect(resolveMembershipOrg(ctx, "no-existe", "manager")).rejects.toThrow(/no existe/);
  });
});
