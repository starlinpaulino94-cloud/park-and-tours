import "server-only";
import { supabaseService } from "@/lib/supabase/service";
import { TenantError, type TenantContext } from "@/lib/tenant";
import { notify } from "@/lib/notify-service";
import type { ModuleKey } from "@/lib/types";
import { tryWrite } from "@/lib/supabase/io";
import {
  planStatus, limitCheck, limitMessage, metricLabel, moduleAllowed, moduleMessage, monthStart,
  type LimitMetric, type PlanSnapshot, type PlanStatus, type PlanUsage,
} from "@/lib/plan";

/**
 * El plan contra la base: qué plan tiene la empresa, cuánto lleva usado y las
 * guardas que se llaman en los puntos donde se crea algo que cuesta dinero.
 *
 * El USO SE CUENTA DESDE LOS DATOS, no desde contadores. Un contador aparte se
 * desincroniza —una reserva borrada, una transacción a medias, dos instancias
 * incrementando— y entonces cobra de más o deja pasar de más. Es la misma
 * decisión que toma `availability.ts` recalculando los pasajeros desde las
 * reservas en vez de confiar en un campo, y por el mismo motivo: el número que
 * decide tiene que salir de la realidad.
 *
 * Se lee con el cliente de SERVICIO y filtro explícito de `organization_id`:
 * `plan` y `organizations` no son tablas de inquilino (la primera es el
 * catálogo global de la plataforma, la segunda es la tabla de inquilinos), y
 * contar membresías exige ver filas que las políticas del propio inquilino no
 * siempre le muestran.
 */

/** El plan de la empresa. `null` = sin plan asignado → sin techo declarado. */
export async function loadPlan(planId: string | null | undefined): Promise<PlanSnapshot | null> {
  if (!planId) return null;
  const { data, error } = await supabaseService()
    .from("plan")
    .select("code, name, max_users, max_bookings_month, max_products, max_storage_mb, trial_days, modules_enabled, is_premium")
    .eq("id", planId)
    .maybeSingle();
  if (error) {
    // Un fallo leyendo el catálogo NO puede bloquear la operación: sin plan
    // conocido no hay techo, que es el lado correcto del error (principio 2 de
    // `plan.ts`). Queda en el log para que se note.
    console.error("[plan] no se pudo leer el plan:", error.message);
    return null;
  }
  return (data as PlanSnapshot | null) ?? null;
}

/**
 * El uso real de la empresa.
 *
 * · usuarios — membresías activas Y las invitaciones sin aceptar. La invitación
 *   RESERVA la plaza: si no contara, un plan de cinco aceptaría veinte
 *   invitaciones y el tope saltaría al aceptar la sexta —delante de alguien que
 *   ya recibió el correo y no entiende por qué no puede entrar—. Una cuenta
 *   desactivada sí libera su plaza, que es lo que permite rotar personal sin
 *   subir de plan.
 * · reservas — creadas desde el día 1 del mes en curso, sin filtrar por estado:
 *   una reserva cancelada se creó igual, y si no contara, cancelar y recrear
 *   sería un contador infinito.
 * · productos — los que no están inactivos, para que desactivar lo que ya no se
 *   vende libere sitio de verdad (es lo que el mensaje del límite promete).
 * · almacenamiento — el acumulado que lleva la organización.
 */
export async function loadUsage(companyId: string): Promise<PlanUsage> {
  const sb = supabaseService();
  const [users, bookings, products, org] = await Promise.all([
    sb.from("organization_memberships").select("id", { count: "exact", head: true })
      .eq("organization_id", companyId).in("status", ["active", "pending"]),
    sb.from("booking").select("id", { count: "exact", head: true })
      .eq("organization_id", companyId).gte("created_at", monthStart()),
    sb.from("product").select("id", { count: "exact", head: true })
      .eq("organization_id", companyId).neq("status", "inactive"),
    sb.from("organizations").select("storage_used_mb").eq("id", companyId).maybeSingle(),
  ]);

  return {
    users: users.count ?? 0,
    bookingsThisMonth: bookings.count ?? 0,
    products: products.count ?? 0,
    storageMb: Number(org.data?.storage_used_mb ?? 0),
  };
}

