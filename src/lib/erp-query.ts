import "server-only";
import type { ResourceDef } from "@/lib/resources";
import { allowedFilterFields, partnerScopeFor } from "@/lib/resources";
import { decidableFilter } from "@/lib/approvals";
import { TenantError, type TenantContext } from "@/lib/tenant";

/**
 * El filtro de un listado, en UN solo sitio.
 *
 * Lo escribía entero la ruta genérica del ERP. Cuando la exportación apareció
 * —y tiene que devolver EXACTAMENTE las filas que la pantalla enseña— había dos
 * caminos: copiarlo, o compartirlo. Copiado, la divergencia es cuestión de
 * tiempo y se manifiesta de la peor manera posible: un archivo que dice tener
 * los datos filtrados y trae otros, que nadie revisa porque «lo exportó el
 * sistema». Compartido, el listado y su exportación no PUEDEN discrepar.
 *
 * Incluye el ámbito del portal B2B y el de las aprobaciones, que son
 * autorización y no comodidad: un partner exportando sin su ámbito se llevaría
 * la cartera entera de la operadora.
 */
export function buildListFilter(
  def: ResourceDef,
  ctx: TenantContext,
  sp: URLSearchParams
): Record<string, unknown> {
  const filter: Record<string, unknown> = {};

  // Igualdades explícitas (`filter.<campo>=valor`), acotadas a una lista
  // blanca. Un campo desconocido se ignora, no se rechaza.
  const filterable = allowedFilterFields(def);
  for (const [key, value] of sp.entries()) {
    if (!key.startsWith("filter.")) continue;
    const field = key.slice(7);
    if (!value || !filterable.has(field)) continue;
    // Un filtro de sí/no viaja como texto desde la UI y la columna es booleana:
    // se convierte aquí y no se deja a la conversión implícita de Postgres.
    if (def.booleans?.includes(field)) {
      filter[field] = value === "yes" || value === "true";
      continue;
    }
    filter[field] = value.includes(",") ? { in: value.split(",") } : value;
  }

  // Rango de fechas sobre cualquier campo.
  const dateField = sp.get("dateField");
  const from = sp.get("from");
  const to = sp.get("to");
  if (dateField && (from || to)) {
    const range: Record<string, string> = {};
    if (from) range.gte = new Date(from).toISOString();
    if (to) range.lte = new Date(to).toISOString();
    filter[dateField] = range;
  }

  // Aprobaciones: «solo las que puedo decidir» reutiliza la misma función de
  // dominio que la tarjeta de Mi día y el contador del menú.
  if (def.table === "approval_request" && sp.get("filter.scope") === "decidable") {
    const decidable = decidableFilter(ctx);
    // `null` significa «este rol no puede decidir ninguna»: se devuelve un
    // filtro imposible en vez de ninguno, porque sin filtro saldrían TODAS.
    if (!decidable) return { _none: true };
    Object.assign(filter, decidable);
  }

  const q = sp.get("q")?.trim();
  if (q && def.search.length > 0) {
    // Se escapan los metacaracteres: un `q` malicioso podría causar retroceso
    // catastrófico o coincidir con registros que no debía.
    const safeQ = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter._or = def.search.map((field) => ({ [field]: { regex: safeQ, options: "i" } }));
  }

  // Un usuario del portal B2B solo ve lo de su partner. Denegar por defecto:
  // una tabla que no sea suya ni compartida es 403.
  if (ctx.role === "partner") {
    const scope = partnerScopeFor(def.table, ctx.partnerId);
    if (scope.kind === "denied") {
      throw new TenantError("No tienes acceso a este recurso", 403);
    }
    if (scope.kind === "own") {
      filter[scope.field] = scope.partnerId;
    }
  }

  return filter;
}

/** El orden del listado: el pedido, o el que declara el recurso. */
export function buildListSort(def: ResourceDef, sp: URLSearchParams): Record<string, "asc" | "desc"> {
  const sortParam = sp.get("sort");
  return sortParam
    ? { [sortParam.replace(/^-/, "")]: sortParam.startsWith("-") ? "desc" : "asc" }
    : (def.sort as Record<string, "asc" | "desc">) || { createdAt: "desc" };
}
