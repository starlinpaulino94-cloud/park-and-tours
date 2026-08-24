/**
 * Query translator: legacy Mongo-like `_filter` → Supabase/PostgREST.
 *
 * The app still uses `tenantQuery(table, { _filter, _sort,
 * _limit, _offset })` with Mongo-like operators. This module applies the same
 * filter shape onto a Supabase PostgREST query builder so the ~84 call sites can
 * be ported with the SAME filter objects. It is intentionally pure and
 * builder-agnostic (any object exposing the PostgREST filter methods works), so
 * it can be unit-tested without a live database.
 *
 * Field aliases bridge legacy API names and the Postgres schema (`_id`→`id`, `company`→`organization_id`, `partner`→
 * `partner_id`, …). Reads no longer need to inject the tenant filter — RLS does
 * it — but the alias map keeps existing call sites working unchanged.
 */

export interface PostgrestLike {
  eq(col: string, val: unknown): PostgrestLike;
  neq(col: string, val: unknown): PostgrestLike;
  gt(col: string, val: unknown): PostgrestLike;
  gte(col: string, val: unknown): PostgrestLike;
  lt(col: string, val: unknown): PostgrestLike;
  lte(col: string, val: unknown): PostgrestLike;
  in(col: string, vals: readonly unknown[]): PostgrestLike;
  ilike(col: string, pattern: string): PostgrestLike;
  not(col: string, op: string, val: unknown): PostgrestLike;
  or(filters: string): PostgrestLike;
  order(col: string, opts: { ascending: boolean }): PostgrestLike;
  range(from: number, to: number): PostgrestLike;
}

export const DEFAULT_FIELD_ALIASES: Record<string, string> = {
  _id: "id",
  createdAt: "created_at",
  updatedAt: "updated_at",
  company: "organization_id",
  partner: "partner_id",
  seller: "seller_id",
  product: "product_id",
  order: "order_id",
  booking: "booking_id",
  customer: "customer_id",
  departure: "departure_id",
  modality: "modality_id",
  rule: "rule_id",
  settlement: "settlement_id",
  user: "user_id",
  assigned_to: "assigned_to_id",
  second_approver: "second_approver_id",
};

export function aliasField(field: string, aliases = DEFAULT_FIELD_ALIASES): string {
  return aliases[field] ?? field;
}

type Operand = Record<string, unknown>;

/** Escapes a value for use inside a PostgREST `.or()` string. */
function orValue(v: unknown): string {
  return String(v).replace(/([,.()])/g, "\\$1");
}

/** Serialises one `{field: value|operand}` pair to PostgREST `.or()` syntax. */
function toOrClause(field: string, cond: unknown, aliases: Record<string, string>): string[] {
  const col = aliasField(field, aliases);
  if (cond !== null && typeof cond === "object" && !Array.isArray(cond)) {
    const out: string[] = [];
    for (const [op, val] of Object.entries(cond as Operand)) {
      switch (op) {
        case "ne": out.push(`${col}.neq.${orValue(val)}`); break;
        case "gte": out.push(`${col}.gte.${orValue(val)}`); break;
        case "lte": out.push(`${col}.lte.${orValue(val)}`); break;
        case "gt": out.push(`${col}.gt.${orValue(val)}`); break;
        case "lt": out.push(`${col}.lt.${orValue(val)}`); break;
        case "in": out.push(`${col}.in.(${(val as unknown[]).map(orValue).join(",")})`); break;
        case "regex": out.push(`${col}.ilike.*${orValue(val)}*`); break;
        default: break;
      }
    }
    return out;
  }
  return [`${col}.eq.${orValue(cond)}`];
}

/**
 * Applies a Mongo-like `_filter` to a PostgREST builder.
 * Supported operators: bare(eq), ne, gt, gte, lt, lte, in, nin, regex(→ilike), _or.
 * Real `gt`/`lt` operators are available.
 */
export function applyFilter<T extends PostgrestLike>(
  builder: T,
  filter: Record<string, unknown> = {},
  aliases: Record<string, string> = DEFAULT_FIELD_ALIASES
): T {
  let q: PostgrestLike = builder;
  for (const [rawKey, cond] of Object.entries(filter)) {
    if (rawKey === "_or") {
      const clauses: string[] = [];
      for (const sub of (cond as Record<string, unknown>[]) || []) {
        for (const [f, c] of Object.entries(sub)) clauses.push(...toOrClause(f, c, aliases));
      }
      if (clauses.length) q = q.or(clauses.join(","));
      continue;
    }
    const col = aliasField(rawKey, aliases);
    if (cond !== null && typeof cond === "object" && !Array.isArray(cond)) {
      for (const [op, val] of Object.entries(cond as Operand)) {
        switch (op) {
          case "ne": q = q.neq(col, val); break;
          case "gte": q = q.gte(col, val); break;
          case "lte": q = q.lte(col, val); break;
          case "gt": q = q.gt(col, val); break;
          case "lt": q = q.lt(col, val); break;
          case "in": q = q.in(col, val as unknown[]); break;
          case "nin": q = q.not(col, "in", `(${(val as unknown[]).join(",")})`); break;
          case "regex": q = q.ilike(col, `%${val}%`); break;
          default: break; // unknown operator ignored (defensive)
        }
      }
    } else {
      q = q.eq(col, cond);
    }
  }
  return q as T;
}

export interface QueryShape {
  _filter?: Record<string, unknown>;
  _sort?: Record<string, "asc" | "desc">;
  _limit?: number;
  _offset?: number;
}

/** Applies filter + sort + pagination from a legacy options object. */
export function applyQuery<T extends PostgrestLike>(
  builder: T,
  options: QueryShape = {},
  aliases: Record<string, string> = DEFAULT_FIELD_ALIASES
): T {
  let q: PostgrestLike = applyFilter(builder, options._filter || {}, aliases);
  if (options._sort) {
    for (const [col, dir] of Object.entries(options._sort)) {
      q = q.order(aliasField(col, aliases), { ascending: dir === "asc" });
    }
  }
  const limit = options._limit ?? 50;
  const offset = options._offset ?? 0;
  q = q.range(offset, offset + limit - 1);
  return q as T;
}