/** El estado completo, para la pantalla del plan y para los avisos del panel. */
export async function planStatusFor(ctx: TenantContext & { companyId: string }): Promise<PlanStatus> {
  const planId = typeof ctx.company?.plan === "string" ? ctx.company.plan : null;
  const [plan, usage] = await Promise.all([loadPlan(planId), loadUsage(ctx.companyId)]);
  return planStatus(plan, ctx.company ?? null, usage);
}

/* --------------------------------------------------------------- guardas */

/**
 * ¿Cabe una más de `metric`?
 *
 * Lanza 402 (Pago requerido) y no 403: no es que al usuario le falten permisos
 * —los tiene—, es que el plan de la empresa se llenó. El código separa las dos
 * conversaciones, que son con personas distintas.
 */
export async function assertWithinLimit(
  ctx: TenantContext & { companyId: string },
  metric: LimitMetric,
  wanted = 1
): Promise<void> {
  const planId = typeof ctx.company?.plan === "string" ? ctx.company.plan : null;
  const plan = await loadPlan(planId);
  // Sin techo declarado no hay nada que contar: se evita la consulta de uso.
  if (plan?.[metric] === null || plan?.[metric] === undefined) return;

  const usage = await loadUsage(ctx.companyId);
  const used = metric === "max_users" ? usage.users
    : metric === "max_bookings_month" ? usage.bookingsThisMonth
    : metric === "max_products" ? usage.products
    : usage.storageMb;

  const check = limitCheck(metric, plan, used, wanted);

  // Avisar ANTES de chocar. El banner de la pantalla solo lo ve quien entra a
  // mirarla, y el límite que rechaza una venta sin previo aviso convierte una
  // decisión comercial en un error de sistema delante del cliente. La semilla
  // lleva el mes, así que se repite una vez al mes por métrica y no una sola
  // vez en la vida de la empresa.
  if (check.allowed && check.warn) {
    await notify({
      companyId: ctx.companyId,
      event: "plan_limit_near",
      dedupeSeed: `${metric}:${new Date().toISOString().slice(0, 7)}`,
      vars: {
        metrica: metricLabel(metric),
        porcentaje: check.percent,
        usado: check.used,
        limite: check.limit,
      },
    });
  }

  if (!check.allowed) {
    throw Object.assign(new Error(limitMessage(check, plan?.name)), {
      status: 402,
      code: "PLAN_LIMIT",
      limit: check,
    });
  }
}

/**
 * ¿Está el módulo contratado?
 *
 * Esto ya se comprobaba en `nav.ts` para pintar el menú, y ahí no protege nada:
 * una petición a mano —o una pestaña abierta antes del cambio de plan— entraba
 * igual. El menú es cortesía; la puerta es esto.
 */
export function assertModule(
  ctx: TenantContext & { companyId: string },
  moduleKey: ModuleKey
): void {
  if (moduleAllowed(ctx.company?.modules_enabled, moduleKey)) return;
  // Sin el nombre del plan: el contexto solo trae su id, y leerlo aquí costaría
  // una consulta en cada comprobación para adornar un mensaje. El mensaje sin
  // nombre dice lo mismo («Tu plan no incluye este módulo»).
  throw Object.assign(new Error(moduleMessage(moduleKey)), {
    status: 402,
    code: "PLAN_MODULE",
  });
}

/**
 * Suma al almacenamiento consumido. Best-effort: un fallo aquí no puede tumbar
 * una subida que ya se hizo —el archivo existe—, y el medidor se corrige en la
 * siguiente. Cobrar de menos por un contador atrasado es preferible a perder el
 * archivo del cliente.
 */
export async function addStorageUsage(companyId: string, bytes: number): Promise<void> {
  try {
    const mb = Math.max(0, bytes) / (1024 * 1024);
    if (mb <= 0) return;
    const sb = supabaseService();
    const { data } = await sb.from("organizations").select("storage_used_mb").eq("id", companyId).maybeSingle();
    const current = Number(data?.storage_used_mb ?? 0);
    // Sin comprobarlo, el consumo se queda como estaba y el límite del plan
    // deja de aplicarse: la empresa sube sin techo y nadie lo sabe.
    await tryWrite("sumar el almacenamiento consumido", sb.from("organizations")
      .update({ storage_used_mb: Math.round((current + mb) * 100) / 100 })
      .eq("id", companyId));
  } catch (err) {
    console.error("[plan] no se pudo actualizar el almacenamiento consumido:", err);
  }
}

/** Reexportado para que las rutas no tengan que importar de dos sitios. */
export { TenantError };
