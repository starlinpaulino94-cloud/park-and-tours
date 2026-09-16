"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * RECUPERAR LA CONTRASEÑA.
 *
 * La función existía en el cliente desde el principio y NADA la llamaba: quien
 * olvidaba su contraseña tenía que pedirle al administrador que le pusiera una
 * nueva y se la dijera por chat. Es decir, olvidar la contraseña obligaba a
 * compartirla — justo lo contrario de lo que hace falta.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA RESPUESTA ES LA MISMA EXISTA O NO LA CUENTA
 *
 * Decir «ese correo no está registrado» convierte esta pantalla en un detector
 * de clientes: cualquiera puede probar direcciones y averiguar quién usa el
 * sistema. Se contesta siempre lo mismo, y quien no reciba nada sabrá que
 * escribió otra dirección.
 */
export default function Page() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { supabaseAuth } = await import("@/lib/supabase/client");
      const redirectTo = `${window.location.origin}/auth/callback?next=/auth/establecer-clave`;
      await supabaseAuth.resetPassword(email.trim().toLowerCase(), redirectTo);
      // No se mira el resultado a propósito: un "usuario no encontrado" aquí
      // sería exactamente la fuga que esta pantalla evita.
      setSent(true);
    } catch {
      // Solo un fallo de red llega hasta aquí.
      setError("No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-background to-muted/20">
      <Card className="w-full max-w-md shadow-xl border-2">
        <CardHeader className="space-y-2 text-center pb-6">
          <CardTitle className="text-3xl font-bold tracking-tight">Recuperar acceso</CardTitle>
          <CardDescription className="text-base">
            {sent
              ? "Si ese correo tiene cuenta, el enlace ya va en camino."
              : "Te mandamos un enlace para poner una contraseña nueva."}
          </CardDescription>
        </CardHeader>

        {sent ? (
          <>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                Revisa tu bandeja de entrada y la carpeta de correo no deseado. El enlace sirve una sola vez y
                caduca en una hora.
              </p>
              <p>
                ¿No llega? Puede que la dirección sea otra, o que tu cuenta la administre tu empresa: pídele a
                quien administra el sistema que te reenvíe la invitación.
              </p>
            </CardContent>
            <CardFooter>
              <Button asChild variant="outline" className="w-full h-11">
                <Link href="/login">Volver a entrar</Link>
              </Button>
            </CardFooter>
          </>
        ) : (
          <form onSubmit={submit}>
            <CardContent className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-semibold">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="tu@empresa.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-11"
                />
              </div>
            </CardContent>
            <CardFooter className="flex flex-col space-y-4 pt-4">
              <Button type="submit" className="w-full h-11 text-base font-semibold" disabled={busy}>
                {busy ? "Enviando…" : "Enviarme el enlace"}
              </Button>
              <div className="text-sm text-center text-muted-foreground">
                <Link href="/login" className="font-semibold text-primary hover:underline">
                  Volver a entrar
                </Link>
              </div>
            </CardFooter>
          </form>
        )}
      </Card>
    </div>
  );
}
