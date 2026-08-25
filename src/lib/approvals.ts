import "server-only";
import {
  tenantCreate, tenantCount, tenantFindOne, tenantQuery, tenantUpdate,
  TenantError, atLeast, type TenantContext,
} from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import type { AppRole } from "@/lib/auth";

/**
 * Four-eyes approvals.
 *
 * Sensitive actions (discounts over the limit, refunds, voids, cash
 * adjustments, waiver bypasses) do not execute on request: they create an
 * `approval_request` that a second person with enough rank must approve.
 * Nobody can approve their own request — not even an admin.
 *
 * `requires_two` is a real boolean, matching `approval_request.requires_two` in
 * migration 0009. It used to be written as the strings "yes"/"no" and compared
 * with `=== "yes"`, which PostgREST always returned as `true`/`false` — so every
 * double-signature check silently evaluated to false and the reinforced control
 * was effectively disabled.
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
export const DOUBLE_SIGN: ApprovalAction[] = ["clawback", "payout", "waiver_bypass"];

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

/** Shape the module works with; the row itself is wider. */
export interface ApprovalRow {
  _id: string;
  code?: string | null;
  action_type?: string | null;
  status?: string | null;
  requested_at?: string | null;
  expires_at?: string | null;
  decided_at?: string | null;
  amount?: number | null;
  currency?: string | null;
  reason?: string | null;
  decision_notes?: string | null;
  requires_two?: boolean | null;
  requested_by?: unknown;
  approved_by?: unknown;
  second_approver_id?: unknown;
}

/** True when the action exceeds its threshold and therefore needs a second pair of eyes. */
export function needsApproval(action: ApprovalAction, value: number): boolean {
  const limit = THRESHOLD[action];
  if (limit === undefined) return true;
  return Math.abs(value) > limit;
}

/** True when the action always requires two distinct signatures. */
export function requiresTwoSignatures(action: ApprovalAction): boolean {
  return DOUBLE_SIGN.includes(action);
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
    requires_two: requiresTwoSignatures(input.action),
    expires_at: input.expiresAt || null,
    requested_by: ctx.userId,
    ...(input.refs || {}),
  });

  await writeAudit({
    companyId: ctx.companyId, userId: ctx.userId,
    action: "approval_requested", entityType: "approval_request", entityId: row._id,
    description: `Solicitud de ${input.action} creada`,
    severity: "info",
    metadata: { action_type: input.action, amount: input.amount ?? null, requires_two: requiresTwoSignatures(input.action) },
  });
  return row;
}

const refOf = (value: unknown): string | null => {
  if (value && typeof value === "object") return (value as { _id?: string })._id ?? null;
  return (value as string | null) ?? null;
};

/** Normalises the boolean coming back from Postgres (it may arrive as a string via legacy rows). */
export function isTwoSignature(row: Pick<ApprovalRow, "requires_two">): boolean {
  return row.requires_two === true;
}

/** Every action the given role is allowed to decide. */
export function decidableActionsFor(role: AppRole): ApprovalAction[] {
  return (Object.keys(DECIDER) as ApprovalAction[]).filter((action) => atLeast(role, DECIDER[action]));
}

/**
 * THE single definition of "an approval this person can decide right now".
 *
 * Expressed as a database filter, not as an in-memory predicate, so the list,
 * the "Mi día" counter, the sidebar badge and the approvals screen all read the
 * exact same rule from one place and stay consistent. Returns null when the
 * caller's role cannot decide anything at all — the caller must short-circuit
 * instead of querying with an empty `IN ()`.
 *
 * The three OR groups are: not my own request, not expired, and not already
 * signed by me on a double-signature request.
 */
export function decidableFilter(
  ctx: Pick<TenantContext, "userId" | "role">,
  now: Date = new Date()
): Record<string, unknown> | null {
  const actions = decidableActionsFor(ctx.role);
  if (actions.length === 0) return null;

  const nowIso = now.toISOString();
  return {
    status: "pending",
    action_type: { in: actions },
    _and: [
      { _or: [{ requested_by: null }, { requested_by: { ne: ctx.userId } }] },
      { _or: [{ expires_at: null }, { expires_at: { gt: nowIso } }] },
      { _or: [{ requires_two: false }, { approved_by: null }, { approved_by: { ne: ctx.userId } }] },
    ],
  };
}

