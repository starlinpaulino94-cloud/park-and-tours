import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, tenantQuery } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import type { AgingBucket, Payable, Receivable } from "@/lib/types";
import { refId } from "@/lib/types";

const BUCKETS: AgingBucket[] = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"];

function bucketOf(dueDate?: string): AgingBucket {
  if (!dueDate) return "current";
  const days = Math.floor((Date.now() - new Date(dueDate).getTime()) / 86_400_000);
  if (days <= 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}

/**
 * GET /api/reports/aging?type=receivable|payable
 * Antigüedad de saldos por partner/proveedor con tramos corriente / 1-30 / 31-60 / 61-90 / +90.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    requireAtLeast(ctx, "manager");
    const type = req.nextUrl.searchParams.get("type") === "payable" ? "payable" : "receivable";

    const rows = await tenantQuery<Receivable & Payable>(ctx.companyId, type, {
      _filter: { status: { nin: ["paid", "written_off", "cancelled"] } },
      _limit: 1000,
      _sort: { due_date: "asc" },
      partner: true,
      ...(type === "receivable" ? { customer: true } : { supplier: true, seller: true }),
    });

    type Entity = {
      key: string; label: string; type: string;
      total: number; documents: number; oldest_days: number;
      credit_limit?: number; credit_days?: number;
    } & Record<AgingBucket, number>;

    const byEntity = new Map<string, Entity>();
    const totals: Record<AgingBucket, number> & { total: number } = {
      current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0,
    };
    const documents: any[] = [];

    for (const r of rows) {
      const balance = r.balance ?? Math.max((r.amount ?? 0) - (r.paid_amount ?? 0), 0);
      if (balance <= 0) continue;
      const bucket = bucketOf(r.due_date);
      const days = r.due_date
        ? Math.max(Math.floor((Date.now() - new Date(r.due_date).getTime()) / 86_400_000), 0)
        : 0;

      const partner: any = r.partner;
      const other: any = type === "receivable" ? (r as Receivable).customer : (r as Payable).supplier || (r as Payable).seller;
      const entityObj = (partner && typeof partner === "object" ? partner : null) ||
        (other && typeof other === "object" ? other : null);
      const key = entityObj?._id || "none";
      const label = entityObj?.commercial_name || entityObj?.name || entityObj?.full_name || "Sin asignar";
      const entityType = partner && typeof partner === "object" ? partner.partner_type || "partner" : type === "receivable" ? "customer" : "supplier";

      const entity = byEntity.get(key) || {
        key, label, type: entityType, total: 0, documents: 0, oldest_days: 0,
        credit_limit: entityObj?.credit_limit, credit_days: entityObj?.credit_days,
        current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0,
      };
      entity[bucket] += balance;
      entity.total += balance;
      entity.documents += 1;
      entity.oldest_days = Math.max(entity.oldest_days, days);
      byEntity.set(key, entity);

      totals[bucket] += balance;
      totals.total += balance;

      documents.push({
        _id: r._id,
        document_number: r.document_number || (r as Payable).reference || (r as Payable).concept,
        entity: label,
        entity_id: key,
        partner_id: refId(r.partner),
        issue_date: r.issue_date,
        due_date: r.due_date,
        amount: r.amount ?? 0,
        paid_amount: r.paid_amount ?? 0,
        balance,
        currency: r.currency || ctx.company?.base_currency || "usd",
        status: r.status,
        bucket,
        days_overdue: days,
      });
    }

    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const entities = [...byEntity.values()]
      .map((e) => ({
        ...e,
        total: round2(e.total),
        over_limit: !!e.credit_limit && e.total > e.credit_limit,
        ...Object.fromEntries(BUCKETS.map((b) => [b, round2(e[b])])),
      }))
      .sort((a, b) => b.total - a.total);

    console.log(`[aging] ${type}: ${documents.length} documentos · ${round2(totals.total)} pendientes`);
    return ok({
      type,
      entities,
      documents: documents.sort((a, b) => b.days_overdue - a.days_overdue),
      totals: { ...Object.fromEntries(BUCKETS.map((b) => [b, round2(totals[b])])), total: round2(totals.total) },
      truncated: rows.length >= 1000,
    });
  } catch (err) {
    return fail(err);
  }
}
