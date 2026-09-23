import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TenantContext } from "@/lib/tenant";

/**
 * EL VETO, EN EL SITIO POR EL QUE PASA TODO.
 *
 * `partner-lifecycle.test.ts` comprueba que la REGLA contesta bien. Esto
 * comprueba que está enchufada: una función que decide correctamente y a la
 * que nadie llama es exactamente el estado en el que estaba `pending` antes de
 * esta entrega.
 */

let contexto: TenantContext | null = null;

vi.mock("@/lib/supabase/auth-context", () => ({
  getSupabaseTenantContext: async () => contexto,
}));

const { requireTenant } = await import("@/lib/tenant");

const socio = (partnerStatus: string | null): TenantContext => ({
  userId: "u-1", email: "reservas@tourcenter.test", name: "Reservas",
  role: "partner", companyId: "op-1", partnerId: "soc-1",
  isPartnerMember: true, partnerStatus, company: null,
});

beforeEach(() => { contexto = null; });

describe("requireTenant veta al socio que no puede operar", () => {
  it("el socio activo pasa", async () => {
    contexto = socio("active");
    await expect(requireTenant()).resolves.toMatchObject({ partnerId: "soc-1" });
  });

  it("el pendiente de activación no pasa, y el error se distingue de un permiso", async () => {
    /**
     * El `code` importa tanto como el rechazo: la pantalla del portal necesita
     * poder separar «tu empresa aún no está activa» de «no tienes permiso para
     * esto», porque son dos conversaciones con dos personas distintas.
     */
    contexto = socio("pending");
    await expect(requireTenant()).rejects.toMatchObject({
      status: 403, code: "PARTNER_INACTIVE",
    });
  });

  it("y tampoco el suspendido ni aquel cuyo estado no se pudo leer", async () => {
    for (const estado of ["suspended", "inactive", "blocked", ""]) {
      contexto = socio(estado);
      await expect(requireTenant(), estado).rejects.toMatchObject({ status: 403 });
    }
  });

  it("al personal interno no le afecta", async () => {
    // Sin identificador de socio no hay ninguna organización cuyo estado
    // mirar, y un `partnerStatus` vacío no puede dejar fuera a la operadora de
    // su propio ERP: ese sería el fallo simétrico, y bastante peor.
    contexto = {
      userId: "u-2", email: "admin@operadora.test", name: "Admin",
      role: "admin", companyId: "op-1", partnerId: null,
      isPartnerMember: false, company: null,
    };
    await expect(requireTenant()).resolves.toMatchObject({ role: "admin" });
  });
});
