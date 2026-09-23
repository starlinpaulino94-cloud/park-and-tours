import { describe, it, expect, vi } from "vitest";

// auth-context imports server-only supabase clients at module load; stub them so
// the pure helpers (decodeJwtClaims, mapClaimsToContext) can be imported.
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ supabaseService: vi.fn() }));

import { decodeJwtClaims, mapClaimsToContext } from "@/lib/supabase/auth-context";
import { ROLES, rankOf } from "@/lib/roles";

function makeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64({ alg: "HS256" })}.${b64(payload)}.signature`;
}

const user = { id: "u1", email: "a@x.com", name: "Ana" };

describe("auth-context — decodeJwtClaims", () => {
  it("decodes the payload of a JWT (base64url)", () => {
    const token = makeJwt({ org_id: "org1", app_role: "manager", status: "active" });
    const claims = decodeJwtClaims(token);
    expect(claims.org_id).toBe("org1");
    expect(claims.app_role).toBe("manager");
  });

  it("returns {} for a malformed token", () => {
    expect(decodeJwtClaims("garbage")).toEqual({});
    expect(decodeJwtClaims("")).toEqual({});
  });
});

describe("auth-context — mapClaimsToContext", () => {
  it("builds a context from active claims", () => {
    const ctx = mapClaimsToContext(
      { org_id: "org1", app_role: "manager", status: "active", partner_id: null }, user, null);
    expect(ctx).toMatchObject({ userId: "u1", companyId: "org1", role: "manager", partnerId: null });
  });

  it("returns null without an org (no active membership)", () => {
    expect(mapClaimsToContext({ app_role: "owner" }, user, null)).toBeNull();
  });

  it("denies a deactivated user (AUD-S02)", () => {
    expect(mapClaimsToContext({ org_id: "org1", status: "inactive" }, user, null)).toBeNull();
  });

  it("carries the partner_id for B2B users", () => {
    const ctx = mapClaimsToContext(
      { org_id: "org1", app_role: "partner", partner_id: "p9", status: "active" }, user, null);
    expect(ctx?.role).toBe("partner");
    expect(ctx?.partnerId).toBe("p9");
  });

  it("un rol desconocido cae al rango MÁS BAJO, no a vendedor", () => {
    /**
     * Esta prueba decía `seller`, y eso era el fallo, no la prueba.
     *
     * La lista de roles válidos se escribía a mano aquí, y lo que hacía con lo
     * que no reconocía no era rechazarlo: lo convertía en `seller`. Es decir,
     * añadir un rol a la base sin acordarse de esa línea no dejaba fuera a ese
     * actor — lo ASCENDÍA al rango 20, el que abre las veintiuna rutas que
     * exigen vendedor. Un proveedor habría entrado a cotizar, a cobrar y a
     * cancelar reservas, y nada habría fallado por el camino.
     *
     * Ahora la lista sale de la tabla de rango y lo desconocido cae al último:
     * si alguien se queda fuera se ve el primer día; al revés no se ve nunca.
     */
    const ctx = mapClaimsToContext({ org_id: "org1", app_role: "hacker", status: "active" }, user, null);
    expect(ctx?.role).toBe("supplier");
    expect(rankOf(ctx?.role), "el último de la lista es el que menos puede")
      .toBe(Math.min(...ROLES.map((r) => rankOf(r))));
  });

  it("y el proveedor entra con su identificador, no con su nombre de rol", () => {
    const ctx = mapClaimsToContext(
      { org_id: "org1", app_role: "supplier", supplier_id: "s9", status: "active" }, user, null
    );
    expect(ctx?.role).toBe("supplier");
    expect(ctx?.supplierId).toBe("s9");
    // Y sin ficha no es proveedor de nadie: nulo acota a nada, no abre.
    const sinFicha = mapClaimsToContext(
      { org_id: "org1", app_role: "supplier", status: "active" }, user, null
    );
    expect(sinFicha?.supplierId).toBeNull();
  });
});
