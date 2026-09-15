import { NextResponse, type NextRequest } from "next/server";
import { supabaseService } from "@/lib/supabase/service";
import { supabaseServer } from "@/lib/supabase/server";
import { verifyMembegoToken } from "@/lib/membego";
import {
  membegoSecret, resolveLink, consumeJti, provisionSsoUser, auditMembego,
} from "@/lib/membego-service";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * GET /sso/membego?token=… — la puerta por la que entra el equipo desde MembeGo.
 *
 * MembeGo (la plataforma de membresías del mismo dueño) pone este sistema en el
 * lanzador de aplicaciones de sus empresas del vertical de excursiones. Al
 * pulsarlo, su `/api/integraciones/abrir/park-and-tours` firma un token de 90
 * segundos con el secreto compartido y redirige aquí. Este handler:
 *
 *   1. Verifica firma y vigencia (`verifyMembegoToken`, con el vector de
 *      prueba oficial del contrato en su suite).
 *   2. Rechaza el rol CLIENTE: el contrato es explícito en que el SSO trae al
 *      EQUIPO de la empresa; los clientes finales tienen su portal en MembeGo.
 *   3. Canjea el `jti` UNA sola vez (clave primaria: el segundo canje choca).
 *   4. Resuelve el vínculo empresa MembeGo ↔ organización — el primer SSO de
 *      un administrador lo crea si su correo administra exactamente una
 *      organización local (`resolveLink`).
 *   5. Garantiza cuenta y membresía locales con el rol MAPEADO A LA BAJA
 *      (`provisionSsoUser`: un rol desconocido cae a `seller`, nunca a admin).
 *   6. Abre la sesión PROPIA con el mecanismo del enlace de correo
 *      (`generateLink` + `verifyOtp`): la cookie que queda es una sesión
 *      normal de esta plataforma; MembeGo no vuelve a intervenir.
 *
 * Los rechazos aterrizan en `/login?error=membego&motivo=<grueso>` — lo justo
 * para saber a quién le toca arreglarlo (token | vinculo | cuenta | sesion).
 * El detalle exacto va al log del servidor, nunca al navegador: este endpoint
 * acepta credenciales al portador y no debe funcionar de oráculo.
 *
 * Es ruta PÚBLICA (está en `publicRoutes` del middleware): su trabajo es crear
 * la sesión que el middleware exigiría. No lleva `assertSameOriginMutation`
 * porque es un GET de navegación que llega, por diseño, desde otro origen.
 */

type Motivo = "token" | "vinculo" | "cuenta" | "sesion";

export async function GET(req: NextRequest) {
  const rechazar = (motivo: Motivo) =>
    NextResponse.redirect(new URL(`/login?error=membego&motivo=${motivo}`, req.url));

  try {
    // Por IP y ventana corta: tolera el uso real (una persona entra una vez)
    // y frena a quien venga a probar firmas.
    assertRateLimit({ key: rateLimitKey(req, "sso-membego"), limit: 10, windowMs: 60_000 });

    const secret = membegoSecret();
    if (!secret) {
      console.error("[sso/membego] MEMBEGO_SECRETO no está configurado en el entorno");
      return rechazar("sesion");
    }

    const payload = verifyMembegoToken(req.nextUrl.searchParams.get("token"), secret);
    if (!payload) {
      console.warn("[sso/membego] token inválido, vencido o mal formado");
      return rechazar("token");
    }

    // El SSO trae al equipo; el cliente final tiene su portal en MembeGo.
    if ((payload.rol || "").toUpperCase() === "CLIENTE") {
      console.warn("[sso/membego] rol CLIENTE rechazado (sub:", payload.sub, ")");
      return rechazar("cuenta");
    }

    // Un solo uso, si el token trae jti (el contrato lo deja opcional): el
    // primer canje inserta la clave primaria y el segundo choca — sin ventana
    // entre comprobar y marcar.
    if (payload.jti) {
      const fresh = await consumeJti(payload.jti, payload.exp);
      if (!fresh) {
        console.warn("[sso/membego] token reutilizado (jti:", payload.jti, ")");
        return rechazar("token");
      }
    } else {
      console.warn("[sso/membego] token sin jti (sin garantía de uso único)");
    }

    const resolution = await resolveLink(payload);
    if (resolution.ok === false) {
      console.warn("[sso/membego] sin vínculo utilizable:", resolution.reason,
        "(empresa:", payload.companyId, ")");
      return rechazar("vinculo");
    }

    const user = await provisionSsoUser(resolution.link, payload);

    // Abrir la sesión propia: el mismo mecanismo probado del enlace mágico de
    // correo, sin mandar ningún correo — el hash del enlace se canjea aquí
    // mismo y la cookie queda puesta en esta respuesta.
    const { data: linkData, error: linkError } = await supabaseService().auth.admin.generateLink({
      type: "magiclink",
      email: user.email,
    });
    const tokenHash = linkData?.properties?.hashed_token;
    if (linkError || !tokenHash) {
      console.error("[sso/membego] generateLink falló:", linkError?.message);
      return rechazar("sesion");
    }

    const supabase = await supabaseServer();
    const { error: otpError } = await supabase.auth.verifyOtp({
      type: "magiclink",
      token_hash: tokenHash,
    });
    if (otpError) {
      console.error("[sso/membego] verifyOtp falló:", otpError.message);
      return rechazar("sesion");
    }

    await auditMembego(resolution.link.organization_id, "membego_sso_login",
      `Inicio de sesión por SSO de MembeGo: ${user.email} (rol ${user.role})`,
      { userId: user.userId, metadata: { membego_sub: payload.sub, membego_role: payload.rol || null } });

    console.log(
      `[sso/membego] sesión abierta: ${user.email} → ${resolution.link.organization_id}` +
      (resolution.created ? " (vínculo recién creado)" : "") +
      (user.created ? " (cuenta recién creada)" : "")
    );
    return NextResponse.redirect(new URL("/dashboard", req.url));
  } catch (err) {
    console.error("[sso/membego] error inesperado:", err);
    return rechazar("sesion");
  }
}
