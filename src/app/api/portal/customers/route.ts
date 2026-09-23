import { NextRequest } from "next/server";
import { requireTenantWrite, tenantCreate, TenantError, esDeSocio } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { vetoDeSocio } from "@/lib/partner-lifecycle";

/**
 * EL TOUR CENTER DA DE ALTA A SU CLIENTE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACE FALTA UNA RUTA PROPIA
 *
 * `POST /api/orders` acepta al socio desde hace tiempo y le fuerza su
 * `partner_id`. Lo que no podía era TERMINAR una venta: exige `customer_id`, y
 * el CRUD genérico le deniega toda escritura —por diseño; abrirle `/api/erp/*`
 * para esto le abriría de paso las otras setenta y seis tablas—.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL SOCIO LO PONE EL SERVIDOR
 *
 * `customer.partner_id` no está en la lista blanca de escritura de nadie, y
 * aquí se sella desde el contexto. Si viniera del cuerpo, un tour center daría
 * de alta clientes a nombre de otro —o de la operadora— y se los quitaría de la
 * cartera al siguiente.
 */

/** Lo único que el socio puede escribir de un cliente suyo. */
const CAMPOS = [
  "first_name", "last_name", "email", "phone", "whatsapp",
  "nationality", "language", "country", "document_id", "room", "notes",
] as const;

export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    if (!esDeSocio(ctx) || !ctx.partnerId) {
      throw new TenantError("Esta alta es para las empresas asociadas", 403);
    }
    // El ciclo de vida manda también aquí. `requireTenantWrite` ya lo comprueba;
    // esto lo deja escrito en la ruta que crea datos a nombre del socio.
    const veto = vetoDeSocio(ctx.partnerStatus);
    if (veto) throw new TenantError(veto.mensaje, 403);

    await assertRateLimit({
      key: rateLimitKey(req, "portal:customer", ctx.userId), limit: 40, windowMs: 60_000,
    });

    const body = await readJson<Record<string, unknown>>(req);
    const nombre = String(body.first_name ?? "").trim();
    if (!nombre) throw new TenantError("El nombre del cliente es obligatorio", 400);

    const payload: Record<string, unknown> = {};
    for (const campo of CAMPOS) {
      const valor = body[campo];
      if (valor === undefined || valor === null) continue;
      const texto = String(valor).trim();
      if (texto) payload[campo] = texto;
    }
    payload.first_name = nombre;
    // El sello. Nunca del cuerpo.
    payload.partner_id = ctx.partnerId;
    // De dónde salió, para que la operadora pueda distinguir su propia cartera
    // de la que le traen sus tour centers sin tener que cruzar tablas.
    payload.source = "partner_portal";

    const cliente = await tenantCreate<Record<string, unknown>>(ctx.companyId, "customer", payload);

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "record_created", entityType: "customer", entityId: String(cliente._id),
      description: `${ctx.email} dio de alta un cliente desde el portal`,
      metadata: { partner: ctx.partnerId },
    });

    return ok(cliente);
  } catch (err) {
    return fail(err);
  }
}
