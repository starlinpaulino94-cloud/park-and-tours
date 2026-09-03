/**
 * Sentry — inicialización en el navegador (Next 15.3+ carga este archivo en el
 * cliente). Desactivado sin DSN público. Session Replay APAGADO por defecto:
 * grabaría la pantalla del usuario y podría capturar datos sensibles de tenants;
 * actívalo conscientemente por env solo si lo necesitas.
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
  tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0),
  sendDefaultPii: false,
  replaysSessionSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_REPLAY_SESSION ?? 0),
  replaysOnErrorSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_REPLAY_ONERROR ?? 0),
});

// Instrumenta las transiciones del App Router (navegación cliente).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
