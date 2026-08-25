import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Unit-test config for pure business logic (pricing, commissions, codes,
 * formatting, availability). `server-only` is aliased to an empty stub so the
 * lib modules import cleanly under Node; external DB access is mocked
 * per-test with `vi.mock`.
 *
 * Los archivos `*.test.tsx` renderizan componentes reales y por eso corren en
 * `jsdom`; el resto sigue en `node`, que es más rápido y evita cargar un DOM
 * que la lógica pura no necesita. La zona horaria del proceso se fija en UTC
 * para reproducir el servidor de Vercel: es justamente donde fallaba el corte
 * del día de "Mi día".
 */
export default defineConfig({
  // Unit tests never touch CSS; skip the Tailwind v4 PostCSS pipeline, which
  // is not loadable in the Vitest/Vite context.
  css: { postcss: { plugins: [] } },
  // `tsconfig.json` deja el JSX en "preserve" para que lo compile Next; aquí
  // hace falta la transformación automática de React 19.
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  resolve: {
    alias: [
      { find: /^server-only$/, replacement: path.resolve(__dirname, "src/test/server-only-stub.ts") },
      { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, "src/$1") },
    ],
  },
  test: {
    environment: "node",
    environmentMatchGlobs: [["src/**/*.test.tsx", "jsdom"]],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.mjs"],
    globals: true,
  },
});
