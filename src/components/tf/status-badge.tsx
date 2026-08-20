"use client";

import { cn } from "@/lib/utils";
import { labelOf, type LabelDef, type Tone } from "@/lib/labels";

const TONES: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  info: "bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/50 dark:text-sky-200 dark:border-sky-900",
  success: "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-900",
  warning: "bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-900",
  danger: "bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/50 dark:text-rose-200 dark:border-rose-900",
  accent: "bg-brand-50 text-brand-800 border-brand-200 dark:bg-brand-950/60 dark:text-brand-200 dark:border-brand-900",
  violet: "bg-violet-50 text-violet-800 border-violet-200 dark:bg-violet-950/50 dark:text-violet-200 dark:border-violet-900",
};

export function StatusBadge({
  value, dict, className, dot = true,
}: {
  value?: string | null;
  dict: Record<string, LabelDef>;
  className?: string;
  dot?: boolean;
}) {
  const def = labelOf(dict, value);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide whitespace-nowrap",
        TONES[def.tone],
        className
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden />}
      {def.label}
    </span>
  );
}

export function Pill({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", TONES[tone], className)}>
      {children}
    </span>
  );
}
