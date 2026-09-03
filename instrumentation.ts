/**
 * Next.js Instrumentation — corre antes que todo lo demás.
 *
 * Carga el backend-logger (dev/build en Node) e inicializa Sentry según el
 * runtime activo. Sentry queda desactivado sin DSN (ver sentry.*.config.ts).
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (typeof process === "undefined") return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      require("./src/lib/backend-logger");
    } catch (error) {
      console.warn("Failed to load backend logger:", error);
    }
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Reporta a Sentry los errores de renderizado en servidor (Next 15).
export const onRequestError = Sentry.captureRequestError;
