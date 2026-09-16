import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { safeNextPath } from "@/lib/team";

/**
 * GET /auth/callback — donde aterriza quien llega desde un correo.
 *
 * Sirve a los dos caminos que empiezan fuera del sistema: la invitación de un
 * compañero y el «olvidé mi contraseña». Los dos traen un código de un solo uso
 * que aquí se cambia por sesión, y desde aquí se sigue a poner la contraseña.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ACEPTAR LA INVITACIÓN ES ESTE PASO
 *
 * La membresía nace `pending` —una invitación no es un acceso: si el correo
 * acaba en la bandeja equivocada, quien lo reciba no entra a nada—. Se activa
 * aquí, y solo la del usuario que ACABA de demostrar que controla ese correo.
 * Hacerlo al invitar habría dado acceso a una dirección sin verificar; hacerlo
 * al primer inicio de sesión lo habría dejado fuera de su propia empresa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A DÓNDE SE VUELVE
 *
 * `next` se acota a rutas internas. Sin esa comprobación, un enlace con
 * `next=https://sitio-ajeno` convertiría este dominio en un trampolín: el
 * usuario ve la dirección de su sistema, y acaba en otra parte con la sesión
 * recién creada.
 *
 * La comprobación vive en `safeNextPath` (probada contra las tres formas de
 * escaparse, incluida `/\otro.com`, que resuelve a otro dominio aunque empiece
 * por barra), y aquí se cierra la puerta por segunda vez comparando el origen
 * de la URL ya construida. Dos cierres para lo mismo, porque del otro lado hay
 * una sesión recién creada en manos ajenas.
 */
function destination(next: string, origin: string): URL {
  const url = new URL(safeNextPath(next), origin);
  return url.origin === origin ? url : new URL("/dashboard", origin);
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/dashboard";

  if (!code) {
    // Sin código no hay nada que canjear. Puede ser un enlace ya usado o uno
    // caducado, y el mensaje lo dice en vez de dejar una pantalla en blanco.
    return NextResponse.redirect(new URL("/login?error=enlace_invalido", url.origin));
  }

  const sb = await supabaseServer();
  const { data, error } = await sb.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return NextResponse.redirect(new URL("/login?error=enlace_vencido", url.origin));
  }

  // Aceptada: las invitaciones pendientes de ESTE usuario pasan a activas.
  try {
    await supabaseService()
      .from("organization_memberships")
      .update({ status: "active" })
      .eq("user_id", data.user.id)
      .eq("status", "pending");
  } catch (err) {
    // La sesión ya existe y es válida: no se le cierra la puerta en la cara por
    // esto. Sin membresía activa caerá en el onboarding, que es recuperable.
    console.error("[auth/callback] no se pudo activar la invitación:", err);
  }

  return NextResponse.redirect(destination(next, url.origin));
}
