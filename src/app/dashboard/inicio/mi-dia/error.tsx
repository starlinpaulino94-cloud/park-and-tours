"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";

/**
 * Error total del módulo: solo se llega aquí si falla algo fuera de las
 * secciones (contexto de empresa, sesión vencida). Los fallos parciales de
 * tareas o aprobaciones se resuelven dentro de cada sección para que una nunca
 * tumbe a la otra.
 */
export default function MyDayError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[mi-dia] error no controlado:", error);
  }, [error]);

  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl font-semibold leading-tight sm:text-[28px]">Mi día</h1>

      <div
        role="alert"
        className="rounded-xl border border-destructive/50 bg-destructive/5 p-5"
      >
        <div className="flex items-start gap-3">
          <Icon name="TriangleAlert" className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
          <div className="min-w-0 space-y-3">
            <div>
              <p className="font-semibold">No se pudo cargar tu día.</p>
              <p className="text-sm text-muted-foreground">
                Si la sesión venció, vuelve a iniciarla. Si el problema continúa, avisa al administrador.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => reset()}>Reintentar</Button>
              <Button variant="outline" asChild>
                <Link href="/login">Iniciar sesión de nuevo</Link>
              </Button>
            </div>
            {error.digest && (
              <p className="text-xs text-muted-foreground">Referencia: {error.digest}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
