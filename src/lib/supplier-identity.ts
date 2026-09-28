import "server-only";
import { tenantQuery, TenantError } from "@/lib/tenant";
import { supabaseService } from "@/lib/supabase/service";
import { refId } from "@/lib/types";

/**
 * LA LLAVE QUE ABRE EL PORTAL DEL PROVEEDOR, VALIDADA ANTES DE GUARDARSE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE FALTABA, Y DEJABA UNA FASE ENTERA INALCANZABLE
 *
 * `supplier.user_id` es el único camino hacia el portal del proveedor: el
 * enganche de autenticación (0084, restaurado en 0093) busca la ficha por esa
 * columna y publica `supplier_id` en el token; de ahí sale `ctx.supplierId`, y
 * de ahí TODO —ver sus servicios, aceptar o rechazar con plazo, la hoja de ruta
 * del chofer, su estado de cuenta, facturar con NCF—.
 *
 * Y **nada en el producto podía escribir esa columna**: no estaba entre los
 * campos editables del recurso `supplier` y no existía ninguna ruta que la
 * pusiera. Comprobado a mano sobre el código: cero escritores. Es decir, la
 * fase 8 completa estaba construida, probada… y sin ninguna puerta por la que
 * entrar salvo un `update` a mano contra la base.
 *
 * Es el mismo hallazgo que `reconcileStaleDrafts` (9.16) y que
 * `reserve_departure_capacity` (9.19): lo que faltaba no era construirlo, era
 * enchufarlo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ SE COMPRUEBA AQUÍ
 *
 * El rango necesario lo pone `field-write-role.ts`. Aquí se comprueba que el
 * valor TENGA SENTIDO, que solo la base puede responder:
 *
 *  1. QUE LA CUENTA SEA DE ESTA EMPRESA. Si no, un administrador podría
 *     apuntar la ficha a un usuario de otra operadora: no vería nada hoy —la
 *     muralla por empresa sigue— pero la ficha quedaría con una llave ajena.
 *  2. QUE NO ESTÉ YA EN OTRA FICHA. Una cuenta es UN proveedor; con dos, el
 *     token publicaría una de las dos fichas y la persona vería los servicios
 *     de otro sin que nadie sepa por qué.
 */

type UserRow = { user_id: string; status?: string | null };

/** ¿Tiene esta cuenta una membresía ACTIVA en esta empresa? */
async function tieneMembresiaActiva(companyId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabaseService()
    .from("organization_memberships")
    .select("user_id, status")
    .eq("organization_id", companyId)
    .eq("user_id", userId)
    .limit(1);
  /**
   * Un error de lectura NO es «no tiene acceso».
   *
   * Tratarlo como un «no» convertiría una caída en un rechazo con un mensaje
   * que manda a invitar a alguien que ya está invitado; tratarlo como un «sí»
   * dejaría pasar el vínculo sin comprobarlo. Se lanza.
   */
  if (error) throw new TenantError(`No se pudo comprobar el acceso de la cuenta: ${error.message}`, 500);
  const fila = (data ?? [])[0] as UserRow | undefined;
  return Boolean(fila) && (fila!.status ?? "active") === "active";
}

export async function assertSupplierUserLinkable(
  companyId: string,
  payload: Record<string, unknown>,
  supplierId?: string | null
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

  const ocupadas = await tenantQuery<{ _id?: string; name?: string }>(
    companyId, "supplier", { _filter: { user: userId }, _limit: 2 }
  );
  const choque = ocupadas.find((f) => f._id && f._id !== supplierId);
  if (choque) {
    throw new TenantError(
      `Esa cuenta ya está vinculada a la ficha de ${choque.name || "otro proveedor"}. ` +
        "Una cuenta solo puede ser un proveedor.",
      409
    );
  }
}
