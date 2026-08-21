import { describe, it, expect, vi } from "vitest";

// auth-context imports server-only supabase clients at module load; stub them so
// the pure helpers (decodeJwtClaims, mapClaimsToContext) can be imported.
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ supabaseService: vi.fn() }));

import { decodeJwtClaims, mapClaimsToContext } from "@/lib/supabase/auth-context";

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

  it("falls back to seller for an unknown role (never trusts a bad claim)", () => {
    const ctx = mapClaimsToContext({ org_id: "org1", app_role: "hacker", status: "active" }, user, null);
    expect(ctx?.role).toBe("seller");
  });
});
