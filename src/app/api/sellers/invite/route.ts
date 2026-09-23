import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, tenantFindOne, tenantUpdate, TenantError } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { inviteTeamMember } from "@/lib/team-invite";
import { assertSellerUserLinkable } from "@/lib/seller-identity";
import { writeAudit } from "@/lib/audit";
import { refId } from "@/lib/types";
import type { Seller } from "@/lib/types";

/**
 * POST /api/sellers/invite — la cuenta y el vínculo, en una sola operación.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACE FALTA UNA RUTA PROPIA
 *
 * Dar de alta a un vendedor eran tres pasos en dos pantallas distintas: crear
 * la ficha en Vendedores, invitar la cuenta en Configuración → Equipo, y
 * volver a la ficha a vincularla. El tercero no existía hasta hace poco —el
 * campo estaba en la base desde 0005 y ninguna pantalla lo ponía— y es el que
 * decide si esa persona ve sus ventas o no ve ninguna (`seller-scope.ts`).
 *
 * Un paso que nadie ve, que no falla si se olvida y del que depende todo lo
 * demás, se olvida siempre. Aquí los tres van juntos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PIDE RANGO DE ADMINISTRACIÓN, Y NO ES UN DESCUIDO
 *
 * La ficha del vendedor la crea gerencia (`seller.writeRole`), pero esto hace
 * dos cosas que gerencia no puede hacer por separado: crear una cuenta de
 * acceso (`/api/team/invite` ya pedía administración) y escribir
 * `seller.user_id`, que `field-write-role.ts` reserva a administración porque
 * es la columna que traslada ventas, comisiones y liquidación de una persona a
 * otra con un solo cambio.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SI ALGO FALLA, NO QUEDA A MEDIAS
 *
 * El orden es: validar la ficha → invitar → vincular. Si la invitación falla,
 * la ficha se queda como estaba. Si el vínculo falla después de invitar, la
 * cuenta existe pero sin ficha: se puede vincular a mano desde la ficha, y el
 * error lo dice. Lo que NO puede pasar es lo contrario —una ficha apuntando a
 * una cuenta que no existe—, y por eso el vínculo va al final.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    requireAtLeast(ctx, "admin");
    // El mismo tope bajo que la invitación de equipo: cada llamada manda un
    // correo a una dirección que elige quien la pide.
    await assertRateLimit({ key: rateLimitKey(req, "sellers:invite", ctx.userId), limit: 10, windowMs: 60_000 });

    const body = await readJson<{ seller_id?: string; email?: string; name?: string; branch?: string | null }>(req);
    const sellerId = (body.seller_id || "").trim();
    if (!sellerId) throw new TenantError("Indica de qué vendedor es la cuenta", 400);

    // La ficha, primero: comprueba de paso que es de esta empresa.
    const seller = await tenantFindOne<Seller>(ctx.companyId, "seller", sellerId);
    if (refId(seller.user as never)) {
      throw new TenantError("Ese vendedor ya tiene una cuenta vinculada", 409);
    }

    // El correo y el nombre salen de la ficha si no vienen: es lo que el
    // administrador acaba de escribir, y volver a pedirlos invita a teclear uno
    // distinto y acabar con dos identidades para la misma persona.
    const email = (body.email || seller.email || "").trim();
    const name = (body.name || [seller.first_name, seller.last_name].filter(Boolean).join(" ")).trim();

    const invitado = await inviteTeamMember({
      ctx, email, name, role: "seller",
      branch: body.branch ?? (refId(seller.branch as never) || null),
      redirectTo: new URL("/auth/callback?next=/auth/establecer-clave", req.nextUrl.origin).toString(),
    });

    // La misma validación que el CRUD genérico: que la cuenta sea de esta
    // empresa y no esté ya en otra ficha. Aquí acaba de crearse, así que lo
    // segundo es lo que importa —dos altas a la vez para el mismo correo—.
    await assertSellerUserLinkable(ctx.companyId, { user: invitado.userId }, sellerId);
    const actualizado = await tenantUpdate<Seller>(ctx.companyId, "seller", sellerId, {
      user: invitado.userId,
    });

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "seller_account_linked",
      entityType: "seller", entityId: sellerId,
      severity: "warning",
      description: `${ctx.email} creó la cuenta ${invitado.email} y la vinculó al vendedor`,
      metadata: { email: invitado.email },
    });

    return ok({ seller: actualizado, invited: { _id: invitado.userId, email: invitado.email, state: "invited" } });
  } catch (err) {
    return fail(err);
  }
}
