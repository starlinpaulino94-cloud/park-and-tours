/**
 * QUÉ CUENTA COMO «BAJO», EN UN SOLO SITIO Y SIN SERVIDOR.
 *
 * Estas dos funciones vivían en `inventory.ts`, que es `server-only` porque toca
 * la base. La pantalla de existencias necesita el MISMO criterio para pintar la
 * lista de reposición, y un componente de cliente no puede importar ese fichero:
 * la salida fácil era copiar el umbral en la pantalla.
 *
 * No se copia. El propio código del inventario lleva avisado desde 0052 que con
 * **dos definiciones de «bajo», la pantalla señala lo que la campana calla** — la
 * campana (el aviso automático de `postMovement`), la lista de compras y ahora la
 * pantalla salen todas de aquí.
 *
 * Es puro a propósito: sin `server-only`, sin imports, sin base. Por eso se
 * prueba en `inventory.test.ts` sin montar nada.
 */

export interface Reorderable {
  name?: string | null;
  min_stock?: number | null;
  reorder_point?: number | null;
}

/**
 * El umbral por debajo del cual un artículo se considera bajo.
 *
 * Es el punto de pedido si está puesto y, si no, el mínimo. Un artículo sin
 * ninguno de los dos NO tiene umbral: devolver 0 lo convertiría en «bajo» en
 * cuanto se agotara, y avisaría de cosas que a nadie le importan —el sistema no
 * sabe cuántas necesita esa empresa si nadie se lo dijo.
 */
export function reorderThreshold(item: Reorderable | null | undefined): number | null {
  const point = Number(item?.reorder_point ?? item?.min_stock ?? 0);
  return point > 0 ? point : null;
}

/** ¿Este saldo está en el umbral o por debajo? */
export function isLowStock(available: number, item: Reorderable | null | undefined): boolean {
  const threshold = reorderThreshold(item);
  return threshold !== null && Number(available) <= threshold;
}
