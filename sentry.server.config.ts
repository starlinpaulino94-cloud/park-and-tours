/**
 * Sentry — inicialización del runtime de servidor (Node). La carga el hook
 * `register()` de instrumentation.ts cuando NEXT_RUNTIME === 'nodejs'.
 *
 * Sin DSN queda DESACTIVADO (no-op): builds y entornos sin credenciales no envían
 * nada. Sin PII por defecto — es un ERP multi-tenant con datos sensibles.
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || process.env.NODE_ENV,
  release: process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA,
  // Solo errores por defecto; el tracing de performance se activa vía env.
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
  sendDefaultPii: false,
});
