"use client";

import { cn } from "@/lib/utils";
import { Icon } from "@/components/tf/icon";

export function KpiCard({
  label, value, hint, icon, trend, tone = "default", className, style,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: string;
  trend?: number | null;
  tone?: "default" | "primary" | "coral" | "amber" | "ink";
  className?: string;
  style?: React.CSSProperties;
}) {
  const tones: Record<string, string> = {
    default: "bg-card",
    primary: "bg-primary text-primary-foreground border-primary",
    coral: "bg-[oklch(0.63_0.17_35)] text-white border-transparent",
    amber: "bg-[oklch(0.79_0.14_80)] text-[oklch(0.24_0.035_210)] border-transparent",
    ink: "bg-[oklch(0.24_0.035_210)] text-[oklch(0.95_0.012_90)] border-transparent",
  };
  const muted = tone === "default" ? "text-muted-foreground" : "opacity-80";

  return (
    <div className={cn("tf-card tf-rise relative overflow-hidden p-4", tones[tone], className)} style={style}>
      <div className="flex items-start justify-between gap-3">
        <p className={cn("text-[11px] font-semibold uppercase tracking-[0.14em]", muted)}>{label}</p>
        {icon && (
          <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg",
            tone === "default" ? "bg-primary/10 text-primary" : "bg-white/15")}>
            <Icon name={icon} className="size-4" />
          </span>
        )}
      </div>
      <p className="mt-2 font-display text-[26px] font-semibold leading-none tabular-nums">{value}</p>
      <div className="mt-2 flex items-center gap-2">
        {typeof trend === "number" && Number.isFinite(trend) && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-[11px] font-bold tabular-nums",
              trend >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400",
              tone !== "default" && "text-current"
            )}
          >
            <Icon name={trend >= 0 ? "ArrowUpRight" : "ArrowDownRight"} className="size-3" />
            {Math.abs(trend).toFixed(1)}%
          </span>
        )}
        {hint && <p className={cn("truncate text-xs", muted)}>{hint}</p>}
      </div>
    </div>
  );
}
