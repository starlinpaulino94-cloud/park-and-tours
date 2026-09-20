import "server-only";
import { headers } from "next/headers";
import { tenantCreate } from "@/lib/tenant";
import { supabaseService } from "@/lib/supabase/service";
import { tryWrite } from "@/lib/supabase/write";

/**
 * Immutable audit trail. Sensitive actions (capacity overrides, impersonation,
 * price changes, settlements, refunds) must always leave a record here.
 */
export interface AuditInput {
  companyId?: string | null;
  userId?: string | null;
  impersonatedBy?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  description?: string;
  severity?: "info" | "warning" | "critical";
  metadata?: Record<string, unknown>;
}

export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    const h = await headers();
    const payload = {
      user: input.userId || undefined,
      impersonated_by: input.impersonatedBy || undefined,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId,
      description: input.description,
      severity: input.severity || "info",
      ip_address: h.get("x-forwarded-for") || h.get("x-real-ip") || undefined,
      user_agent: h.get("user-agent") || undefined,
      metadata_json: input.metadata || undefined,
      occurred_at: new Date().toISOString(),
    };
    if (input.companyId) {
      await tenantCreate(input.companyId, "audit_log", payload);
    } else {
      // La bitácora no tumba nunca lo que describe, pero su fallo tampoco
      // puede desaparecer: una auditoría con huecos que nadie ve no es una
      // auditoría.
      await tryWrite("anotar en la bitácora", supabaseService().from("audit_log").insert({
        action: input.action,
        entity_type: input.entityType,
        entity_id: input.entityId,
        description: input.description,
        severity: input.severity || "info",
        ip_address: h.get("x-forwarded-for") || h.get("x-real-ip") || undefined,
        user_agent: h.get("user-agent") || undefined,
        occurred_at: new Date().toISOString(),
        user_id: input.userId || null,
        impersonated_by: input.impersonatedBy || null,
        metadata_json: input.metadata || {},
      }));
    }
    console.log(`[audit] ${input.action} ${input.entityType ?? ""}/${input.entityId ?? ""}`);
  } catch (err) {
    // Auditing must never break the business operation, but it must be visible.
    console.error("[audit] failed to write audit entry:", err, input);
  }
}
