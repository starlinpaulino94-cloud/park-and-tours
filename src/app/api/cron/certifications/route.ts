import { NextRequest } from "next/server";
import { supabaseService } from "@/lib/supabase/service";
import { ok, fail } from "@/lib/api-response";
import { startJobRun, finishJobRun, reportIncident, barridoVigilado } from "@/lib/system-health-service";
import type { ResumenBarrido } from "@/lib/barrido";
import { TenantError } from "@/lib/tenant";
import { notify } from "@/lib/notify-service";
import { certificationState, EXPIRING_WINDOW_DAYS } from "@/lib/hr";

/**
 * GET /api/cron/certifications — el barrido diario de las acreditaciones.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ARREGLA
 *
 * `certification.status` se tecleaba al registrar y no se volvía a tocar. Se
 * escribía «vigente» el día del alta y ahí se quedaba: la fecha de vencimiento
 * pasaba, la insignia seguía verde, y el listado de certificaciones —que
 * existe precisamente para eso— no servía para saber qué hay que renovar.
 *
 * Este trabajo pone el estado guardado al día con el calendario y avisa una
 * vez por certificación. Una vez, no cada mañana: `reminder_sent_at` es lo que
 * separa un aviso útil de treinta avisos que nadie lee.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE NO DEPENDE DE ESTE CRON
 *
 * El BLOQUEO no. Quien impide asignar a alguien con la licencia vencida es
 * `assertStaffAssignable`, que deduce el estado del calendario en el momento de
 * asignar. Si este trabajo no corriera en una semana, las insignias se
 * quedarían viejas pero nadie subiría a un bote con el curso caducado.
 *
 * Como el resto de los trabajos programados recorre TODOS los inquilinos, así
 * que se autentica con el secreto del cron y usa el cliente de servicio con
 * `organization_id` explícito: bajo RLS, las ayudas de inquilino resuelven la
 * sesión desde las cookies de la petición, que un cron no tiene.
 */
export const dynamic = "force-dynamic";

/** Cada cuántos días se puede repetir el aviso de la misma certificación. */
const REMINDER_COOLDOWN_DAYS = 30;

interface CertRow {
  id: string;
  organization_id: string;
  name: string | null;
  expires_at: string | null;
  status: string | null;
  blocks_assignment: boolean | null;
  reminder_sent_at: string | null;
  staff_id: string | null;
}

export async function GET(req: NextRequest) {
  let runId: string | null = null;
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new TenantError("CRON_SECRET no está configurado en el entorno", 503);
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      console.warn("[cron/certifications] intento de ejecución sin credencial válida");
      throw new TenantError("No autorizado", 401);
    }

    runId = await startJobRun("certifications");

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const horizon = new Date(now.getTime() + EXPIRING_WINDOW_DAYS * 86_400_000)
      .toISOString().slice(0, 10);

    // Solo lo que puede cambiar de estado hoy: lo que vence dentro de la
    // ventana o ya venció. Lo que caduca en 2030 no se toca todas las mañanas.
    /**
     * RECORRIDO: marcar una certificación como `expired` la deja dentro del
     * filtro —solo se excluyen `revoked` y `pending`—, así que la ventana
     * avanza.
     *
     * Por fecha de vencimiento: lo que venció antes se trata antes. El tope de
     * tres mil de antes no tenía orden, así que cuál se quedaba fuera lo
     * decidía el montón. Y lo que se queda fuera aquí es un chofer con el
     * permiso vencido que el sistema sigue dando por bueno: `blocks_assignment`
     * no se enciende, el despacho lo asigna, y sube a la guagua alguien que no
     * puede conducirla.
     */
    const rows: CertRow[] = [];
    const barrido: ResumenBarrido = await barridoVigilado<CertRow>({
      etiqueta: "certificaciones",
      modo: "recorrido",
      idDe: (row) => row.id,
      leer: async (desde, hasta) => {
        const { data, error } = await supabaseService()
          .from("certification")
          .select("id, organization_id, name, expires_at, status, blocks_assignment, reminder_sent_at, staff_id")
          .not("expires_at", "is", null)
          .lte("expires_at", horizon)
          // Revocada y pendiente son decisiones de una persona: el calendario
          // no las pisa.
          .not("status", "in", "(revoked,pending)")
          .order("expires_at", { ascending: true })
          .order("id", { ascending: true })
          .range(desde, hasta);
        if (error) throw new Error(error.message);
        return (data || []) as CertRow[];
      },
      tratar: async (filas) => { rows.push(...filas); },
    });

    // El nombre de la persona, para que el aviso diga a quién buscar. Una sola
    // consulta: un cron que hace una lectura por fila se cae en la empresa que
    // más personal tiene, que es justo donde más falta hace.
    const staffIds = [...new Set(rows.map((r) => r.staff_id).filter((x): x is string => Boolean(x)))];
    const names = new Map<string, string>();
    if (staffIds.length > 0) {
      const { data: staff } = await supabaseService()
        .from("staff").select("id, full_name").in("id", staffIds);
      for (const s of (staff || []) as { id: string; full_name: string | null }[]) {
        names.set(s.id, s.full_name || "Sin nombre");
      }
    }

    let updated = 0;
    let notified = 0;

    for (const row of rows) {
      const state = certificationState(
        { expires_at: row.expires_at, status: row.status, blocks_assignment: row.blocks_assignment },
        today
      );
      if (state !== "expired" && state !== "expiring") continue;

      const patch: Record<string, unknown> = { checked_at: now.toISOString() };
      if (row.status !== state) {
        patch.status = state;
        updated += 1;
      }

      // El aviso se repite como mucho una vez al mes: la certificación sigue
      // vencida mañana, y repetirlo a diario es la forma más rápida de que el
      // encargado deje de abrir la campana.
      const last = row.reminder_sent_at ? Date.parse(row.reminder_sent_at) : 0;
      const cooled = !last || now.getTime() - last > REMINDER_COOLDOWN_DAYS * 86_400_000;
      if (cooled) {
        await notify({
          companyId: row.organization_id,
          event: "certification_expiring",
          entityType: "certification",
          entityId: row.id,
          // La misma certificación puede avisar en marzo y en abril: sin la
          // semilla, la clave única la silenciaría para siempre tras el primero.
          dedupeSeed: `${state}:${today.slice(0, 7)}`,
          vars: {
            certificacion: row.name || "sin nombre",
            persona: row.staff_id ? names.get(row.staff_id) ?? null : null,
            vence: row.expires_at,
            estado: state,
            bloquea: row.blocks_assignment ? 1 : 0,
          },
        });
        patch.reminder_sent_at = now.toISOString();
        notified += 1;
      }

      const { error: upErr } = await supabaseService()
        .from("certification")
        .update(patch)
        .eq("id", row.id)
        .eq("organization_id", row.organization_id);
      if (upErr) console.error(`[cron/certifications] no se pudo actualizar ${row.id}:`, upErr.message);
    }

    console.log(`[cron/certifications] ${rows.length} revisadas · ${updated} al día · ${notified} avisos`);
    await finishJobRun(runId, { status: "ok", summary: { reviewed: rows.length, updated, notified, barrido } });
    return ok({ reviewed: rows.length, updated, notified, barrido, ranAt: now.toISOString() });
  } catch (err) {
    console.error("[cron/certifications] error:", err);
    await finishJobRun(runId, { status: "failed", error: String(err) });
    await reportIncident({ source: "cron:certifications", error: err });
    return fail(err);
  }
}
