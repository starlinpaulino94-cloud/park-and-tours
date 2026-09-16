"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/tf/icon";
import { Pill } from "@/components/tf/status-badge";
import { passwordIssue, MIN_PASSWORD } from "@/lib/team";
import { normalizeCode, isCodeComplete, factorLabel } from "@/lib/mfa";

/**
 * SEGURIDAD DE LA CUENTA: la contraseña y el segundo factor.
 *
 * Esta tarjeta decía, literalmente, que el cambio de contraseña «todavía no está
 * habilitado en producción». Lo estaba a medias: la función existía en el
 * cliente y ninguna pantalla la llamaba, así que cambiarla exigía pedirle al
 * administrador que pusiera otra y la dijera por chat.
 *
 * El segundo factor es voluntario y, en cuanto se activa, obligatorio: desde ese
 * momento una sesión que solo pasó la contraseña no entra a ninguna parte. Eso
 * se exige en el servidor (`requireTenant`), no aquí.
 */
export function Seguridad({ email }: { email: string }) {
  /* ------------------------------------------------------- contraseña */
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const issue = passwordIssue(password, confirmation);
    if (issue) { toast.error(issue); return; }
    setSavingPassword(true);
    try {
      const { supabaseBrowser } = await import("@/lib/supabase/client");
      const { error } = await supabaseBrowser().auth.updateUser({ password });
      if (error) { toast.error(error.message); return; }
      setPassword("");
      setConfirmation("");
      toast.success("Contraseña actualizada. Se mantiene tu sesión en este equipo.");
    } finally {
      setSavingPassword(false);
    }
  };

  /* --------------------------------------------------- segundo factor */
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [enrolling, setEnrolling] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const loadFactors = useCallback(async () => {
    try {
      const { supabaseBrowser } = await import("@/lib/supabase/client");
      const { data } = await supabaseBrowser().auth.mfa.listFactors();
      setEnabled((data?.totp || []).some((f) => f.status === "verified"));
    } catch {
      setEnabled(false);
    }
  }, []);

  useEffect(() => { loadFactors(); }, [loadFactors]);

  /** Avisa al servidor de que copie la realidad a la marca del token. */
  const sync = async () => {
    const res = await api.post<{ mfaEnabled: boolean }>("/api/account/mfa", {});
    if (res.ok && res.data) setEnabled(res.data.mfaEnabled);
    // El token lleva la marca: sin renovarlo, el servidor seguiría viendo el
    // estado anterior hasta la siguiente renovación automática.
    const { supabaseBrowser } = await import("@/lib/supabase/client");
    await supabaseBrowser().auth.refreshSession();
  };

  const startEnroll = async () => {
    setBusy(true);
    try {
      const { supabaseBrowser } = await import("@/lib/supabase/client");
      const sb = supabaseBrowser();
      // Un enrolamiento anterior sin confirmar bloquea el nuevo: se limpia.
      const { data: existing } = await sb.auth.mfa.listFactors();
      for (const factor of existing?.totp || []) {
        if (factor.status !== "verified") await sb.auth.mfa.unenroll({ factorId: factor.id });
      }
      const { data, error } = await sb.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: factorLabel(email),
      });
      if (error || !data) { toast.error(error?.message || "No se pudo empezar"); return; }
      setEnrolling({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    } finally {
      setBusy(false);
    }
  };

  const confirmEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrolling) return;
    setBusy(true);
    try {
      const { supabaseBrowser } = await import("@/lib/supabase/client");
      const { error } = await supabaseBrowser().auth.mfa.challengeAndVerify({
        factorId: enrolling.factorId,
        code: normalizeCode(code),
      });
      if (error) {
        toast.error("Ese código no es válido. Mira el que aparece ahora en tu aplicación.");
        setCode("");
        return;
      }
      setEnrolling(null);
      setCode("");
      await sync();
      toast.success("Segundo factor activo. La próxima vez que entres te pediremos el código.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const { supabaseBrowser } = await import("@/lib/supabase/client");
      const sb = supabaseBrowser();
      const { data } = await sb.auth.mfa.listFactors();
      for (const factor of data?.totp || []) {
        const { error } = await sb.auth.mfa.unenroll({ factorId: factor.id });
        if (error) { toast.error(error.message); return; }
      }
      await sync();
      toast.success("Segundo factor desactivado.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 text-sm">
      {/* ----------------------------------------------------- contraseña */}
      <form onSubmit={changePassword} className="rounded-xl border border-border p-4">
        <p className="font-medium">Cambiar tu contraseña</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Al menos {MIN_PASSWORD} caracteres. Nadie más la ve: tampoco quien administra el sistema.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="new-password" className="text-xs">Contraseña nueva</Label>
            <Input
              id="new-password" type="password" autoComplete="new-password"
              value={password} onChange={(e) => setPassword(e.target.value)} className="h-10"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password-2" className="text-xs">Repítela</Label>
            <Input
              id="new-password-2" type="password" autoComplete="new-password"
              value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className="h-10"
            />
          </div>
        </div>
        <Button type="submit" size="sm" className="mt-3" disabled={savingPassword || !password}>
          {savingPassword ? "Guardando…" : "Guardar contraseña"}
        </Button>
      </form>

      {/* ------------------------------------------------- segundo factor */}
      <div className="rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-medium">
              Verificación en dos pasos
              {enabled !== null && (
                <Pill tone={enabled ? "success" : "neutral"}>{enabled ? "Activa" : "Inactiva"}</Pill>
              )}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Un código de tu teléfono además de la contraseña. Protege de lo único que pasa de verdad: que
              alguien consiga tu contraseña.
            </p>
          </div>
          {enabled === false && !enrolling && (
            <Button size="sm" onClick={startEnroll} disabled={busy}>
              <Icon name="ShieldCheck" className="size-4" /> Activar
            </Button>
          )}
          {enabled === true && (
            <Button size="sm" variant="outline" onClick={disable} disabled={busy}>
              Desactivar
            </Button>
          )}
        </div>

        {enrolling && (
          <form onSubmit={confirmEnroll} className="mt-4 space-y-3 border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">
              Escanea este código con Google Authenticator, Authy, 1Password o la aplicación que uses. Si no
              puedes escanear, escribe la clave a mano.
            </p>
            <div className="flex flex-wrap items-start gap-4">
              {/* El QR lo genera Supabase como SVG en una URL de datos. */}
              <img src={enrolling.qr} alt="Código QR para la aplicación de autenticación" className="size-40 rounded-lg bg-white p-2" />
              <div className="min-w-0 space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">Clave para escribir a mano</p>
                  <p className="break-all font-mono text-xs">{enrolling.secret}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mfa-code" className="text-xs">Código de la aplicación</Label>
                  <Input
                    id="mfa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={7}
                    placeholder="000000" value={code} onChange={(e) => setCode(e.target.value)}
                    className="h-10 w-32 text-center font-mono tracking-[0.3em]"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={busy || !isCodeComplete(code)}>
                {busy ? "Verificando…" : "Confirmar"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => { setEnrolling(null); setCode(""); }}>
                Cancelar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Guarda la clave en tu gestor de contraseñas. Si pierdes el teléfono y no la tienes, quien
              administra el sistema tendrá que restablecerte la verificación.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
