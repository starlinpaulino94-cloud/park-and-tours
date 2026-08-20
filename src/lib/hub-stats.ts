import "server-only";
import { tenantAggregate, tenantCount } from "@/lib/tenant";

/**
 * Read-only counters/sums for the domain hubs and module headers.
 *
 * These feed display-only figures, so a single failing table must not take the
 * whole area down: the error is logged loudly and that one figure falls back to
 * zero. Core CRUD paths never use this — they propagate their errors.
 */

export type CountSpec = { table: string; filter?: Record<string, unknown> };
export type SumSpec = CountSpec & { field: string };

export async function countMany<K extends string>(
  companyId: string,
  specs: Record<K, CountSpec>
): Promise<Record<K, number>> {
  const keys = Object.keys(specs) as K[];
  const values = await Promise.all(
    keys.map(async (key) => {
      const spec = specs[key];
      try {
        return await tenantCount(companyId, spec.table, spec.filter || {});
      } catch (err) {
        console.error(`[hub-stats] no se pudo contar ${key} (${spec.table}):`, err);
        return 0;
      }
    })
  );
  return Object.fromEntries(keys.map((k, i) => [k, values[i]])) as Record<K, number>;
}

export async function sumMany<K extends string>(
  companyId: string,
  specs: Record<K, SumSpec>
): Promise<Record<K, number>> {
  const keys = Object.keys(specs) as K[];
  const values = await Promise.all(
    keys.map(async (key) => {
      const spec = specs[key];
      try {
        const agg = await tenantAggregate(companyId, spec.table, {
          _filter: spec.filter || {},
          _aggregate: { _sum: { [spec.field]: true } },
        });
        return Number(agg?._sum?.[spec.field] ?? 0);
      } catch (err) {
        console.error(`[hub-stats] no se pudo sumar ${key} (${spec.table}.${spec.field}):`, err);
        return 0;
      }
    })
  );
  return Object.fromEntries(keys.map((k, i) => [k, values[i]])) as Record<K, number>;
}

/** ISO bounds of the local day, for "today" filters. */
export function todayRange(): { gte: string; lte: string } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { gte: start.toISOString(), lte: end.toISOString() };
}

/** ISO bound N days in the future, for "expiring soon" filters. */
export function inDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

/** Pluralises a Spanish count label: `plural(3, "orden", "órdenes")`. */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
