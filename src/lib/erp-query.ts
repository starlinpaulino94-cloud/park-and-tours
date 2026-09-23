import "server-only";
import type { ResourceDef } from "@/lib/resources";
import { allowedFilterFields, partnerScopeFor } from "@/lib/resources";
import { decidableFilter } from "@/lib/approvals";
import { branchFilterFor } from "@/lib/branch-scope";
import { sellerFilterFor } from "@/lib/seller-scope";
import { searchFilterFor } from "@/lib/search";
import { TenantError, type TenantContext, esDeSocio } from "@/lib/tenant";
import { limitesConsulta, normalizarPeriodo } from "@/lib/report";
import { companyTimeZone } from "@/lib/time";

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

  /**
   * Rango de fechas sobre cualquier campo.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * EL ÚLTIMO DÍA SE CAÍA, Y NO SE NOTABA
   *
   * Antes esto mandaba `lte: new Date(to)`, o sea la MEDIANOCHE del último día.
   * «Hasta el 30» dejaba fuera el 30 entero: cada listado y cada exportación
   * con rango perdía su última jornada, en silencio. Y el corte iba en UTC, así
   * que una venta de las 21:00 en Santo Domingo se contaba en el día siguiente.
   *
   * Ahora el rango es SEMIABIERTO y los cortes son la medianoche de la EMPRESA:
   * `desde <= t < día siguiente al hasta`. Dos reportes consecutivos se tocan
   * sin solaparse, y nada se cuenta dos veces ni se pierde. La regla vive en
   * `report.ts`, con sus pruebas.
   */
  const dateField = sp.get("dateField");
  const from = sp.get("from");
  const to = sp.get("to");
  if (dateField && (from || to)) {
    const tz = companyTimeZone(ctx.company as { timezone?: string | null } | null);
    const periodo = normalizarPeriodo(from, to, new Date(), tz);
    filter[dateField] = limitesConsulta(periodo, tz);
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

  /**
   * La búsqueda (0062).
   *
   * En las tablas donde se buscan PERSONAS va contra una columna normalizada
   * que la base mantiene sola: minúsculas, sin acentos y con todos los campos
   * buscables juntos. Eso es lo que hace que «jose perez» encuentre a «José
   * Pérez» y que «pérez josé» lo encuentre también.
   *
   * En las demás sigue el camino de siempre, campo por campo. Añadirle una
   * columna generada a las ochenta tablas sería una migración enorme para
   * arreglar un problema que solo duele donde hay nombres propios.
   */
  const searchFilter = searchFilterFor(def.table, def.search, sp.get("q"));
  if (searchFilter) Object.assign(filter, searchFilter);

  // Un usuario del portal B2B solo ve lo de su partner. Denegar por defecto:
  // una tabla que no sea suya ni compartida es 403.
  if (esDeSocio(ctx)) {
    const scope = partnerScopeFor(def.table, ctx.partnerId);
    if (scope.kind === "denied") {
      throw new TenantError("No tienes acceso a este recurso", 403);
    }
    if (scope.kind === "own") {
      filter[scope.field] = scope.partnerId;
    }
  }

  // Y la sucursal, cuando la persona tiene una. Va aquí —en el armador que
  // comparten el listado y su exportación— para que no puedan discrepar: un
  // archivo que se lleva las reservas de las tres sucursales mientras la
  // pantalla enseña una es exactamente el fallo que nadie revisa, porque «lo
  // exportó el sistema».
  //
  // Se combina con `_and` en lugar de fusionarlo: dos `_or` en el mismo objeto
  // se pisan —solo sobreviviría uno, y decidiría él solo—, y el traductor
  // aplica los `_and` uno tras otro, que es justo lo que hace falta.
  const branchFilter = branchFilterFor(def.table, ctx.branchId);

  /**
   * Y el vendedor, cuando quien llama es uno.
   *
   * El rol `seller` es el rango más bajo del ERP y hasta aquí veía las ventas
   * de toda la empresa: ni la RLS (que aísla empresas) ni el ámbito del socio
   * ni el de la sucursal miran quién vendió. Un vendedor podía pedir
   * `/api/erp/order` —o exportarlo— y llevarse la cartera de sus compañeros.
   *
   * La regla, sus excepciones y por qué las filas sin vendedor siguen visibles
   * están en `seller-scope.ts`.
   */
  const sellerFilter = sellerFilterFor(def.table, ctx.role, ctx.sellerId);

  // Cada ámbito entra como un elemento de `_and` en vez de fusionarse: dos
  // `_or` en el mismo objeto se pisan —solo sobreviviría uno, y decidiría él
  // solo—, y el traductor aplica los `_and` uno tras otro, que es justo lo que
  // hace falta para que se acumulen.
  const scopes = [branchFilter, sellerFilter].filter(Boolean) as Record<string, unknown>[];
  return scopes.length > 0 ? { _and: [filter, ...scopes] } : filter;
}

/** El orden del listado: el pedido, o el que declara el recurso. */
export function buildListSort(def: ResourceDef, sp: URLSearchParams): Record<string, "asc" | "desc"> {
  const sortParam = sp.get("sort");
  return sortParam
    ? { [sortParam.replace(/^-/, "")]: sortParam.startsWith("-") ? "desc" : "asc" }
    : (def.sort as Record<string, "asc" | "desc">) || { createdAt: "desc" };
}
