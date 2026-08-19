/**
 * Shared formatting + label helpers (safe on client and server).
 */
import type { Currency } from "@/lib/types";

export const CURRENCY_SYMBOL: Record<string, string> = {
  usd: "US$", dop: "RD$", eur: "€", mxn: "MX$", cop: "COL$", brl: "R$",
};

export function formatMoney(amount?: number | null, currency: Currency | string = "usd"): string {
  const value = Number.isFinite(amount as number) ? (amount as number) : 0;
  const symbol = CURRENCY_SYMBOL[String(currency).toLowerCase()] ?? "$";
  return `${symbol}${value.toLocaleString("es-DO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatCompactMoney(amount?: number | null, currency: Currency | string = "usd"): string {
  const value = Number.isFinite(amount as number) ? (amount as number) : 0;
  const symbol = CURRENCY_SYMBOL[String(currency).toLowerCase()] ?? "$";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${symbol}${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${symbol}${(value / 1000).toFixed(1)}K`;
  return `${symbol}${value.toLocaleString("es-DO", { maximumFractionDigits: 0 })}`;
}

export function formatNumber(value?: number | null, decimals = 0): string {
  const n = Number.isFinite(value as number) ? (value as number) : 0;
  return n.toLocaleString("es-DO", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatPercent(value?: number | null, decimals = 1): string {
  const n = Number.isFinite(value as number) ? (value as number) : 0;
  return `${n.toFixed(decimals)}%`;
}

const MONTHS_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export function toDate(value?: string | Date | null): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value?: string | Date | null): string {
  const d = toDate(value);
  if (!d) return "—";
  return `${d.getDate()} ${MONTHS_ES[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
}

export function formatDateLong(value?: string | Date | null): string {
  const d = toDate(value);
  if (!d) return "—";
  return `${d.getDate()} de ${MONTHS_ES[d.getMonth()]} de ${d.getFullYear()}`;
}

export function formatTime(value?: string | Date | null): string {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit", hour12: true });
}

export function formatDateTime(value?: string | Date | null): string {
  const d = toDate(value);
  if (!d) return "—";
  return `${formatDate(d)} · ${formatTime(d)}`;
}

/** yyyy-mm-dd in local time — used for <input type="date"> and day grouping. */
export function toDateInput(value?: string | Date | null): string {
  const d = toDate(value) ?? new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function relativeDay(value?: string | Date | null): string {
  const d = toDate(value);
  if (!d) return "—";
  const today = toDateInput(new Date());
  const target = toDateInput(d);
  if (target === today) return "Hoy";
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (target === toDateInput(tomorrow)) return "Mañana";
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (target === toDateInput(yesterday)) return "Ayer";
  return formatDate(d);
}

export function initials(name?: string | null): string {
  if (!name) return "??";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/** Parses a value that may already be an object or a JSON string coming from a long-string field. */
export function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "object") return value as T;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}
