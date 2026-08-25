import { NextRequest } from "next/server";
import { requireTenant, tenantFindOne, tenantUpdate, atLeast, TenantError } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { canCompleteTask, type MyDayTask } from "@/lib/my-day";
import { OWNERSHIP_OVERRIDE_ROLE } from "@/lib/resources";

/**
 * POST /api/tasks/:id/complete
 *
 * Acción rápida de "Mi día". La autorización se resuelve aquí, en el servidor:
 * el frontend decide qué botón dibuja, pero nunca es la barrera. `tenantFindOne`
 * ya impide leer una tarea de otra empresa (404), y encima se comprueba que la
 * tarea sea del usuario o que tenga rango de gestión.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);

    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, "tasks:complete", ctx.userId), limit: 60, windowMs: 60_000 });

    const { id } = await params;
    const task = await tenantFindOne<MyDayTask>(ctx.companyId, "task", id);
    if (!task) throw new TenantError("La tarea no existe", 404);

    if (!canCompleteTask(task, ctx.userId, atLeast(ctx.role, OWNERSHIP_OVERRIDE_ROLE))) {
      throw new TenantError("Solo puedes completar tareas asignadas a ti", 403);
    }
    if (task.status === "done") {
      throw new TenantError("Esta tarea ya estaba completada", 409);
    }
    if (task.status === "cancelled") {
      throw new TenantError("Una tarea cancelada no puede completarse", 409);
    }

    const updated = await tenantUpdate(ctx.companyId, "task", id, {
      status: "done",
      completed_at: new Date().toISOString(),
    });

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "task_completed", entityType: "task", entityId: id,
      description: `Tarea completada: ${task.title ?? id}`,
      severity: "info",
      metadata: { previous_status: task.status ?? null, assigned_to_id: task.assigned_to_id ?? null },
    });

    return ok(updated);
  } catch (err) {
    console.error("[api/tasks/complete] error:", err);
    return fail(err);
  }
}
