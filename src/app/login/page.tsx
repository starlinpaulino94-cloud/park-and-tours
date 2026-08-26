"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
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

      // Check if login was successful
      if (result.error) {
        setError(
          result.error.message === "Invalid login credentials"
            ? "Email o contraseña incorrectos para este ambiente. Verifica que la cuenta exista en este proyecto."
            : result.error.message || "No se pudo iniciar sesión. Revisa tus credenciales."
        );
        setLoading(false);
        return;
      }

      // If we get here, login was successful
      // Wait a bit for cookie to be set, then do a full page reload
      setTimeout(() => {
        window.location.href = redirect;
      }, 300);
    } catch (err: any) {
      console.error("Login error:", err);
      setError(err.message || "No se pudo iniciar sesión. Revisa tus credenciales.");
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
              <Label htmlFor="password" className="text-sm font-semibold">Contraseña</Label>
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
