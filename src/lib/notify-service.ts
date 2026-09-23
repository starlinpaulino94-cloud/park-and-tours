import "server-only";
import { supabaseService } from "@/lib/supabase/service";
import { buildNotification, dedupeKeyFor, type NotifyEventKey, type NotifyVars } from "@/lib/notify";

/**
 * Escribir el aviso interno. Sin base de datos no hay decisiones aquí: el texto,
 * el destinatario y el enlace los decide `notify.ts`, que es puro.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TRES PROPIEDADES, Y LAS TRES SON DELIBERADAS
 *
 *  1. NUNCA LANZA. Igual que la contabilidad automática, un aviso es una capa
 *     de información: que no se pueda escribir no puede cancelar la venta, el
 *     cierre de caja ni el reembolso que lo provocó. Se registra en consola y
 *     la operación sigue.
 *  2. NO SE REPITE. La clave la arma `dedupeKeyFor` y la hace cumplir un
 *     índice único en 0044. El cron de cobranza mira las mismas deudas todos
 *     los días; sin dedupe, a la semana habría siete copias de cada aviso y
 *     nadie volvería a abrir la bandeja.
 *  3. VA POR EL ROL DE SERVICIO. Se llama también desde crons, que no tienen
 *     cookies: bajo RLS las ayudas de inquilino resolverían cero filas. El
 *     ámbito lo pone el `organization_id` explícito de cada inserción.
 */

export interface NotifyInput {
  companyId: string;
  event: NotifyEventKey;
  vars?: NotifyVars;
  /** Sobre qué fila avisa: permite abrirla y es parte de la clave de dedupe. */
  entityType?: string;
  entityId?: string | null;
  /**
   * Para una persona concreta.
   *
   * Sin esto el aviso es de empresa y lo ve quien alcance el rol del catálogo.
   * Con esto es personal: el vendedor cuya cotización aceptaron, y nadie más.
   */
  userId?: string | null;
  /**
   * Para un TOUR CENTER entero.
   *
   * `notification.partner_id` está en la tabla desde 0009 y nadie la escribía:
   * al socio no se le contaba nada. Va a la empresa y no a cada persona porque
   * dentro de un tour center todos los accesos son iguales por construcción
   * (0073), y porque así un miembro que entra hoy ve lo de la semana pasada —
   * que es justo lo que un buzón por persona no da.
   */
  partnerId?: string | null;
  /**
   * Distingue dos avisos del mismo evento cuando no hay una fila que los
   * distinga: el del plan lo usa para repetirse una vez al mes por métrica.
   */
  dedupeSeed?: string | null;
}

/** Violación de índice único: el aviso ya existía. No es un fallo. */
const DUPLICATE = "23505";

export async function notify(input: NotifyInput): Promise<void> {
  try {
    const built = buildNotification(input.event, input.vars ?? {});
    const { error } = await supabaseService().from("notification").insert({
      organization_id: input.companyId,
      user_id: input.userId ?? null,
      partner_id: input.partnerId ?? null,
      title: built.title,
      message: built.message || null,
      notification_type: built.notification_type,
      link: built.link,
      /**
       * Un aviso personal no necesita rol: ya tiene nombre y apellido. Y uno de
       * socio TAMPOCO puede llevarlo: el `check` de 0044 solo admite los seis
       * roles internos, así que un `audience_role: "partner"` haría fallar el
       * insert entero y el aviso se perdería en silencio. El destinatario de
       * esos va en `partner_id`, que es donde el buzón lo busca.
       */
      audience_role: input.userId || input.partnerId ? null : built.audience_role,
      event_key: built.event_key,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      dedupe_key: dedupeKeyFor(input.event, {
        entityId: input.entityId,
        userId: input.userId,
        /**
         * El socio entra por la semilla y no por un campo nuevo, a propósito:
         * añadir un sexto trozo a la clave cambiaría la de TODOS los avisos ya
         * escritos, y el índice único dejaría pasar una copia de cada uno.
         */
        seed: input.dedupeSeed ?? input.partnerId ?? null,
      }),
      read_status: false,
    });

    // El duplicado es el índice haciendo su trabajo, no un error que reportar:
    // registrarlo llenaría la consola con una línea por cada vuelta del cron.
    if (error && error.code !== DUPLICATE) {
      console.error(`[notify] no se pudo escribir el aviso ${input.event}:`, error.message);
    }
  } catch (err) {
    console.error(`[notify] no se pudo escribir el aviso ${input.event}:`, err);
  }
}
