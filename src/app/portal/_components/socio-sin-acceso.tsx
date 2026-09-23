"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut as authSignOut } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import type { MotivoSocio } from "@/lib/partner-lifecycle";

/**
 * EL MURO CON PALABRAS.
 *
 * La API rechaza al socio no operativo con un 403; esta pantalla es la otra
 * mitad de esa decisión. Sin ella, quien trabaja en un tour center pendiente
 * de activación escribe una contraseña correcta y se encuentra un portal que
 * falla en cada recuadro sin decir por qué: llamaría a la operadora para
 * reportar una avería que no existe.
 *
 * Lo único que ofrece es salir, porque no hay ninguna otra acción que dependa
 * de él. Un botón de «reintentar» fingiría que sí.
 */
export function SocioSinAcceso({ motivo, mensaje }: { motivo: MotivoSocio; mensaje: string }) {
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);

  const salir = async () => {
    setSaliendo(true);
    try {
      await authSignOut();
      router.push("/login");
      router.refresh();
    } catch {
      setSaliendo(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center">
        <h1 className="font-display text-xl font-semibold tracking-tight">
          {motivo === "pendiente" ? "Tu acceso está en camino" : "Acceso desactivado"}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{mensaje}</p>
        <Button variant="outline" className="mt-6" onClick={salir} disabled={saliendo}>
          Cerrar sesión
        </Button>
      </div>
    </main>
  );
}
