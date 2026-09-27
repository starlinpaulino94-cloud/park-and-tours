import "server-only";
import { supabaseService } from "@/lib/supabase/service";
import { mustRead } from "@/lib/supabase/io";
import { writeAudit } from "@/lib/audit";
import { TenantError, esDeProveedor, esInterno, type TenantContext } from "@/lib/tenant";
import {
  hojaAbierta, puedeMarcar, esperoLoSuficiente, ETIQUETA_DE_PARADA,
  type MarcaDelChofer, type EstadoDeParada,
} from "@/lib/hoja-de-ruta";

/**
 * MARCAR UNA PARADA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * «RECOGIDO» Y «NO-SHOW» ESTABAN EN EL ESQUEMA DESDE 0011 Y NADIE LOS ESCRIBÍA
 *
 * El estado de una parada admitía los dos valores y no había en toda la
 * aplicación una sola línea que los pusiera: la operadora se enteraba de que un
 * cliente no bajó cuando llamaba a reclamar.
 *
 * Y un no-show no es un dato: es una ACUSACIÓN. Dice que alguien pagó, no se
 * presentó y no le toca reembolso. Por eso esto escribe la hora y el nombre de
 * quien marcó (0088), y por eso deja constancia de si se esperó — sin eso, la
 * discusión es la palabra del chofer contra la del turista.
 */

export interface ParadaMarcada {
  id: string;
  estado: EstadoDeParada;
  marked_at: string;
  /** `null` cuando no se puede saber: sin hora prevista no hay contra qué comparar. */
  espero_lo_suficiente: boolean | null;
}

interface FilaDeParada {
  id: string;
  organization_id: string;
  route_id: string | null;
  supplier_id: string | null;
  service_date: string | null;
  planned_time: string | null;
  pickup_time: string | null;
  status: string | null;
}

const COLUMNAS =
  "id,organization_id,route_id,supplier_id,service_date,planned_time,pickup_time,status";

export async function marcarParada(
  ctx: TenantContext & { companyId: string },
  pickupId: string,
  marca: MarcaDelChofer,
  ahora: Date = new Date()
): Promise<ParadaMarcada> {
  const id = (pickupId || "").trim();
  if (!id) throw new TenantError("Indica la parada", 400);

  const fila = await mustRead<FilaDeParada>(
    "leer la parada",
    supabaseService().from("pickup").select(COLUMNAS)
      .eq("id", id).eq("organization_id", ctx.companyId).limit(1).maybeSingle()
  );
  if (!fila) throw new TenantError("Esa parada no existe", 404);

  /**
   * El ámbito, con las MISMAS reglas que la hoja: el chofer solo marca las
   * paradas de sus rutas y solo alrededor del servicio. Si la hoja se cierra a
   * las doce horas pero las marcas siguieran abiertas, la ventana no serviría
   * de nada — se marcaría a ciegas contra una lista que ya no se puede ver.
   */
  if (esDeProveedor(ctx)) {
    if (!ctx.supplierId || fila.supplier_id !== ctx.supplierId) {
      throw new TenantError("Esa parada no es tuya", 403);
    }
    if (!hojaAbierta(fila.service_date, ahora)) {
      throw new TenantError("Esta hoja de ruta ya no está disponible", 403);
    }
  } else if (!esInterno(ctx)) {
    throw new TenantError("No tienes acceso a este recurso", 403);
  }

  if (!puedeMarcar(fila.status)) {
    // Una parada cancelada no se marca: el cliente avisó, y ponerle un no-show
    // le cuelga un incumplimiento a quien hizo las cosas bien.
    throw new TenantError("Esa parada está cancelada", 409);
  }

  const via = esDeProveedor(ctx) ? "chofer" : "operacion";
  const marcadoEn = ahora.toISOString();

  /**
   * UNA sola sentencia, con la identidad en el WHERE.
   *
   * Comprobar arriba y escribir después deja una rendija entre las dos —la
   * parada puede cambiar de ruta en ese hueco—. En el WHERE no hay rendija, y
   * dos toques del mismo botón no son dos marcas distintas.
   */
  let escritura = supabaseService().from("pickup")
    .update({ status: marca, marked_at: marcadoEn, marked_by: ctx.userId ?? null, marked_via: via })
    .eq("id", id)
    .eq("organization_id", ctx.companyId)
    .neq("status", "cancelled");
  if (esDeProveedor(ctx)) escritura = escritura.eq("supplier_id", ctx.supplierId as string);

  const escritas = await mustRead<{ id: string }[]>(
    "marcar la parada",
    escritura.select("id")
  );
  if (!escritas || escritas.length === 0) {
    throw new TenantError("No se pudo marcar esa parada", 409);
  }

  const espero = marca === "no_show"
    ? esperoLoSuficiente(fila.planned_time ?? fila.pickup_time, ahora, fila.service_date)
    : null;

  await writeAudit({
    companyId: ctx.companyId,
    userId: ctx.userId,
    action: marca === "no_show" ? "pickup.no_show" : "pickup.picked_up",
    entityType: "pickup",
    entityId: id,
    description: `Parada marcada como «${ETIQUETA_DE_PARADA[marca]}» (${via})`,
    /**
     * Un no-show es una acusación, así que se anota como AVISO y no como
     * información: es lo que alguien va a buscar cuando el turista reclame.
     */
    severity: marca === "no_show" ? "warning" : "info",
    metadata: {
      route_id: fila.route_id,
      supplier_id: fila.supplier_id,
      estado_anterior: fila.status,
      hora_prevista: fila.planned_time ?? fila.pickup_time,
      espero_lo_suficiente: espero,
    },
  });

  return { id, estado: marca, marked_at: marcadoEn, espero_lo_suficiente: espero };
}
