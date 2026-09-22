"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { describeAuthError } from "@/lib/auth-errors";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/dashboard";

  // Un SSO de MembeGo rechazado aterriza aquí con el motivo GRUESO; el detalle
  // exacto queda en el log del servidor, nunca en el navegador.
  const ssoError = searchParams.get("error") === "membego"
    ? {
        token: "El enlace desde MembeGo caducó o no es válido. Vuelve a abrir Park & Tours desde MembeGo.",
        vinculo: "Esta empresa de MembeGo aún no está vinculada. Pide a un administrador que entre primero desde MembeGo.",
        cuenta: "Tu cuenta no puede entrar por este acceso. Consulta con el administrador de tu empresa.",
        sesion: "No se pudo abrir la sesión. Inténtalo de nuevo en unos minutos.",
      }[searchParams.get("motivo") || "sesion"] || "No se pudo completar el acceso desde MembeGo."
    : "";

  // Un enlace de correo ya usado o caducado vuelve aquí: decirlo evita que la
  // persona repita el mismo enlace tres veces creyendo que falla la red.
  const linkError = {
    enlace_invalido: "Ese enlace ya se usó. Pide uno nuevo desde «¿La olvidaste?».",
    enlace_vencido: "El enlace caducó. Pide uno nuevo desde «¿La olvidaste?».",
  }[searchParams.get("error") || ""] || "";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(linkError);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { signIn } = await import("@/lib/auth-client");
      const normalizedEmail = email.trim().toLowerCase();
      const result = await signIn.email({
        email: normalizedEmail,
        password,
      });

      if (result.error) {
        // El detalle crudo queda en la consola para quien administra; a quien
        // está delante se le enseña lo que se sabe, no una causa inventada.
        console.error("Login error:", result.error);
        setError(describeAuthError(result.error)?.message || "No se pudo iniciar sesión.");
        setLoading(false);
        return;
      }

      // If we get here, login was successful
      // Wait a bit for cookie to be set, then do a full page reload
      setTimeout(() => {
        window.location.href = redirect;
      }, 300);
    } catch (err: any) {
      // Aquí no hubo respuesta: red caída, o el cliente sin configurar. El
      // mensaje del navegador («Failed to fetch») no le dice nada a nadie.
      console.error("Login error:", err);
      setError(describeAuthError({ message: err?.message })?.message || "No se pudo iniciar sesión.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-background to-muted/20">
      <Card className="w-full max-w-md shadow-xl border-2">
        <CardHeader className="space-y-2 text-center pb-6">
          <CardTitle className="text-3xl font-bold tracking-tight">Bienvenido de nuevo</CardTitle>
          <CardDescription className="text-base">
            Introduce tu email y contraseña para acceder a tu cuenta
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-5">
            {error && (
              <Alert variant="destructive" className="animate-in fade-in slide-in-from-top-2">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {!error && ssoError && (
              <Alert variant="destructive" className="animate-in fade-in slide-in-from-top-2">
                <AlertDescription>{ssoError}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-semibold">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="tu@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-11 transition-all focus:ring-2"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="password" className="text-sm font-semibold">Contraseña</Label>
                {/* Va aquí, junto al campo, y no al pie: es donde se mira
                    cuando la contraseña no entra. */}
                <Link href="/login/recuperar" className="text-xs font-medium text-primary hover:underline">
                  ¿La olvidaste?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="Introduce tu contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-11 transition-all focus:ring-2"
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col space-y-4 pt-4">
            <Button
              type="submit"
              className="w-full h-11 text-base font-semibold transition-all hover:scale-[1.02]"
              disabled={loading}
            >
              {loading ? "Entrando..." : "Entrar"}
            </Button>
            <div className="text-sm text-center text-muted-foreground">
              ¿Todavía no tienes cuenta?{" "}
              <Link href="/register" className="font-semibold text-primary hover:underline transition-colors">
                Crear cuenta
              </Link>
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-background to-muted/20">
        <Card className="w-full max-w-md shadow-xl border-2">
          <CardHeader className="space-y-2 text-center pb-6">
            <CardTitle className="text-3xl font-bold tracking-tight">Bienvenido de nuevo</CardTitle>
            <CardDescription className="text-base">Cargando...</CardDescription>
          </CardHeader>
        </Card>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
