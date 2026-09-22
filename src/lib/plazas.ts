/**
 * LAS PLAZAS LIBRES DE UNA SALIDA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * «NO LO SÉ» NO ES «AGOTADO»
 *
 * `departure.available_pax` es una CACHÉ: la recalcula `availability.ts` cada
 * vez que cambia una reserva. Como toda caché, puede no existir todavía —una
 * salida creada por SQL, una importación, una fila anterior a la migración que
 * añadió la columna—.
 *
 * El punto de venta hacía `available_pax ?? 0`. Eso convierte «no lo sé» en
 * «agotado»: el catálogo entero sale con 0 plazas en rojo, cada tarjeta dice
 * que no hay cupo y, al añadir algo a la venta, salta «Solo quedan 0 plazas».
 * Todo con salidas que en realidad están vacías.
 *
 * Es el mismo error que el cierre del día evita al no decir «0 % de ocupación»
 * cuando no hay cupo: un dato que falta y un dato que vale cero son cosas
 * distintas, y confundirlas hace que el sistema afirme algo que no sabe.
 *
 * Aquí, cuando la caché falta, se calcula desde el cupo y lo vendido, que es
 * exactamente lo que `availability.ts` habría guardado.
 */

export interface SalidaConCupo {
  capacity?: number | string | null;
  booked_pax?: number | string | null;
  pending_pax?: number | string | null;
  available_pax?: number | string | null;
}

/** Lee un número que puede venir como texto desde la base. */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Plazas libres, con la caché si la hay y calculadas si no.
 *
 * Devuelve `null` solo cuando no hay NADA con que responder: ni caché ni cupo.
 * Quien llame decide qué enseñar —«sin cupo definido» no es «agotado»—, pero al
 * menos no se lo inventa.
 */
export function plazasLibres(salida: SalidaConCupo | null | undefined): number | null {
  if (!salida) return null;

  const cache = num(salida.available_pax);
  if (cache !== null) return Math.max(0, cache);

  const cupo = num(salida.capacity);
  if (cupo === null) return null;

  const vendidas = (num(salida.booked_pax) ?? 0) + (num(salida.pending_pax) ?? 0);
  return Math.max(0, cupo - vendidas);
}

/**
 * Lo mismo, pero para pintar: `null` se convierte en 0 y se dice que es
 * desconocido, para que la interfaz pueda enseñar «sin cupo» en vez de un rojo
 * de agotado que asusta sin motivo.
 */
export function plazasParaMostrar(salida: SalidaConCupo | null | undefined): {
  libres: number;
  desconocido: boolean;
} {
  const libres = plazasLibres(salida);
  return libres === null ? { libres: 0, desconocido: true } : { libres, desconocido: false };
}

/** Las plazas libres de un producto: la suma de las de sus salidas. */
export function plazasDeProducto(salidas: SalidaConCupo[] | null | undefined): {
  libres: number;
  desconocido: boolean;
} {
  if (!salidas?.length) return { libres: 0, desconocido: true };
  let total = 0;
  let algunaSabida = false;
  for (const s of salidas) {
    const libres = plazasLibres(s);
    if (libres !== null) { total += libres; algunaSabida = true; }
  }
  // Si NINGUNA salida sabe su cupo, el total no es cero: es desconocido.
  return algunaSabida ? { libres: total, desconocido: false } : { libres: 0, desconocido: true };
}
