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
      title: built.title,
      message: built.message || null,
      notification_type: built.notification_type,
      link: built.link,
      // Un aviso personal no necesita rol: ya tiene nombre y apellido.
      audience_role: input.userId ? null : built.audience_role,
      event_key: built.event_key,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      dedupe_key: dedupeKeyFor(input.event, {
        entityId: input.entityId,
        userId: input.userId,
        seed: input.dedupeSeed,
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
