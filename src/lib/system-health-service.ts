import "server-only";
import { supabaseService } from "@/lib/supabase/service";
import {
  JOB_EXPECTATIONS, expectationFor, jobHealth, overallLevel, incidentsLevel,
  fingerprintOf, safeMessage, safeContext, sortBySeverity,
  type HealthCheck, type HealthLevel, type JobRunLite, type IncidentLite,
} from "@/lib/system-health";

/**
 * LO QUE HABLA CON LA BASE.
 *
 * El dominio puro decide qué está sano; esto lo alimenta. Va siempre con el
 * cliente de SERVICIO y no con las ayudas de inquilino: quien llama es un cron,
 * el propio arranque o una sonda externa, y ninguno tiene sesión. Bajo RLS, las
 * ayudas de inquilino resuelven la empresa desde las cookies de la petición y
 * leerían cero filas diciendo que todo va bien — que es la peor respuesta
 * posible en una comprobación de salud.
 */

// ─────────────────────────────────────────────────────────────────────────────
// El diario de trabajos
// ─────────────────────────────────────────────────────────────────────────────

export type JobTrigger = "cron" | "manual" | "webhook";

/**
 * Abre la ejecución AL EMPEZAR y devuelve su identificador.
 *
 * Se escribe antes de hacer nada a propósito: una fila que se queda en
 * 'running' es la única señal posible de un trabajo que se colgó. Si solo se
 * escribiera al terminar, un trabajo que nunca termina no dejaría rastro y
 * parecería que sencillamente no le tocaba correr.
 */
export async function startJobRun(job: string, trigger: JobTrigger = "cron"): Promise<string | null> {
  try {
    const sb = supabaseService();
    const { data, error } = await sb
      .from("job_run")
      .insert({ job, trigger })
      .select("id")
      .single();
    if (error) throw error;
    return String(data.id);
  } catch (err) {
    // Que no se pueda apuntar la ejecución NO puede impedir la ejecución. El
    // diario es para saber qué pasó; si falla, lo que pasa es el trabajo.
    console.error(`[salud] no se pudo abrir el diario de ${job}:`, err);
    return null;
  }
}

export async function finishJobRun(
  id: string | null,
  outcome: { status: "ok" | "failed"; summary?: Record<string, unknown>; error?: string }
): Promise<void> {
  if (!id) return;
  try {
    const sb = supabaseService();
    await sb.from("job_run").update({
      status: outcome.status,
      finished_at: new Date().toISOString(),
      summary: outcome.summary ?? {},
      error: outcome.error ? safeMessage(outcome.error) : null,
    }).eq("id", id);
  } catch (err) {
    console.error("[salud] no se pudo cerrar el diario:", err);
  }
}

/** Lo que hizo un trabajo PARA UNA EMPRESA, que es lo que a esa empresa le importa. */
export async function recordOrgSlice(
  job: string,
  organizationId: string,
  summary: Record<string, unknown>
): Promise<void> {
  try {
    const sb = supabaseService();
    await sb.from("job_run").insert({
      organization_id: organizationId, job, status: "ok",
      finished_at: new Date().toISOString(), summary,
    });
  } catch (err) {
    console.error(`[salud] no se pudo apuntar lo que ${job} hizo para ${organizationId}:`, err);
  }
}

/**
 * Envuelve un trabajo: lo apunta al empezar, lo cierra pase lo que pase.
 *
 * El `finally` es el punto: un trabajo que revienta a mitad tiene que dejar su
 * fila cerrada con el motivo, no quedarse en 'running' para siempre — eso ya
 * significa otra cosa (colgado) y confundir las dos haría inútiles las dos.
 */
