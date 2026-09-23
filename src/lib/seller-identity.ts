import "server-only";
import { tenantQuery, TenantError } from "@/lib/tenant";
import { supabaseService } from "@/lib/supabase/service";
import { refId } from "@/lib/types";

/**
 * LA LLAVE QUE DICE QUIÉN ES CADA VENDEDOR, VALIDADA ANTES DE GUARDARSE.
 *
 * `seller.user_id` decide de quién son las ventas y a quién se le paga
 * (`seller-scope.ts`). El rango que hace falta para tocarla lo pone
 * `field-write-role.ts`; lo que se comprueba aquí es que el valor TENGA
 * SENTIDO, que es una pregunta distinta y que solo la base puede responder:
 *
 *  1. QUE ESA CUENTA SEA DE ESTA EMPRESA. Sin esto, un administrador podía
 *     apuntar la ficha a un usuario de otra operadora. Ese usuario no vería
 *     nada —la muralla por empresa sigue en pie— pero la ficha quedaría con una
 *     llave ajena, y el día que esa persona entre a las dos empresas heredaría
 *     una cartera que no es suya.
 *  2. QUE NO ESTÉ YA EN OTRA FICHA ACTIVA. El índice único de la migración 0069
 *     ya lo impide en la base, pero ahí el fallo sale como un error de
 *     restricción que nadie entiende. Aquí sale diciendo con qué ficha choca.
 *
 * Se valida en la creación y en la edición, porque las dos escriben la columna.
 */

type UserRow = { user_id: string; status?: string | null };

/** ¿Tiene esta cuenta una membresía ACTIVA en esta empresa? */
async function tieneMembresiaActiva(companyId: string, userId: string): Promise<boolean> {
  try {
    const sb = supabaseService();
    const { data } = await sb
      .from("organization_memberships")
      .select("user_id,status")
      .eq("organization_id", companyId)
      .eq("user_id", userId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    return Boolean((data as UserRow | null)?.user_id);
  } catch {
    // Un fallo de lectura NO se convierte en permiso: si no se puede comprobar,
    // no se guarda. Al revés, un corte de red serviría para colar una llave.
    return false;
  }
}

/**
 * Valida `payload.user` antes de escribir una ficha de vendedor.
 *
 * `sellerId` es la ficha que se está editando, para que su propio vínculo no se
 * cuente como choque consigo misma.
 */
export async function assertSellerUserLinkable(
  companyId: string,
  payload: Record<string, unknown>,
  sellerId?: string | null
): Promise<void> {
  if (!("user" in payload)) return;
  const userId = refId(payload.user);
  // Desvincular siempre se puede: quitarle la cuenta a una ficha solo le quita
  // acceso a esa persona, nunca se lo da a nadie.
  if (!userId) return;

  if (!(await tieneMembresiaActiva(companyId, userId))) {
    throw new TenantError(
      "Esa cuenta no tiene acceso activo a esta empresa. Invítala primero desde Configuración → Equipo.",
      400
    );
  }

  const ocupadas = await tenantQuery<{ _id?: string; first_name?: string; last_name?: string }>(
    companyId, "seller", { _filter: { user: userId }, _limit: 2 }
  );
  const choque = ocupadas.find((f) => f._id && f._id !== sellerId);
  if (choque) {
    const nombre = [choque.first_name, choque.last_name].filter(Boolean).join(" ").trim();
    throw new TenantError(
      `Esa cuenta ya está vinculada a la ficha de ${nombre || "otro vendedor"}. Una cuenta solo puede ser un vendedor.`,
      409
    );
  }
}
