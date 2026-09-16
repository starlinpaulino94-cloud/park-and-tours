"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { normalizeCode, isCodeComplete } from "@/lib/mfa";
import { safeNextPath } from "@/lib/team";

/**
 * EL CÓDIGO DEL SEGUNDO FACTOR.
 *
 * Aquí aterriza quien ya puso su contraseña y tiene segundo factor activo. La
 * sesión existe y no se cierra: cerrarla obligaría a escribir la contraseña otra
 * vez, y eso es lo que empuja a la gente a desactivar el segundo factor.
 *
 * La salida del paso en falso es «Salir»: quien no tenga el teléfono a mano
 * cierra sesión desde aquí, en vez de quedarse en una pantalla sin salida.
 */
export default function Page() {
  const [factorId, setFactorId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { supabaseBrowser } = await import("@/lib/supabase/client");
        const { data } = await supabaseBrowser().auth.mfa.listFactors();
        const totp = data?.totp?.find((f) => f.status === "verified") || data?.totp?.[0];
        setFactorId(totp?.id ?? null);
      } catch {
        setFactorId(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true);
    setError("");
    try {
      const { supabaseBrowser } = await import("@/lib/supabase/client");
      const { error: verifyError } = await supabaseBrowser().auth.mfa.challengeAndVerify({
        factorId,
        code: normalizeCode(code),
      });
      if (verifyError) {
        // El motivo real no se enseña: «código inválido» y «código vencido»
        // le dicen lo mismo a quien lo escribió mal y algo distinto a quien
        // está probando a ciegas.
        setError("Ese código no es válido. Mira el que aparece ahora en tu aplicación.");
        setCode("");
        setBusy(false);
        return;
      }
      // Recarga completa: el token nuevo (ya con `aal2`) tiene que llegar al
      // servidor antes de entrar, y una navegación del cliente no lo espera.
      const next = safeNextPath(new URLSearchParams(window.location.search).get("next"));
      window.location.href = next;
    } catch {
      setError("No se pudo verificar. Revisa tu conexión e inténtalo de nuevo.");
      setBusy(false);
    }
  };

  const salir = async () => {
    const { supabaseAuth } = await import("@/lib/supabase/client");
    await supabaseAuth.signOut();
    window.location.href = "/login";
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-background to-muted/20">
      <Card className="w-full max-w-md shadow-xl border-2">
        <CardHeader className="space-y-2 text-center pb-6">
          <CardTitle className="text-3xl font-bold tracking-tight">Verificación en dos pasos</CardTitle>
          <CardDescription className="text-base">
            Escribe el código de seis dígitos de tu aplicación de autenticación.
          </CardDescription>
        </CardHeader>

        {!loading && !factorId ? (
          <>
            <CardContent>
              <Alert variant="destructive">
                <AlertDescription>
                  No encontramos un segundo factor en esta cuenta. Cierra sesión y vuelve a entrar; si el
                  problema sigue, pídele a quien administra el sistema que restablezca tu verificación.
                </AlertDescription>
              </Alert>
            </CardContent>
            <CardFooter>
              <Button variant="outline" className="w-full h-11" onClick={salir}>Salir</Button>
            </CardFooter>
          </>
        ) : (
          <form onSubmit={verify}>
            <CardContent className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="code" className="text-sm font-semibold">Código</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  placeholder="000000"
                  maxLength={7}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="h-12 text-center text-2xl tracking-[0.4em] font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  El código cambia cada 30 segundos. Si acaba de cambiar, espera al siguiente.
                </p>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3 pt-4">
              <Button
                type="submit"
                className="w-full h-11 text-base font-semibold"
                disabled={busy || loading || !isCodeComplete(code)}
              >
                {busy ? "Verificando…" : "Entrar"}
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={salir}>
                No tengo el teléfono a mano — salir
              </Button>
            </CardFooter>
          </form>
        )}
      </Card>
    </div>
  );
}