export async function withJobRun<T>(
  job: string,
  run: () => Promise<{ result: T; summary?: Record<string, unknown> }>,
  trigger: JobTrigger = "cron"
): Promise<T> {
  const id = await startJobRun(job, trigger);
  try {
    const { result, summary } = await run();
    await finishJobRun(id, { status: "ok", summary });
    return result;
  } catch (err) {
    await finishJobRun(id, { status: "failed", error: safeMessage(err) });
    await reportIncident({ source: `cron:${job}`, error: err });
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Los incidentes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apunta un fallo, agrupado por huella.
 *
 * Nunca lanza. Un registro de incidentes que hace fallar la petición que
 * intentaba registrar convierte un fallo en dos, y el segundo tapa al primero.
 */
export async function reportIncident(input: {
  organizationId?: string | null;
  source: string;
  error: unknown;
  level?: "error" | "warning";
  context?: unknown;
}): Promise<void> {
  try {
    const message = safeMessage(input.error);
    const sb = supabaseService();
    const { error } = await sb.rpc("report_incident", {
      p_organization_id: input.organizationId ?? null,
      p_fingerprint: fingerprintOf(input.source, message),
      p_source: input.source,
      p_message: message,
      p_level: input.level ?? "error",
      p_context: safeContext(input.context),
    });
    if (error) throw error;
  } catch (err) {
    console.error("[salud] no se pudo apuntar el incidente:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// El informe de salud
// ─────────────────────────────────────────────────────────────────────────────

/** Cuántos incidentes abiertos se miran para decidir el estado. */
const INCIDENT_WINDOW = 200;

async function lastRuns(): Promise<Map<string, JobRunLite>> {
  const sb = supabaseService();
  const out = new Map<string, JobRunLite>();
  const { data } = await sb
    .from("job_run")
    .select("job, started_at, finished_at, status, error")
    .is("organization_id", null)
    .order("started_at", { ascending: false })
    .limit(400);
  for (const row of data ?? []) {
    // La primera que aparece de cada trabajo es la más reciente: viene ordenado.
    if (!out.has(row.job)) out.set(row.job, row as JobRunLite);
  }
  return out;
}

/**
 * El informe completo, que es lo que responde `/api/health`.
 *
 * Cada comprobación se mide por separado y NINGUNA puede tumbar al resto: si
 * preguntar por los incidentes falla, eso se convierte en una comprobación en
 * rojo, no en un 500 que deja sin saber si la base está viva.
 */
export async function healthReport(): Promise<{
  level: HealthLevel;
  checks: HealthCheck[];
  checked_at: string;
}> {
  const checks: HealthCheck[] = [];

  const timed = async (key: string, label: string, run: () => Promise<HealthCheck>) => {
    const started = Date.now();
    try {
      const check = await run();
      checks.push({ ...check, ms: Date.now() - started });
    } catch (err) {
      checks.push({
        key, label, level: "down",
        detail: `No se pudo comprobar: ${safeMessage(err)}`,
        ms: Date.now() - started,
      });
    }
  };

  // 1. ¿Responde la base?
  await timed("db", "Base de datos", async () => {
    const sb = supabaseService();
    const { error } = await sb.from("organizations").select("id", { head: true, count: "exact" }).limit(1);
    if (error) throw error;
    return { key: "db", label: "Base de datos", level: "ok", detail: "Responde." };
  });

  // 2. ¿Puede alguien iniciar sesión? Es la pregunta que este sistema ya falló.
  await timed("auth_hook", "Emisión de sesiones", async () => {
    const sb = supabaseService();
    const { data, error } = await sb.rpc("health_probe");
    if (error) throw error;
    const hook = (data as { auth_hook?: Record<string, boolean> })?.auth_hook ?? {};
    if (!hook.exists) {
      return { key: "auth_hook", label: "Emisión de sesiones", level: "down", detail: "El enganche del token no existe: nadie puede entrar." };
    }
    if (!hook.security_definer || !hook.has_search_path) {
      return {
        key: "auth_hook", label: "Emisión de sesiones", level: "down",
        detail: "El enganche perdió SECURITY DEFINER o su search_path: GoTrue responderá 500 y nadie obtendrá sesión nueva.",
      };
    }
    return { key: "auth_hook", label: "Emisión de sesiones", level: "ok", detail: "El enganche del token está bien declarado." };
  });

  // 3. ¿Corrieron los trabajos de anoche?
  const runs = await lastRuns().catch(() => new Map<string, JobRunLite>());
  for (const expectation of JOB_EXPECTATIONS) {
    checks.push(jobHealth(expectation, runs.get(expectation.job) ?? null));
  }

  // 4. ¿Hay algo fallando ahora mismo?
  await timed("incidents", "Incidentes abiertos", async () => {
    const sb = supabaseService();
    const { data, error } = await sb
      .from("system_incident")
      .select("fingerprint, level, occurrences, last_seen_at, status")
      .neq("status", "resolved")
      .order("last_seen_at", { ascending: false })
      .limit(INCIDENT_WINDOW);
    if (error) throw error;
    const rows = (data ?? []) as IncidentLite[];
    const level = incidentsLevel(rows);
    return {
      key: "incidents", label: "Incidentes abiertos", level,
      detail: rows.length === 0 ? "Ninguno." : `${rows.length} sin resolver.`,
    };
  });

  return {
    level: overallLevel(checks),
    checks: sortBySeverity(checks),
    checked_at: new Date().toISOString(),
  };
}

export { expectationFor };
