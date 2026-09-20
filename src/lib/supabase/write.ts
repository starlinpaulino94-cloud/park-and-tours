/**
 * ESCRIBIR EN LA BASE SIN FE.
 *
 * `supabaseService()` no lanza cuando Postgres dice que no: devuelve el error
 * DENTRO del resultado. Por eso esto compila, pasa la revisión y no hace nada:
 *
 *     await sb.from("sales_order").update({ hold_until }).eq("id", id);
 *
 * El `await` espera a la respuesta y tira el error al suelo. La función sigue,
 * contesta que sí, y lo que creía escrito no está. Es el mismo bug veintiuna
 * veces en este repositorio (AUD-M05), y sus finales son siempre los mismos:
 * una retención que no caduca nunca, un reintento que duplica la venta, una
 * suscripción cobrada que sigue en «pendiente de pago».
 *
 * Aquí hay dos verbos, y elegir entre ellos es la única decisión de diseño:
 *
 *  · `mustWrite` — la operación NO vale sin esta escritura. Lanza.
 *  · `tryWrite`  — lo que importa ya pasó y no se puede deshacer (el dinero se
 *                  movió, el correo salió, la reserva se canceló). Tumbarlo
 *                  ahora sería peor que el dato que falta, pero callarse no es
 *                  una opción: devuelve `false` y deja el motivo en el registro.
 *
 * Lo que NO existe es una tercera forma, la de escribir y no mirar.
 */

interface Escritura {
  error: { message: string } | null;
}

/** La escritura tiene que llegar. Si no llega, lanza. */
export async function mustWrite(accion: string, escritura: PromiseLike<Escritura>): Promise<void> {
  const { error } = await escritura;
  if (error) {
    console.error(`[supabase] no se pudo ${accion}:`, error.message);
    throw Object.assign(new Error(`No se pudo ${accion}.`), { status: 500, cause: error.message });
  }
}

/**
 * La escritura se intenta y, si falla, se deja escrito que falló.
 *
 * Devuelve si llegó, para que quien llama pueda no contarla como hecha —no
 * marcar un recordatorio como enviado, no sumar un consumo— en vez de mentir
 * dos veces.
 */
export async function tryWrite(accion: string, escritura: PromiseLike<Escritura>): Promise<boolean> {
  try {
    const { error } = await escritura;
    if (!error) return true;
    console.error(`[supabase] no se pudo ${accion}:`, error.message);
    return false;
  } catch (err) {
    console.error(`[supabase] no se pudo ${accion}:`, err);
    return false;
  }
}
