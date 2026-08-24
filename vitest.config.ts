import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Unit-test config for pure business logic (pricing, commissions, codes,
 * formatting, availability). `server-only` is aliased to an empty stub so the
 * lib modules import cleanly under Node; external DB access is mocked
 * per-test with `vi.mock`.
 */
export default defineConfig({
  // Unit tests never touch CSS; skip the Tailwind v4 PostCSS pipeline, which
  // is not loadable in the Vitest/Vite context.
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: [
      { find: /^server-only$/, replacement: path.resolve(__dirname, "src/test/server-only-stub.ts") },
      { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, "src/$1") },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
    globals: true,
  },
});
