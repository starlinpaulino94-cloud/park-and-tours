"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { passwordIssue, MIN_PASSWORD } from "@/lib/team";

/**
 * ESTABLECER LA CONTRASEÑA.
 *
 * Aquí llega quien acepta una invitación y quien recuperó su acceso. Los dos
 * vienen de `/auth/callback`, que ya canjeó el código por sesión: esta pantalla
 * solo tiene que dejarles poner una contraseña que nadie más ha visto.
 *
 * Comprueba que la sesión exista antes de enseñar el formulario. Sin eso, quien
 * abre un enlace caducado rellena el formulario, pulsa y recibe un error del
 * servidor — habiendo escrito ya su contraseña nueva dos veces.
 */
export default function Page() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { supabaseBrowser } = await import("@/lib/supabase/client");
        const { data } = await supabaseBrowser().auth.getUser();
        setEmail(data.user?.email || "");
        setReady(Boolean(data.user));
      } catch {
        setReady(false);
      }
    })();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const issue = passwordIssue(password, confirmation);
    if (issue) {
      setError(issue);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { supabaseBrowser } = await import("@/lib/supabase/client");
      const { error: updateError } = await supabaseBrowser().auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        setBusy(false);
        return;
      }
      // Recarga completa: el resto del sistema lee la sesión del servidor, y
      // una navegación del cliente entraría antes de que la cookie esté puesta.
      window.location.href = "/dashboard";
    } catch {
      setError("No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.");
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-background to-muted/20">
      <Card className="w-full max-w-md shadow-xl border-2">
        <CardHeader className="space-y-2 text-center pb-6">
          <CardTitle className="text-3xl font-bold tracking-tight">Tu contraseña</CardTitle>
          <CardDescription className="text-base">
            {email ? `Para la cuenta ${email}` : "Elige la contraseña con la que entrarás"}
          </CardDescription>
        </CardHeader>

        {ready === false ? (
          <>
            <CardContent>
              <Alert variant="destructive">
                <AlertDescription>
                  Este enlace ya se usó o caducó. Pide uno nuevo desde «¿La olvidaste?» en la pantalla de
                  entrada, o pídele a quien administra el sistema que te reenvíe la invitación.
                </AlertDescription>
              </Alert>
            </CardContent>
            <CardFooter>
              <Button asChild variant="outline" className="w-full h-11">
                <a href="/login">Ir a la pantalla de entrada</a>
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
                <Label htmlFor="password" className="text-sm font-semibold">Contraseña nueva</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-11"
                />
                <p className="text-xs text-muted-foreground">
                  Al menos {MIN_PASSWORD} caracteres. Nadie más la verá: ni quien te invitó.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmation" className="text-sm font-semibold">Repítela</Label>
                <Input
                  id="confirmation"
                  type="password"
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  required
                  className="h-11"
                />
              </div>
            </CardContent>
            <CardFooter className="pt-4">
              <Button type="submit" className="w-full h-11 text-base font-semibold" disabled={busy || ready === null}>
                {busy ? "Guardando…" : ready === null ? "Comprobando el enlace…" : "Guardar y entrar"}
              </Button>
            </CardFooter>
          </form>
        )}
      </Card>
    </div>
  );
}
