import { NextRequest } from "next/server";
import {
  requireTenant, requireTenantWrite, requireAtLeast, tenantQuery, tenantCreate,
  TenantError, esDeSocio, esAdminDeSocio,
} from "@/lib/tenant";
import { noPuedeAbrirLaCaja, duenoDeLaCaja, filtroDeArqueo } from "@/lib/caja-identidad";
import { ok, fail, readJson } from "@/lib/api-response";
import { newCashSessionCode } from "@/lib/codes";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import type { CashSession, Currency } from "@/lib/types";

/** GET /api/cash/sessions — sessions, newest first (open ones surface at the top of the UI). */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "cash:sessions:list", ctx.userId), limit: 120, windowMs: 60_000 });
    const status = req.nextUrl.searchParams.get("status");
    /**
     * EL ARQUEO DE LA OPERADORA NO VE EL DINERO DE NADIE MÁS (0081).
     *
     * Esta ruta arma su propio filtro y no pasaba por el ámbito, así que
     * listaba TODAS las sesiones de la empresa. Con la caja externa eso son dos
     * fallos a la vez: al personal interno le enseñaría el efectivo de los tour
     * centers como si fuera suyo, y a un miembro de un tour center le enseñaría
     * el de la operadora y el de las demás agencias.
     *
     * `{ partner: null }` para el interno y no «sin filtro»: el criterio es que
     * un arqueo de la operadora no incluya NI UNA sesión de socio, y eso hay
     * que escribirlo.
     */
    const filter: Record<string, unknown> = filtroDeArqueo({
      esDeSocio: esDeSocio(ctx), partnerId: ctx.partnerId, sellerId: ctx.sellerId,
    });
    if (status) filter.status = status;

    const rows = await tenantQuery<CashSession>(ctx.companyId, "cash_session", {
      _filter: filter,
      _sort: { createdAt: "desc" },
      _limit: 100,
      // `closed_by` y `approved_by` los pide la revisión del descuadre: sin
      // ellos la pantalla no puede decir quién contó ni quién aprobó.
      cash_register: true, branch: true, user: true, closed_by: true, approved_by: true,
      // De quién es el dinero: sin esto la pantalla no puede decir de qué
      // mostrador es cada turno, que es lo único nuevo que hay que mirar.
      partner: true, seller: true,
    });
    return ok(rows);
  } catch (err) {
    return fail(err);
  }
}

/** POST /api/cash/sessions — opens a cash session. */
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "cash:sessions:create", ctx.userId), limit: 20, windowMs: 60_000 });
    requireAtLeast(ctx, "cashier");

    const body = await readJson<{ cash_register_id?: string; opening_amount?: number; currency?: Currency; notes?: string }>(req);
    if (!body.cash_register_id) throw Object.assign(new Error("Selecciona la caja a abrir"), { status: 400 });

    const alreadyOpen = await tenantQuery<CashSession>(ctx.companyId, "cash_session", {
      _filter: { cash_register: body.cash_register_id, status: "open" }, _limit: 1,
    });
    if (alreadyOpen.length > 0) {
      throw Object.assign(new Error("Esta caja ya tiene una sesión abierta"), { status: 409 });
    }

    const register = (await tenantQuery<{
      _id: string; branch?: any; currency?: Currency;
      partner?: unknown; seller?: unknown; status?: string | null; name?: string | null;
    }>(
      ctx.companyId, "cash_register", { _filter: { _id: body.cash_register_id }, _limit: 1 }
    ))[0];
    if (!register) throw Object.assign(new Error("Caja no encontrada"), { status: 404 });

    /**
     * QUIÉN PUEDE ABRIR ESTA CAJA (0081).
     *
     * Antes bastaba el rango `cashier`. Con la caja externa eso deja entrar dos
     * cosas caras: que alguien de un tour center abra la caja de la operadora
     * —su efectivo entraría en el cajón de la casa y el arqueo interno lo
     * contaría como propio— y que la operadora abra un turno en el mostrador de
     * un socio, que es un arqueo que nadie puede firmar.
     */
    const impedimento = noPuedeAbrirLaCaja(register, {
      esDeSocio: esDeSocio(ctx),
      partnerId: ctx.partnerId,
      sellerId: ctx.sellerId,
      esAdminDeSocio: esAdminDeSocio(ctx),
    });
    if (impedimento) throw new TenantError(impedimento, 403);

    // El turno hereda el dueño de la CAJA, no lo trae el cuerpo de la petición:
    // dejar que quien abre elija de quién es el dinero es la puerta de atrás
    // entera. Y un disparador de 0081 impide cambiarlo después.
    const dueno = duenoDeLaCaja(register);

    const opening = Number(body.opening_amount ?? 0);
    // AUD-U06: opening float must be a valid, non-negative amount.
    if (!Number.isFinite(opening) || opening < 0) {
      throw Object.assign(new Error("El fondo de apertura no puede ser negativo"), { status: 400 });
    }
    const session = await tenantCreate<CashSession>(ctx.companyId, "cash_session", {
      cash_register: body.cash_register_id,
      branch: typeof register.branch === "object" ? register.branch?._id : register.branch,
      user: ctx.userId,
      partner: dueno.partnerId ?? undefined,
      seller: dueno.sellerId ?? undefined,
      code: newCashSessionCode(),
      opened_at: new Date().toISOString(),
      opening_amount: opening,
      expected_cash: opening,
      counted_cash: 0, difference: 0,
      card_total: 0, transfer_total: 0, sales_total: 0,
      expenses_total: 0, withdrawals_total: 0,
      currency: body.currency || register.currency || ctx.company?.base_currency || "usd",
      status: "open",
      notes: body.notes,
    });

    await tenantCreate(ctx.companyId, "cash_movement", {
      cash_session: session._id, user: ctx.userId,
      // El mismo dueño que el turno: el movimiento es la fila que el arqueo
      // SUMA, así que es donde tiene que poder distinguirse el dinero.
      partner: dueno.partnerId ?? undefined,
      seller: dueno.sellerId ?? undefined,
      movement_type: "opening", amount: opening,
      currency: session.currency, concept: "Fondo de apertura",
      movement_at: new Date().toISOString(),
    });

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "cash_session_opened", entityType: "cash_session", entityId: session._id,
      description: `Caja abierta con fondo ${opening}`,
    });

    console.log(`[cash] sesión ${session.code} abierta por ${ctx.email}`);
    return ok(session);
  } catch (err) {
    return fail(err);
  }
}
