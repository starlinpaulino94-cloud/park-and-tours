import "server-only";
import {
  tenantCreate, tenantFindOne, tenantQuery, tenantUpdate,
  TenantError, atLeast, type TenantContext,
} from "@/lib/tenant";
import type { AppRole } from "@/lib/auth";

/**
 * Four-eyes approvals.
 *
 * Sensitive actions (discounts over the limit, refunds, voids, cash
 * adjustments, waiver bypasses) do not execute on request: they create an
 * `approval_request` that a second person with enough rank must approve.
 * Nobody can approve their own request — not even an admin.
 */

export type ApprovalAction =
  | "discount_over_limit" | "refund" | "void_sale" | "cash_adjustment" | "price_change"
  | "commission_override" | "clawback" | "purchase_order" | "credit_note"
  | "capacity_override" | "waiver_bypass" | "payout" | "expense" | "schedule_change";

/** Minimum role that can decide each kind of request. */
export const DECIDER: Record<ApprovalAction, AppRole> = {
  discount_over_limit: "manager",
  refund: "manager",
  void_sale: "manager",
  cash_adjustment: "manager",
  price_change: "manager",
  commission_override: "admin",
  clawback: "admin",
  purchase_order: "manager",
  credit_note: "manager",
  capacity_override: "operations",
  waiver_bypass: "admin",
  payout: "admin",
  expense: "manager",
  schedule_change: "operations",
};

/** Actions that always need two different approvers, not just one. */
const DOUBLE_SIGN: ApprovalAction[] = ["clawback", "payout", "waiver_bypass"];

/**
 * Value above which each action needs approval at all. Discounts are compared
 * as a percentage, the rest as money in the company currency.
 */
export const THRESHOLD: Partial<Record<ApprovalAction, number>> = {
  discount_over_limit: 15,
  refund: 100,
  cash_adjustment: 50,
  expense: 500,
  payout: 1000,
};

export interface RequestInput {
  action: ApprovalAction;
  reason: string;
  amount?: number;
  currency?: string;
  /** Table + id of the record the decision applies to. */
  targetTable?: string;
  targetId?: string;
  payload?: Record<string, unknown>;
  expiresAt?: string;
  refs?: Partial<Record<"order" | "booking" | "payment" | "purchase_order", string>>;
}

/** True when the action exceeds its threshold and therefore needs a second pair of eyes. */
export function needsApproval(action: ApprovalAction, value: number): boolean {
  const limit = THRESHOLD[action];
  if (limit === undefined) return true;
  return Math.abs(value) > limit;
}

export async function requestApproval(
  ctx: TenantContext & { companyId: string },
  input: RequestInput
) {
  if (!input.reason?.trim()) {
    throw new TenantError("La solicitud necesita una justificación", 400);
  }
  if (!DECIDER[input.action]) {
    throw new TenantError(`Acción de aprobación desconocida: ${input.action}`, 400);
  }

  const row = await tenantCreate<{ _id: string }>(ctx.companyId, "approval_request", {
    code: `AP-${Date.now().toString(36).toUpperCase().slice(-6)}`,
    action_type: input.action,
    status: "pending",
    requested_at: new Date().toISOString(),
    amount: input.amount ?? null,
    currency: input.currency || null,
    reason: input.reason.trim(),
    payload: input.payload ? JSON.stringify(input.payload) : null,
    target_table: input.targetTable || null,
    target_id: input.targetId || null,
    requires_two: DOUBLE_SIGN.includes(input.action) ? "yes" : "no",
    expires_at: input.expiresAt || null,
    requested_by: ctx.userId,
    ...(input.refs || {}),
  });

  console.log(
    `[approvals] ${input.action} solicitada por ${ctx.email} → requiere ${DECIDER[input.action]}` +
    (DOUBLE_SIGN.includes(input.action) ? " (doble firma)" : "")
  );
  return row;
}

const refOf = (value: unknown) =>
  value && typeof value === "object" ? (value as { _id?: string })._id : (value as string | null);

export async function decide(
  ctx: TenantContext & { companyId: string },
  id: string,
  action: "approve" | "reject",
  notes?: string
) {
  const row = await tenantFindOne<any>(ctx.companyId, "approval_request", id);
  if (!row) throw new TenantError("La solicitud no existe", 404);
  if (row.status !== "pending") {
    throw new TenantError(
      `Esta solicitud ya fue ${row.status === "approved" ? "aprobada" : "resuelta"}`,
      409
    );
  }
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    await tenantUpdate(ctx.companyId, "approval_request", id, { status: "expired" });
    throw new TenantError("La solicitud expiró y ya no puede aprobarse", 409);
  }

  const requester = refOf(row.requested_by);
  if (requester && requester === ctx.userId) {
    throw new TenantError(
      "No puedes aprobar tu propia solicitud: necesita una segunda persona",
      403
    );
  }

  const required = DECIDER[row.action_type as ApprovalAction] || "manager";
  if (!atLeast(ctx.role, required)) {
    throw new TenantError(`Se necesita el rol ${required} o superior para decidir esta solicitud`, 403);
  }

  // Double signature: the first approver only signs, the second one closes it.
  const firstApprover = refOf(row.approved_by);
  if (action === "approve" && row.requires_two === "yes" && !firstApprover) {
    const partial = await tenantUpdate(ctx.companyId, "approval_request", id, {
      approved_by: ctx.userId,
      decision_notes: notes || null,
    });
    console.log(`[approvals] ${row.code} primera firma de ${ctx.email} — falta la segunda`);
    return { ...(partial as object), pendingSecondSignature: true };
  }
  if (action === "approve" && row.requires_two === "yes" && firstApprover === ctx.userId) {
    throw new TenantError("Ya firmaste esta solicitud: la segunda firma debe ser de otra persona", 403);
  }

  const updated = await tenantUpdate(ctx.companyId, "approval_request", id, {
    status: action === "approve" ? "approved" : "rejected",
    decided_at: new Date().toISOString(),
    decision_notes: notes || null,
    ...(row.requires_two === "yes" && action === "approve"
      ? { second_approver: ctx.userId }
      : { approved_by: ctx.userId }),
  });

  console.log(`[approvals] ${row.code} ${action === "approve" ? "aprobada" : "rechazada"} por ${ctx.email}`);
  return updated;
}

/** Requests waiting on the caller — what "Mi día" shows as pending decisions. */
export async function pendingFor(ctx: TenantContext & { companyId: string }) {
  const rows = await tenantQuery<any>(ctx.companyId, "approval_request", {
    requested_by: true,
    approved_by: true,
    _filter: { status: "pending" },
    _sort: { requested_at: "desc" },
    _limit: 100,
  });
  return rows.filter((r) => {
    if (refOf(r.requested_by) === ctx.userId) return false;
    if (r.requires_two === "yes" && refOf(r.approved_by) === ctx.userId) return false;
    return atLeast(ctx.role, DECIDER[r.action_type as ApprovalAction] || "manager");
  });
}
