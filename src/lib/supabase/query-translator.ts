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
  is(col: string, val: null | boolean): PostgrestLike;
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
  assigned_seller: "assigned_seller_id",
  assigned_to: "assigned_to_id",
  cash_register: "cash_register_id",
  driver: "driver_id",
  guide: "guide_id",
  inventory_item: "inventory_item_id",
  ledger_account: "ledger_account_id",
  manager: "manager_id",
  membership_plan: "membership_plan_id",
  owner: "owner_id",
  parent: "parent_id",
  parent_partner: "parent_partner_id",
  performed_by: "performed_by",
  pickup_hotel: "hotel_id",
  reported_by: "reported_by",
  route: "route_id",
  second_approver: "second_approver_id",
};

export function aliasField(field: string, aliases = DEFAULT_FIELD_ALIASES): string {
  return aliases[field] ?? field;
}

type Operand = Record<string, unknown>;

/**
 * Serialisation of operands for `.or()` and for `nin` lists.
 *
 * Inside an `or=(...)` group the comma separates clauses, the parentheses
 * delimit the group and the dot separates column, operator and value. PostgREST
 * accepts a double-quoted value for anything that contains them, and that is
 * the only form that round-trips reliably.
 *
 * This used to escape `,` `.` `(` `)` with a backslash. Backslashes are not an
 * escape mechanism for PostgREST values, so the marks ended up INSIDE the
 * value: searching for `S.A.` sent `S\.A\.` and matched nothing, and an ISO
 * timestamp produced a malformed clause. Quoting fixes both.
 *
 * The allowlist is deliberately conservative: identifiers, uuids, numbers and
 * enum values travel bare — exactly as before — and only richer values get
 * quoted, so no existing filter changes shape.
 */
const BARE_VALUE = /^[A-Za-z0-9_-]*$/;

function quote(raw: string): string {
  return `"${raw.replace(/(["\\])/g, "\\$1")}"`;
}

function orValue(v: unknown): string {
  const raw = String(v);
  return BARE_VALUE.test(raw) ? raw : quote(raw);
}

/**
 * Same, for the `ilike` pattern of a `regex` filter: the wildcards are part of
 * the operand, so the whole `*term*` is quoted as a unit when it needs it.
 */
function orLikePattern(v: unknown): string {
  const raw = String(v);
  return BARE_VALUE.test(raw) ? `*${raw}*` : quote(`*${raw}*`);
}

/** Serialises one `{field: value|operand}` pair to PostgREST `.or()` syntax. */
function toOrClause(field: string, cond: unknown, aliases: Record<string, string>): string[] {
  const col = aliasField(field, aliases);
  // `{ field: null }` means IS NULL — a bare `eq.null` would never match.
  if (cond === null) return [`${col}.is.null`];
  if (cond !== null && typeof cond === "object" && !Array.isArray(cond)) {
    const out: string[] = [];
    for (const [op, val] of Object.entries(cond as Operand)) {
      switch (op) {
        case "ne": out.push(`${col}.neq.${orValue(val)}`); break;
        case "gte": out.push(`${col}.gte.${orValue(val)}`); break;
        case "lte": out.push(`${col}.lte.${orValue(val)}`); break;
        case "gt": out.push(`${col}.gt.${orValue(val)}`); break;
        case "lt": out.push(`${col}.lt.${orValue(val)}`); break;
        case "is": out.push(`${col}.is.${val === null ? "null" : String(val)}`); break;
        case "in": out.push(`${col}.in.(${(val as unknown[]).map(orValue).join(",")})`); break;
        case "regex": out.push(`${col}.ilike.${orLikePattern(val)}`); break;
        default: break;
      }
    }
    return out;
  }
  return [`${col}.eq.${orValue(cond)}`];
}

/** Builds the clause string for one `_or` group. */
function orClauses(group: unknown, aliases: Record<string, string>): string[] {
  const clauses: string[] = [];
  for (const sub of (group as Record<string, unknown>[]) || []) {
    for (const [f, c] of Object.entries(sub)) clauses.push(...toOrClause(f, c, aliases));
  }
  return clauses;
}

/**
 * Applies a Mongo-like `_filter` to a PostgREST builder.
 * Supported operators: bare(eq), ne, gt, gte, lt, lte, in, nin, regex(→ilike),
 * is, `_or` and `_and`.
 *
 * `_and` takes a list of sub-filters that are applied one after another. Since
 * PostgREST joins successive `.or()` calls with AND, this is what makes several
 * independent OR groups expressible in a single filter object — needed by the
 * "decidable approval" rule, which ANDs three OR groups.
 *
 * A bare `null` value means IS NULL: `eq.null` never matches in SQL.
 */
export function applyFilter<T extends PostgrestLike>(
  builder: T,
  filter: Record<string, unknown> = {},
  aliases: Record<string, string> = DEFAULT_FIELD_ALIASES
): T {
  let q: PostgrestLike = builder;
  for (const [rawKey, cond] of Object.entries(filter)) {
    if (rawKey === "_or") {
      const clauses = orClauses(cond, aliases);
      if (clauses.length) q = q.or(clauses.join(","));
      continue;
    }
    if (rawKey === "_and") {
      for (const sub of (cond as Record<string, unknown>[]) || []) {
        q = applyFilter(q, sub, aliases);
      }
      continue;
    }
    const col = aliasField(rawKey, aliases);
    if (cond === null) {
      q = q.is(col, null);
      continue;
    }
    if (cond !== null && typeof cond === "object" && !Array.isArray(cond)) {
      for (const [op, val] of Object.entries(cond as Operand)) {
        switch (op) {
          case "ne": q = q.neq(col, val); break;
          case "gte": q = q.gte(col, val); break;
          case "lte": q = q.lte(col, val); break;
          case "gt": q = q.gt(col, val); break;
          case "lt": q = q.lt(col, val); break;
          case "is": q = q.is(col, val as null | boolean); break;
          case "in": q = q.in(col, val as unknown[]); break;
          // La lista de `nin` viaja como una cadena cruda hacia PostgREST, así
          // que sus elementos necesitan el mismo entrecomillado que los de `in`
          // dentro de un `_or`; sin él, un valor con coma partía la lista.
          case "nin": q = q.not(col, "in", `(${(val as unknown[]).map(orValue).join(",")})`); break;
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