/** Requests waiting on the caller — what "Mi día" shows as pending decisions. */
export async function pendingFor(
  ctx: TenantContext & { companyId: string },
  options: { limit?: number } = {}
): Promise<ApprovalRow[]> {
  const filter = decidableFilter(ctx);
  if (!filter) return [];
  return tenantQuery<ApprovalRow>(ctx.companyId, "approval_request", {
    _filter: filter,
    // Oldest first: a work queue, so the longest-waiting decision is on top.
    _sort: { requested_at: "asc" },
    _limit: options.limit ?? 10,
  });
}

/** Exact count of decidable requests — same rule as `pendingFor`, no page slicing. */
export async function countDecidableFor(
  ctx: TenantContext & { companyId: string }
): Promise<number> {
  const filter = decidableFilter(ctx);
  if (!filter) return 0;
  return tenantCount(ctx.companyId, "approval_request", filter);
}

/**
 * Moves timed-out pending requests to `expired`.
 *
 * Deliberately NOT called while rendering a screen: a page load must never
 * trigger writes on financial records. It runs from the maintenance endpoint
 * (and opportunistically from `decide`, which has to check anyway). Reads are
 * already safe without it because `decidableFilter` excludes anything past its
 * `expires_at`; this only makes the stored state catch up so the history reads
 * correctly.
 */
export async function expireApprovals(companyId: string, limit = 200): Promise<number> {
  const stale = await tenantQuery<ApprovalRow>(companyId, "approval_request", {
    // A NULL `expires_at` never satisfies `<`, so open-ended requests are safe.
    _filter: { status: "pending", expires_at: { lt: new Date().toISOString() } },
    _sort: { expires_at: "asc" },
    _limit: limit,
  });
  for (const row of stale) {
    await tenantUpdate(companyId, "approval_request", row._id, { status: "expired" });
  }
  if (stale.length > 0) {
    console.log(`[approvals] ${stale.length} solicitudes marcadas como expiradas`);
  }
  return stale.length;
}

export async function decide(
  ctx: TenantContext & { companyId: string },
  id: string,
  action: "approve" | "reject",
  notes?: string
) {
  if (action !== "approve" && action !== "reject") {
    throw new TenantError("Acción inválida: solo se puede aprobar o rechazar", 400);
  }

  const row = await tenantFindOne<ApprovalRow>(ctx.companyId, "approval_request", id);
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

  const twoSignatures = isTwoSignature(row);
  const firstApprover = refOf(row.approved_by);

  // Double signature: the first approver only signs, the second one closes it.
  // Rejecting is always allowed to a single person — it is the safe direction.
  if (action === "approve" && twoSignatures && firstApprover === ctx.userId) {
    throw new TenantError("Ya firmaste esta solicitud: la segunda firma debe ser de otra persona", 403);
  }
  if (action === "approve" && twoSignatures && !firstApprover) {
    const partial = await tenantUpdate(ctx.companyId, "approval_request", id, {
      approved_by: ctx.userId,
      decision_notes: notes?.trim() || null,
    });
    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "approval_signed", entityType: "approval_request", entityId: id,
      description: `Primera firma de ${row.code ?? id} — falta la segunda`,
      severity: "warning",
      metadata: { action_type: row.action_type, amount: row.amount ?? null, notes: notes?.trim() || null },
    });
    return { ...(partial as object), pendingSecondSignature: true };
  }

  // `approved_by` holds the decider on a single-signature flow; on a two-signature
  // flow it is already taken by the first signer, so the closer goes to
  // `second_approver` (aliased to `second_approver_id`).
  const deciderField = twoSignatures && firstApprover
    ? { second_approver: ctx.userId }
    : { approved_by: ctx.userId };

  const updated = await tenantUpdate(ctx.companyId, "approval_request", id, {
    status: action === "approve" ? "approved" : "rejected",
    decided_at: new Date().toISOString(),
    decision_notes: notes?.trim() || null,
    ...deciderField,
  });

  await writeAudit({
    companyId: ctx.companyId, userId: ctx.userId,
    action: action === "approve" ? "approval_approved" : "approval_rejected",
    entityType: "approval_request", entityId: id,
    description: `${row.code ?? id} ${action === "approve" ? "aprobada" : "rechazada"}`,
    severity: "critical",
    metadata: {
      action_type: row.action_type,
      amount: row.amount ?? null,
      currency: row.currency ?? null,
      requires_two: twoSignatures,
      first_approver: firstApprover,
      notes: notes?.trim() || null,
    },
  });

  return updated;
}
