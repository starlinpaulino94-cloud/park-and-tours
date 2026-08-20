import { describe, it, expect, afterEach } from "vitest";
import { activeBackend, isSupabase, pgTable } from "@/lib/data-backend";

const original = process.env.DATA_BACKEND;
afterEach(() => { process.env.DATA_BACKEND = original; });

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
});
