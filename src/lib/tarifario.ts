import "server-only";
import { tenantQuery } from "@/lib/tenant";
import { resolvePrice } from "@/lib/pricing";
import { autorizadosDe, type AutorizacionSocio } from "@/lib/catalogo-socio";
import type { Product, ProductModality } from "@/lib/types";
import { leerTodoElRecurso } from "@/lib/barrido";

/**
 * EL TARIFARIO NETO DE UN TOUR CENTER.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UNA SOLA FUNCIÓN PARA LOS DOS SITIOS
 *
 * El criterio del plan es que «el tarifario descargado coincide con lo que la
 * API devuelve». Eso no se consigue revisándolo: se consigue teniendo una sola
 * función que los produzca. Dos implementaciones del mismo precio divergen —no
 * el día uno, sino el día que alguien añade una regla de temporada a una de las
 * dos—, y la divergencia sale a la luz facturando.
 *
 * Por eso esto devuelve FILAS, no un CSV ni un JSON: cada superficie les pone
 * su formato encima y ninguna calcula nada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y LOS PRECIOS SALEN DEL MOTOR, NO DE UNA FÓRMULA
 *
 * `resolvePrice` es quien sabe de reglas por socio, por canal, por temporada y
 * por cantidad. Reconstruir aquí «precio base menos comisión» habría dado un
 * número parecido casi siempre, que es la peor clase de número: el que nadie
 * revisa hasta que no cuadra.
 */

export interface LineaTarifario {
  product_id: string;
  product_code: string | null;
  product_name: string;
  modality_id: string | null;
  modality_name: string | null;
  currency: string;
  /** Lo que se le factura al socio por persona. */
  net_price: number;
  /** Qué regla ganó, para que una discusión no empiece desde cero. */
  rule: string | null;
}

/**
 * El tarifario de un socio para una fecha.
 *
 * La FECHA importa y por eso es obligatoria: las reglas tienen temporada, así
 * que «el tarifario» sin día no existe. Un archivo sin fecha dentro es el que
 * alguien reenvía en noviembre con los precios de agosto.
 */
export async function tarifarioDeSocio(
  companyId: string,
  partnerId: string,
  fecha: string
): Promise<LineaTarifario[]> {
  /**
   * EL TARIFARIO, ENTERO.
   *
   * Este es el documento contra el que el socio pone precio a lo que vende y
   * contra el que después reclama. Un producto que falte aquí no es una línea
   * menos en una tabla: es un producto que el socio cree no tener y deja de
   * vender, o que vende al precio equivocado porque lo buscó en otra parte.
   *
   * Y la fase 6.3 puso una prueba de que el tarifario descargable COINCIDE con
   * lo que devuelve la API. Con dos topes iguales, coincidían los dos en estar
   * cortados.
   */
  const autorizaciones = await leerTodoElRecurso<Record<string, unknown>>("partner_product", (limite, salto) =>
    tenantQuery(companyId, "partner_product", {
    _filter: { partner: partnerId, status: "active" },
    _sort: { created_at: "asc", _id: "asc" },
    _limit: limite, _offset: salto,
    }));
  const autorizados = [...autorizadosDe(autorizaciones as AutorizacionSocio[])];
  // Igual que el catálogo: sin nada autorizado no se consulta, en vez de fiarlo
  // a que `in: []` signifique «ninguno» en el traductor de turno.
  if (autorizados.length === 0) return [];

  const productos = await tenantQuery<Product & { product_modality?: ProductModality[] }>(
    companyId, "product",
    {
      _filter: { status: "active", _id: { in: autorizados } },
      _limit: 500, _sort: { name: "asc" },
      product_modality: { _limit: 20, _filter: { status: "active" } },
    }
  );

  const lineas: LineaTarifario[] = [];
  for (const producto of productos) {
    const modalidades = (producto.product_modality || []) as ProductModality[];
    // Sin modalidades declaradas, el producto tiene una tarifa y ya: se pide
    // una línea sin modalidad en vez de saltárselo, que dejaría al socio sin
    // precio para algo que sí puede vender.
    const objetivos: (ProductModality | null)[] = modalidades.length > 0 ? modalidades : [null];

    for (const modalidad of objetivos) {
      try {
        const precio = await resolvePrice({
          companyId,
          productId: producto._id,
          modalityId: modalidad?._id,
          partnerId,
          // El MISMO canal con el que reserva, por portal o por API. Con otro,
          // el tarifario diría un precio y la reserva cobraría otro.
          channel: "b2b_portal",
          quantity: 1,
          travelDate: fecha,
        });
        lineas.push({
          product_id: producto._id,
          product_code: producto.code ?? null,
          product_name: producto.name ?? "Excursión",
          modality_id: modalidad?._id ?? null,
          modality_name: modalidad?.name ?? null,
          currency: precio.currency,
          net_price: precio.unitPrice,
          rule: precio.snapshot.applied_rule_name ?? null,
        });
      } catch (err) {
        /**
         * Un producto sin tarifa no rompe el tarifario entero: se queda fuera.
         *
         * Lo contrario —fallar el archivo completo— le quitaría al socio los
         * cuarenta precios que sí tiene por culpa del que falta, y el arreglo
         * está del lado de la operadora, no del suyo.
         */
        console.error(
          `[tarifario] sin tarifa para ${producto.name} (${producto._id}):`,
          (err as Error).message
        );
      }
    }
  }
  return lineas;
}
