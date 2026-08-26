"use client";

import { cn } from "@/lib/utils";
import { Icon } from "@/components/tf/icon";

export function KpiCard({
  label, value, hint, icon, trend, definition, tone = "default", className, style,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: string;
  trend?: number | null;
  definition?: string;
  tone?: "default" | "primary" | "coral" | "amber" | "ink";
  className?: string;
  style?: React.CSSProperties;
}) {
  // Every pair below is verified against WCAG AA (>= 4.5:1) for the label,
  // the value and the hint — the hint included, which is why it is dimmed with
  // opacity-90 instead of the opacity-80 that used to fall under the threshold.
  // These use fixed brand steps rather than `bg-primary`/theme tokens so the
  // saturated cards keep the exact same verified pairing in light and dark.
  const tones: Record<string, string> = {
    default: "bg-card",
    primary: "bg-brand-700 text-white border-brand-700",
    coral: "bg-coral text-white border-coral",
    amber: "bg-amber text-ink border-amber",
    ink: "bg-ink text-sand border-ink",
  };
  const muted = tone === "default" ? "text-muted-foreground" : "opacity-90";

  return (
    <div className={cn("tf-card tf-rise relative overflow-hidden p-4", tones[tone], className)} style={style} title={definition}>
      <div className="flex items-start justify-between gap-3">
        <p className={cn("text-[11px] font-semibold uppercase tracking-[0.14em]", muted)}>{label}</p>
        {icon && (
          <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg",
            tone === "default" ? "bg-primary/10 text-primary" : "bg-white/15")}>
            <Icon name={icon} className="size-4" />
          </span>
        )}
      </div>
      <p className="tf-num mt-2.5 text-[27px] leading-none">{value}</p>
      <div className="mt-2 flex items-center gap-2">
        {typeof trend === "number" && Number.isFinite(trend) && (
          <span
            className={cn(
              "tf-num inline-flex items-center gap-0.5 text-[11px] font-semibold",
              trend >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400",
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
