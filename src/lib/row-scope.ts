import "server-only";
import type { AppRole } from "@/lib/auth";
import { partnerScopeFor } from "@/lib/resources";
import { sellerFilterFor, sellerFieldFor, sellerCanReadRow } from "@/lib/seller-scope";
import { esDeSocio, TenantError } from "@/lib/tenant";
import { refId } from "@/lib/types";

/**
 * UN SOLO PUNTO DE ENTRADA POR ACTOR.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ SE UNIFICA Y POR QUÉ AHORA
 *
 * Había dos ámbitos por fila —el del socio y el del vendedor— y cada uno se
 * aplicaba por su cuenta en cada sitio: el armador de listas los pedía por
 * separado, y el detalle tenía dos guardas gemelas, una debajo de la otra, cada
 * una con su comentario explicando que era la pareja de la otra.
 *
 * Funcionaba porque hoy son disjuntos: el rol del socio no es `seller`, así que
 * el ámbito del vendedor nunca se aplicaba a un socio. **Eso deja de ser cierto
 * en la fase siguiente**, donde el vendedor de un tour center tiene que estar
 * acotado por las dos cosas a la vez: las ventas de SU socio, y dentro de ésas,
 * las SUYAS. Y otra más después, con el proveedor.
 *
 * Dos reglas sueltas y un tercer actor es el momento exacto en que aparece un
 * tercer módulo paralelo que repite la composición con una diferencia de más.
 * Se unifica aquí, antes de tener el tercero, y no después.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SE ACUMULAN, NO SE ELIGEN
 *
 * Cada ámbito aplicable entra como un elemento más de `_and`. Un `if/else
 * if` entre actores sería la forma de que, el día que alguien sea las dos
 * cosas, se le aplique solo el primero — y ese primero es el MENOS restrictivo
 * de los dos en el caso que importa.
 *
 * Y por `_and` en vez de fusionando en el mismo objeto: dos `_or` fusionados se
 * pisan, sobrevive uno y decide él solo.
 */

export interface ActorDeFila {
  role: AppRole;
  partnerId?: string | null;
  isPartnerMember?: boolean;
  sellerId?: string | null;
}

/**
 * Los filtros que acotan esta tabla para quien consulta.
 *
 * Lanza 403 cuando la tabla no es suya ni compartida — denegar por defecto es
 * del ámbito del socio, y se conserva.
 */
export function scopeFiltersFor(table: string, ctx: ActorDeFila): Record<string, unknown>[] {
  const filtros: Record<string, unknown>[] = [];

  if (esDeSocio(ctx)) {
    const scope = partnerScopeFor(table, ctx.partnerId ?? null);
    if (scope.kind === "denied") throw new TenantError("No tienes acceso a este recurso", 403);
    if (scope.kind === "own") filtros.push({ [scope.field]: scope.partnerId });
  }

  const delVendedor = sellerFilterFor(table, ctx.role, ctx.sellerId);
  if (delVendedor) filtros.push(delVendedor);

  return filtros;
}

/**
 * ¿Puede leer ESTA fila? Lanza si no.
 *
 * El filtro del listado no protege el detalle: `tenantFindOne` solo comprueba
 * la empresa, así que sin esto acotar la lista sería cosmético — basta con
 * pedir `/api/erp/order/<id>` con un identificador que aparece en cualquier
 * informe o voucher.
 *
 * Mismo orden y mismas reglas que el filtro, para que la lista y el detalle no
 * puedan discrepar: es el motivo de que las dos vivan en esta función y no una
 * en cada ruta.
 */
export function assertRowInScope(
  table: string,
  ctx: ActorDeFila,
  record: Record<string, unknown> | null | undefined
): void {
  if (!record) return;

  if (esDeSocio(ctx)) {
    const scope = partnerScopeFor(table, ctx.partnerId ?? null);
    if (scope.kind === "denied") throw new TenantError("No tienes acceso a este recurso", 403);
    if (scope.kind === "own") {
      /**
       * `refId` sirve para los dos casos —el campo `partner` puede venir
       * expandido como objeto o crudo como uuid, y en la tabla `partner` el
       * campo es `_id`, que siempre es una cadena—. La versión anterior tenía
       * un ternario para distinguirlos; no distinguía nada, porque `refId` de
       * una cadena es la cadena. Una rama que ninguna mutación puede matar es
       * una rama que no hace nada.
       */
      const valor = refId(record[scope.field] as string | { _id?: string } | null | undefined);
      if (valor !== scope.partnerId) throw new TenantError("Registro fuera de tu ámbito", 403);
    }
  }

  const campo = sellerFieldFor(table);
  const rowSellerId = campo ? refId(record[campo]) : null;
  if (!sellerCanReadRow(table, ctx.role, ctx.sellerId, rowSellerId)) {
    throw new TenantError("Este registro es de otro vendedor", 403);
  }
}
