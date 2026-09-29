"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Reporta a Sentry (no-op sin DSN) y deja el detalle en consola.
    Sentry.captureException(error);
    console.error("[Error Boundary] Error caught:", error);
    if (error.digest) {
      console.error("[Error Boundary] Digest:", error.digest);
    }
  }, [error]);

  /*
   * LO QUE ESTA PANTALLA NO ENSEÑA, A PROPÓSITO.
   *
   * Ni el mensaje, ni el stack, ni herramientas internas: el detalle técnico
   * es para quien abre la consola, no para quien estaba usando el sistema.
   * El digest queda abajo porque es lo único que sirve para REPORTAR el fallo
   * — y no revela nada por sí solo.
   */
  return (
    <div className="flex min-h-[400px] w-full items-center justify-center p-4">
      <div className="w-full max-w-md rounded-lg border border-red-200 bg-red-50 p-6 shadow-sm dark:border-red-900 dark:bg-red-950/30">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/50">
            <svg
              className="h-5 w-5 text-red-600 dark:text-red-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-red-800 dark:text-red-200">
              Algo salió mal
            </h2>
            <p className="text-sm text-red-600 dark:text-red-400">
              Ocurrió un error inesperado en esta sección. Tus datos están a salvo.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={() => reset()}
            className="w-full rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
          >
            Intentar de nuevo
          </button>
          <button
            onClick={() => window.history.back()}
            className="w-full rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:border-red-800 dark:bg-transparent dark:text-red-300 dark:hover:bg-red-900/30"
          >
            Volver atrás
          </button>
        </div>

        {error.digest && (
          <p className="mt-4 text-center text-[11px] text-red-400">
            Si contactas a soporte, menciona el código: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
