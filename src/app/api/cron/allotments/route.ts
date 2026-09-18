import { NextRequest } from "next/server";
import { supabaseService } from "@/lib/supabase/service";
import { ok, fail } from "@/lib/api-response";
import { startJobRun, finishJobRun, reportIncident } from "@/lib/system-health-service";
import { TenantError } from "@/lib/tenant";
import { notify } from "@/lib/notify-service";
import { shouldRelease, releasableSeats, type AllotmentRow } from "@/lib/allotments";

/**
 * GET /api/cron/allotments — la liberación automática de cupos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ARREGLA
 *
 * `release_days` es el corazón de un contrato de plazas: «te guardo 10 hasta 3
 * días antes; lo que no vendas vuelve a la venta libre». Existe en la tabla
 * desde 0010 y NO LIBERABA NUNCA. Un cupo garantizado que el socio no usa se
 * quedaba bloqueado hasta la salida, y esas plazas se perdían — la operadora
 * decía «completo» con diez asientos vacíos que nadie iba a ocupar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ES SEGURO QUE CORRA DOS VECES
 *
 * `seats_released` acumula y lo liberable se calcula como contratadas menos
 * vendidas menos liberadas: un segundo barrido del mismo día no encuentra nada
 * que liberar. Sin esa resta, un reintento del cron devolvería a venta libre
 * plazas que ya estaban en venta libre, y la salida aceptaría más reservas de
 * las que caben.
 *
 * Como el resto de los trabajos programados recorre TODOS los inquilinos, así
 * que se autentica con el secreto del cron y usa el cliente de servicio con
 * `organization_id` explícito: bajo RLS, las ayudas de inquilino resuelven la
 * sesión desde las cookies de la petición, que un cron no tiene.
 */
export const dynamic = "force-dynamic";

/** Hasta cuántos días por delante se miran las salidas. */
const HORIZON_DAYS = 90;

interface Row extends AllotmentRow {
  id: string;
  organization_id: string;
  release_runs?: number | null;
  departure_id: string | null;
}

export async function GET(req: NextRequest) {
  let runId: string | null = null;
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new TenantError("CRON_SECRET no está configurado en el entorno", 503);
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      console.warn("[cron/allotments] intento de ejecución sin credencial válida");
      throw new TenantError("No autorizado", 401);
    }

    runId = await startJobRun("allotments");

    const now = new Date();

    // Solo los cupos que APARTAN plazas y están atados a una salida: un cupo de
    // producto sin salida no tiene fecha contra la que contar los días, y
    // liberarlo «por si acaso» le quitaría plazas a un contrato vigente.
    const { data, error } = await supabaseService()
      .from("allotment")
      .select("id, organization_id, allotment_type, seats, seats_used, seats_released, release_days, release_runs, departure_id, partner_id")
      .eq("allotment_type", "guaranteed")
      .eq("status", "active")
      .not("release_days", "is", null)
      .not("departure_id", "is", null)
      .limit(3000);

    if (error) throw new Error(error.message);
    const rows = (data || []) as unknown as Row[];

    // Las fechas de salida, en una consulta. Un cron que hace una lectura por
    // fila se cae en la empresa que más cupos tiene, que es justo donde más
    // falta hace.
    const departureIds = [...new Set(rows.map((r) => r.departure_id).filter((x): x is string => Boolean(x)))];
    const dates = new Map<string, string>();
    if (departureIds.length > 0) {
      const horizon = new Date(now.getTime() + HORIZON_DAYS * 86_400_000).toISOString();
      const { data: deps } = await supabaseService()
        .from("departure")
        .select("id, departure_at")
        .in("id", departureIds)
        .lte("departure_at", horizon);
      for (const d of (deps || []) as { id: string; departure_at: string | null }[]) {
        if (d.departure_at) dates.set(d.id, d.departure_at);
      }
    }

    let released = 0;
    let seatsTotal = 0;

    for (const row of rows) {
      const departureAt = row.departure_id ? dates.get(row.departure_id) : null;
      if (!departureAt) continue;
      if (!shouldRelease(row, departureAt, now)) continue;

      const seats = releasableSeats(row);
      if (seats <= 0) continue;

      const { error: upErr } = await supabaseService()
        .from("allotment")
        .update({
          seats_released: Math.max(0, Math.floor(Number(row.seats_released ?? 0))) + seats,
          released_at: now.toISOString(),
          release_runs: Math.max(0, Math.floor(Number(row.release_runs ?? 0))) + 1,
        })
        .eq("id", row.id)
        .eq("organization_id", row.organization_id);

      if (upErr) {
        console.error(`[cron/allotments] no se pudo liberar ${row.id}:`, upErr.message);
        continue;
      }

      released += 1;
      seatsTotal += seats;

      // Se avisa al equipo comercial: son plazas que acaban de volver a estar
      // disponibles y que alguien puede vender hoy mismo.
      await notify({
        companyId: row.organization_id,
        event: "allotment_released",
        entityType: "allotment",
        entityId: row.id,
        dedupeSeed: now.toISOString().slice(0, 10),
        vars: { plazas: seats, fecha: departureAt.slice(0, 10) },
      });
    }

    console.log(`[cron/allotments] ${rows.length} cupos revisados · ${released} liberados · ${seatsTotal} plazas`);
    await finishJobRun(runId, { status: "ok", summary: { reviewed: rows.length, released, seats: seatsTotal } });
    return ok({ reviewed: rows.length, released, seats: seatsTotal, ranAt: now.toISOString() });
  } catch (err) {
    console.error("[cron/allotments] error:", err);
    await finishJobRun(runId, { status: "failed", error: String(err) });
    await reportIncident({ source: "cron:allotments", error: err });
    return fail(err);
  }
}
