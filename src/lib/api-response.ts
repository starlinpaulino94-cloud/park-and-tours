import { NextResponse } from "next/server";
import { TenantError } from "@/lib/tenant";
import { OversellError } from "@/lib/availability";

/** Standard success envelope — every API route returns `{ ok: true, data }`. */
export function ok<T>(data: T, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: true, data, ...(extra || {}) });
}

export function serializeError(err: unknown) {
  const e = err as any;
  return {
    message: e?.message ?? "Error desconocido",
    code: e?.code ?? e?.name ?? null,
    details: e?.response?.data ?? null,
  };
}

/** Standard failure envelope, mapping known domain errors to HTTP status codes. */
export function fail(err: unknown, fallbackStatus = 500) {
  const e = err as any;
  let status = fallbackStatus;
  if (err instanceof TenantError) status = err.status;
  else if (err instanceof OversellError) status = 409;
  else if (typeof e?.status === "number") status = e.status;

  console.error(`[API ERROR ${status}]`, e?.message, e?.stack);
  return NextResponse.json(
    { ok: false, error: serializeError(err), ...(err instanceof OversellError ? { code: "OVERSELL" } : {}) },
    { status }
  );
}

/** Reads and parses a JSON body, returning {} when the body is empty/invalid. */
export async function readJson<T = Record<string, any>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

/** Builds a `_filter` fragment for a date range on the given field. */
export function dateRangeFilter(field: string, from?: string | null, to?: string | null) {
  if (!from && !to) return {};
  const range: Record<string, string> = {};
  if (from) range.gte = new Date(from).toISOString();
  if (to) range.lte = new Date(to).toISOString();
  return { [field]: range };
}

/** Resolves the from/to ISO boundaries for the dashboard period presets. */
export function resolvePeriod(period?: string | null, from?: string | null, to?: string | null) {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

  switch (period) {
    case "today":
      return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString(), label: "Hoy" };
    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { from: startOfDay(y).toISOString(), to: endOfDay(y).toISOString(), label: "Ayer" };
    }
    case "week": {
      const s = new Date(now);
      const day = (s.getDay() + 6) % 7; // monday-based
      s.setDate(s.getDate() - day);
      return { from: startOfDay(s).toISOString(), to: endOfDay(now).toISOString(), label: "Esta semana" };
    }
    case "quarter": {
      const q = Math.floor(now.getMonth() / 3);
      const s = new Date(now.getFullYear(), q * 3, 1);
      return { from: startOfDay(s).toISOString(), to: endOfDay(now).toISOString(), label: "Trimestre" };
    }
    case "year": {
      const s = new Date(now.getFullYear(), 0, 1);
      return { from: startOfDay(s).toISOString(), to: endOfDay(now).toISOString(), label: "Año" };
    }
    case "custom":
      return {
        from: from ? startOfDay(new Date(from)).toISOString() : startOfDay(now).toISOString(),
        to: to ? endOfDay(new Date(to)).toISOString() : endOfDay(now).toISOString(),
        label: "Personalizado",
      };
    case "month":
    default: {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: startOfDay(s).toISOString(), to: endOfDay(now).toISOString(), label: "Este mes" };
    }
  }
}
