import "server-only";
import { headers } from "next/headers";
import { totalumSdk } from "@/lib/totalum";

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
    await totalumSdk.crud.createRecord("audit_log", {
      company: input.companyId || undefined,
      user: input.userId || undefined,
      impersonated_by: input.impersonatedBy || undefined,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId,
      description: input.description,
      severity: input.severity || "info",
      ip_address: h.get("x-forwarded-for") || h.get("x-real-ip") || undefined,
      user_agent: h.get("user-agent") || undefined,
      metadata_json: input.metadata ? JSON.stringify(input.metadata) : undefined,
      occurred_at: new Date().toISOString(),
    });
    console.log(`[audit] ${input.action} ${input.entityType ?? ""}/${input.entityId ?? ""}`);
  } catch (err) {
    // Auditing must never break the business operation, but it must be visible.
    console.error("[audit] failed to write audit entry:", err, input);
  }
}
