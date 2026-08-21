import { afterEach, describe, expect, it, vi } from "vitest";
import { allowedMutationOrigins, assertSameOriginMutation } from "@/lib/csrf";

describe("csrf origin guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows the configured app origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    const req = new Request("https://api.example.com/api/payments", {
      headers: { origin: "https://app.example.com" },
    });

    expect(() => assertSameOriginMutation(req)).not.toThrow();
  });

  it("rejects cross-site origins in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    const req = new Request("https://api.example.com/api/payments", {
      headers: { origin: "https://evil.example" },
    });

    expect(() => assertSameOriginMutation(req)).toThrow("Origen de la solicitud no permitido");
  });

  it("includes the request host as an allowed origin", () => {
    const req = new Request("https://tenant.example.com/api/payments", {
      headers: { host: "tenant.example.com", "x-forwarded-proto": "https" },
    });
    expect(allowedMutationOrigins(req).has("https://tenant.example.com")).toBe(true);
  });
});
