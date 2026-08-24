import { describe, it, expect, afterEach, vi } from "vitest";
import { activeBackend, assertSafeDataBackendConfig, configuredDataBackend, isSupabase, pgTable } from "@/lib/data-backend";

const originalRls = process.env.SUPABASE_USE_RLS;

afterEach(() => {
  vi.unstubAllEnvs();
  process.env.SUPABASE_USE_RLS = originalRls;
});

describe("data backend", () => {
  it("is always Supabase", () => {
    expect(configuredDataBackend()).toBe("supabase");
    expect(activeBackend()).toBe("supabase");
    expect(isSupabase()).toBe(true);
  });

  it("maps renamed tables and passes others through", () => {
    expect(pgTable("company")).toBe("organizations");
    expect(pgTable("booking")).toBe("booking");
    expect(pgTable("order")).toBe("sales_order");
  });

  it("rejects production Supabase access without RLS", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.SUPABASE_USE_RLS;

    expect(() => assertSafeDataBackendConfig()).toThrow("Unsafe production config");
    expect(() => activeBackend()).toThrow("Unsafe production config");
  });

  it("allows production when RLS is enabled", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.SUPABASE_USE_RLS = "true";

    expect(activeBackend()).toBe("supabase");
  });
});
