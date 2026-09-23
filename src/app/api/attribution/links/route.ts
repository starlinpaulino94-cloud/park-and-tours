import { NextRequest } from "next/server";
import { requireTenantWrite, requireTenant, tenantQuery, tenantCreate, tenantFindOne, atLeast, TenantError } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { proposeSlug } from "@/lib/attribution";
import { writeAudit } from "@/lib/audit";
import { sellerFilterFor } from "@/lib/seller-scope";
import { refId } from "@/lib/types";
import type { Seller } from "@/lib/types";

/**
 * LOS ENLACES DE VENTA: LISTAR Y CREAR.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL SLUG LO GENERA EL SERVIDOR. SIEMPRE.
 *
 * Es único EN TODO EL SISTEMA —`seller_link_slug_key` es global, no por
 * empresa—, así que aceptarlo del navegador tiene dos consecuencias que no se
 * ven de entrada:
 *
 *  · OCUPAR. Cualquiera puede reservarse los slugs bonitos del espacio de
 *    nombres, incluidos los de otras empresas alojadas aquí.
 *  · IMITAR. Un vendedor podría pedir un slug parecidísimo al de un compañero
 *    —`MARISOL1` frente a `MARIS0L1`— y llevarse sus visitas. El cliente teclea
 *    lo que ve en un cartel, no comprueba nada.
 *
 * Por eso el CRUD genérico deja de admitirlo (`resources.ts`) y nace aquí, del
 * código comercial del vendedor más un sufijo aleatorio. Si choca, se reintenta
 * con otro sufijo: el choque es normal —el espacio es compartido— y no es un
 * error que deba ver quien está creando un cartel.
 */

/** Cuántas veces se reintenta ante un slug ya ocupado antes de rendirse. */
const INTENTOS = 6;

async function slugLibre(companyId: string, seller: Seller): Promise<string> {
  for (let i = 0; i < INTENTOS; i++) {
    const candidato = proposeSlug(seller.code || seller.first_name || "VEN");
    // La unicidad la sostiene el índice; esto solo evita el error feo en el
    // caso normal. La carrera entre dos peticiones la resuelve la base.
    const usados = await tenantQuery<{ _id: string }>(companyId, "seller_link", {
      _filter: { slug: candidato }, _limit: 1,
    });
    if (usados.length === 0) return candidato;
  }
  throw new TenantError("No se pudo generar un enlace libre. Inténtalo otra vez.", 503);
}

/** GET /api/attribution/links — los enlaces, acotados a quien pregunta. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "links:list", ctx.userId), limit: 120, windowMs: 60_000 });
    if (!atLeast(ctx.role, "manager") && ctx.role !== "seller") {
      throw new TenantError("No tienes permisos para ver los enlaces de venta", 403);
    }

    // El mismo ámbito que el resto: lo suyo, y estricto —un enlace sin vendedor
    // no existe, así que aquí «de nadie» no es una categoría.
    const filter = sellerFilterFor("seller_link", ctx) ?? {};
    const rows = await tenantQuery(ctx.companyId, "seller_link", {
      _filter: filter, _limit: 100, _sort: { created_at: "desc" },
      seller: true, product: true,
    });
    return ok(rows);
  } catch (err) {
    return fail(err);
  }
}

/** POST /api/attribution/links — crea uno. El slug NO viaja en el cuerpo. */
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    // Bajo a propósito: cada enlace ocupa un nombre del espacio compartido.
    await assertRateLimit({ key: rateLimitKey(req, "links:create", ctx.userId), limit: 10, windowMs: 60_000 });

    const body = await readJson<{ seller_id?: string; name?: string; channel?: string; product_id?: string }>(req);

    /**
     * De quién es el enlace: del vendedor que lo pide, o del que elija gerencia.
     *
     * Un vendedor NO puede crear el enlace de otro —sería regalarle tráfico o,
     * peor, quedarse el suyo— y por eso su identificador sale del contexto y no
     * del cuerpo. Es el mismo sello que la venta.
     */
    let sellerId: string;
    if (ctx.role === "seller") {
      if (!ctx.sellerId) {
        throw new TenantError(
          "Tu cuenta no está vinculada a una ficha de vendedor, así que el enlace no tendría a quién atribuir las ventas.",
          409
        );
      }
      sellerId = ctx.sellerId;
    } else {
      if (!atLeast(ctx.role, "manager")) throw new TenantError("No tienes permisos para crear enlaces", 403);
      const pedido = (body.seller_id || "").trim();
      if (!pedido) throw new TenantError("Indica de qué vendedor es el enlace", 400);
      sellerId = pedido;
    }

    // Que la ficha exista y sea de esta empresa; de paso hace falta su código
    // comercial para el slug.
    const seller = await tenantFindOne<Seller>(ctx.companyId, "seller", sellerId);

    const slug = await slugLibre(ctx.companyId, seller);
    const link = await tenantCreate<Record<string, unknown>>(ctx.companyId, "seller_link", {
      seller: sellerId,
      slug,
      name: (body.name || "").trim() || null,
      channel: body.channel === "qr" ? "qr" : "link",
      product: (body.product_id || "").trim() || undefined,
      status: "active",
      created_by: ctx.userId,
    });

    /**
     * Queda en la bitácora, y no es burocracia: un enlace es una dirección
     * pública que reparte atribución —o sea, dinero—, y el día que aparezcan
     * veinte de la nada la pregunta es quién los hizo.
     */
    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "seller_link_created",
      entityType: "seller_link", entityId: refId(link._id) ?? undefined,
      description: `${ctx.email} creó el enlace ${slug}`,
      metadata: { slug, seller: sellerId, channel: body.channel ?? "link" },
    });

    return ok(link);
  } catch (err) {
    return fail(err);
  }
}
