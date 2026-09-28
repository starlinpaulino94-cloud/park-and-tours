import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, tenantFindOne, tenantUpdate, TenantError } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { inviteTeamMember } from "@/lib/team-invite";
import { assertSupplierUserLinkable } from "@/lib/supplier-identity";
import { writeAudit } from "@/lib/audit";
import { refId } from "@/lib/types";

/**
 * POST /api/suppliers/invite — la cuenta del proveedor y su vínculo, de una vez.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTO CIERRA
 *
 * El portal del proveedor —ver sus servicios, aceptarlos o rechazarlos con su
 * plazo, la hoja de ruta del chofer, su estado de cuenta, facturar con NCF— se
 * abre con `supplier.user_id`: el enganche de autenticación busca la ficha por
 * esa columna y publica `supplier_id` en el token.
 *
 * Y **nada en el producto podía escribirla**. Ni el formulario de proveedores
 * —`user` no estaba entre sus campos editables— ni ninguna ruta. La única
 * forma de abrir ese portal era un `update` a mano contra la base.
 *
 * Es el espejo exacto de `/api/sellers/invite`, y a propósito: son el mismo
 * problema —una ficha que necesita una cuenta— y resolverlos de dos maneras
 * distintas habría dejado dos caminos que envejecen por separado.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * RANGO DE ADMINISTRACIÓN
 *
 * Igual que el del vendedor: crea una cuenta de acceso y escribe la columna de
 * identidad. Aquí esa columna abre la puerta a los datos de OTRA empresa —la
 * del proveedor— sobre la operación de ésta.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SI ALGO FALLA, NO QUEDA A MEDIAS
 *
 * Validar la ficha → invitar → vincular. Si la invitación falla, la ficha se
 * queda como estaba. Si el vínculo falla después de invitar, la cuenta existe
 * sin ficha y se puede vincular a mano; el error lo dice. Lo que NO puede pasar
 * es lo contrario —una ficha apuntando a una cuenta que no existe—, y por eso
 * el vínculo va al final.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    requireAtLeast(ctx, "admin");
    // El mismo tope bajo que el resto de invitaciones: cada llamada manda un
    // correo a una dirección que elige quien la pide.
    await assertRateLimit({ key: rateLimitKey(req, "suppliers:invite", ctx.userId), limit: 10, windowMs: 60_000 });

    const body = await readJson<{ supplier_id?: string; email?: string; name?: string }>(req);
    const supplierId = (body.supplier_id || "").trim();
    if (!supplierId) throw new TenantError("Indica de qué proveedor es la cuenta", 400);

    // La ficha, primero: comprueba de paso que es de esta empresa.
    const supplier = await tenantFindOne<Record<string, unknown>>(ctx.companyId, "supplier", supplierId);
    if (refId(supplier.user as never)) {
      throw new TenantError("Ese proveedor ya tiene una cuenta vinculada", 409);
    }

    /**
     * El correo sale de la FICHA si no viene.
     *
     * Volver a pedirlo invita a teclear uno distinto y acabar con dos
     * identidades para el mismo proveedor. Y sin correo no hay a quién
     * invitar: se dice, en vez de mandar una invitación a la nada.
     */
    const email = (body.email || String(supplier.email ?? "")).trim();
    if (!email) {
      throw new TenantError(
        "Ese proveedor no tiene correo en su ficha. Añádelo antes de crearle la cuenta.",
        400
      );
    }
    const name = (body.name
      || String(supplier.contact_name ?? "")
      || String(supplier.name ?? "")).trim();

    const invitado = await inviteTeamMember({
      ctx, email, name, role: "supplier", branch: null,
      redirectTo: new URL("/auth/callback?next=/auth/establecer-clave", req.nextUrl.origin).toString(),
    });

    await assertSupplierUserLinkable(ctx.companyId, { user: invitado.userId }, supplierId);
    const actualizado = await tenantUpdate<Record<string, unknown>>(ctx.companyId, "supplier", supplierId, {
      user: invitado.userId,
    });

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "supplier_account_linked",
      entityType: "supplier", entityId: supplierId,
      severity: "warning",
      description: `${ctx.email} creó la cuenta ${invitado.email} y la vinculó al proveedor`,
      metadata: { email: invitado.email },
    });

    return ok({ supplier: actualizado, invited: { _id: invitado.userId, email: invitado.email, state: "invited" } });
  } catch (err) {
    return fail(err);
  }
}
