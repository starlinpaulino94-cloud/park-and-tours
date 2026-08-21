import { describe, it, expect, afterEach, vi } from "vitest";
import { activeBackend, assertSafeDataBackendConfig, isSupabase, pgTable } from "@/lib/data-backend";

const original = process.env.DATA_BACKEND;
const originalRls = process.env.SUPABASE_USE_RLS;
afterEach(() => {
  vi.unstubAllEnvs();
  process.env.DATA_BACKEND = original;
  process.env.SUPABASE_USE_RLS = originalRls;
});

describe("data-backend switch", () => {
  it("defaults to totalum (safe default — never silently switch)", () => {
    delete process.env.DATA_BACKEND;
    expect(activeBackend()).toBe("totalum");
    expect(isSupabase()).toBe(false);
  });

  it("only switches on the exact value 'supabase'", () => {
    process.env.DATA_BACKEND = "supabase";
    expect(activeBackend()).toBe("supabase");
    process.env.DATA_BACKEND = "SUPABASE";     // wrong case → stays totalum
    expect(activeBackend()).toBe("totalum");
    process.env.DATA_BACKEND = "postgres";      // unknown → stays totalum
    expect(activeBackend()).toBe("totalum");
  });

  it("maps renamed tables and passes others through", () => {
    expect(pgTable("company")).toBe("organizations");
    expect(pgTable("booking")).toBe("booking");
    // `order` is a reserved SQL word → Postgres table is `sales_order`.
    expect(pgTable("order")).toBe("sales_order");
  });

  it("rejects Supabase service-role data backend in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.DATA_BACKEND = "supabase";
    delete process.env.SUPABASE_USE_RLS;

    expect(() => assertSafeDataBackendConfig()).toThrow("Unsafe production config");
    expect(() => activeBackend()).toThrow("Unsafe production config");
  });

  it("allows Supabase data backend in production only when RLS is enabled", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.DATA_BACKEND = "supabase";
    process.env.SUPABASE_USE_RLS = "true";

    expect(activeBackend()).toBe("supabase");
  });
});
