"use client";

import { cn } from "@/lib/utils";

/**
 * Hand-rolled SVG charts — no chart dependency, full control over the
 * editorial look of the dashboard.
 */

export interface Point {
  label: string;
  value: number;
  secondary?: number;
}

export function AreaChart({
  data, height = 190, currencyFormatter, className,
}: {
  data: Point[];
  height?: number;
  currencyFormatter?: (v: number) => string;
  className?: string;
}) {
  if (data.length === 0) {
    return <div className={cn("grid h-40 place-items-center text-sm text-muted-foreground", className)}>Sin datos en el período</div>;
  }
  const w = 720;
  const h = height;
  const pad = { top: 14, right: 8, bottom: 24, left: 8 };
  const max = Math.max(...data.map((d) => d.value), 1);
  const step = data.length > 1 ? (w - pad.left - pad.right) / (data.length - 1) : 0;
  const x = (i: number) => pad.left + i * step;
  const y = (v: number) => pad.top + (1 - v / max) * (h - pad.top - pad.bottom);

  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(data.length - 1).toFixed(1)},${h - pad.bottom} L${pad.left},${h - pad.bottom} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("w-full", className)} role="img" aria-label="Evolución de ventas">
      <defs>
        <linearGradient id="tf-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={pad.left} x2={w - pad.right} y1={y(max * f)} y2={y(max * f)}
          stroke="var(--border)" strokeDasharray="3 5" strokeWidth="1" />
      ))}
      <path d={area} fill="url(#tf-area)" />
      <path d={line} fill="none" stroke="var(--chart-1)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {data.map((d, i) => (
        <g key={d.label}>
          <circle cx={x(i)} cy={y(d.value)} r="3" fill="var(--card)" stroke="var(--chart-1)" strokeWidth="2">
            <title>{`${d.label}: ${currencyFormatter ? currencyFormatter(d.value) : d.value}`}</title>
          </circle>
          {(data.length <= 12 || i % Math.ceil(data.length / 10) === 0) && (
            <text x={x(i)} y={h - 6} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">
              {d.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

export function BarList({
  data, formatter, tone = "primary", className, max: maxProp,
}: {
  data: Point[];
  formatter?: (v: number) => string;
  tone?: "primary" | "coral" | "amber";
  className?: string;
  max?: number;
}) {
  if (data.length === 0) {
    return <p className={cn("py-6 text-center text-sm text-muted-foreground", className)}>Sin datos todavía</p>;
  }
  const max = maxProp ?? Math.max(...data.map((d) => d.value), 1);
  const colors: Record<string, string> = {
    primary: "bg-primary",
    coral: "bg-[oklch(0.63_0.17_35)]",
    amber: "bg-[oklch(0.79_0.14_80)]",
  };
  return (
    <ul className={cn("space-y-2.5", className)}>
      {data.map((d, i) => (
        <li key={`${d.label}-${i}`} className="tf-rise" style={{ animationDelay: `${i * 45}ms` }}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate font-medium">{d.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatter ? formatter(d.value) : d.value}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full transition-[width] duration-700", colors[tone])}
              style={{ width: `${Math.max((d.value / max) * 100, 2)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Donut({
  slices, size = 168, thickness = 22, centerLabel, centerValue,
}: {
  slices: { label: string; value: number; color: string }[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex items-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Distribución por canal">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={thickness} />
          {total > 0 && slices.map((s) => {
            const len = (s.value / total) * c;
            const el = (
              <circle key={s.label} cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke={s.color} strokeWidth={thickness}
                strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} strokeLinecap="butt">
                <title>{`${s.label}: ${s.value}`}</title>
              </circle>
            );
            offset += len;
            return el;
          })}
        </g>
        <text x="50%" y="46%" textAnchor="middle" className="font-display" fontSize="20" fontWeight="600" fill="var(--foreground)">
          {centerValue}
        </text>
        <text x="50%" y="60%" textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">
          {centerLabel}
        </text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
            <span className="tabular-nums text-muted-foreground">
              {total > 0 ? `${Math.round((s.value / total) * 100)}%` : "0%"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const CHART_COLORS = [
  "var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)",
  "oklch(0.55 0.1 300)", "oklch(0.6 0.12 20)", "oklch(0.65 0.1 130)",
];
