import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: vi.fn() }));

import { safeName, objectPath, partnerObjectPath, assertUploadable, MAX_FILE_BYTES } from "@/lib/supabase/storage";

describe("storage — path building (tenant isolation)", () => {
  it("prefixes org-wide paths with the organization id", () => {
    expect(objectPath("org1", "settlements", "s9", "report.pdf")).toBe("org1/settlements/s9/report.pdf");
  });

  it("prefixes partner paths with org + partner id", () => {
    expect(partnerObjectPath("org1", "p7", "contracts", "c.pdf")).toBe("org1/partners/p7/contracts/c.pdf");
  });

  it("sanitises filenames and strips path traversal", () => {
    expect(safeName("../../etc/passwd")).toBe("passwd");
    expect(safeName("my file (1).pdf")).toBe("my_file__1_.pdf");
    expect(objectPath("org1", "x", "1", "../../../secret")).toBe("org1/x/1/secret");
  });
});

describe("storage — upload validation", () => {
  it("rejects files over the size limit", () => {
    expect(() => assertUploadable({ size: MAX_FILE_BYTES + 1, type: "application/pdf" })).toThrow();
  });
  it("rejects disallowed mime types", () => {
    expect(() => assertUploadable({ size: 10, type: "application/x-msdownload" })).toThrow();
  });
  it("accepts an allowed pdf within the limit", () => {
    expect(() => assertUploadable({ size: 1000, type: "application/pdf" })).not.toThrow();
  });
});
