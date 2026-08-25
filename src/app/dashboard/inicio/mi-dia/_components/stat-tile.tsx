import Link from "next/link";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/tf/icon";

export type StatTone = "default" | "danger" | "warning";

/**
 * Contador seleccionable del resumen operativo.
 *
 * Es un enlace real, no un `div`: navegable con teclado, con foco visible y
 * área táctil suficiente en móvil. El riesgo se comunica con el icono y la
 * etiqueta además del color, nunca solo con color, y un valor que no se pudo
 * calcular se muestra como "—" en lugar de fingir un cero.
 */
export function StatTile({
  label, value, icon, href, active = false, tone = "default", description,
}: {
  label: string;
  /** null = el contador falló; se muestra como dato no disponible. */
  value: number | null;
  icon: string;
  href: string;
  active?: boolean;
  tone?: StatTone;
  description?: string;
}) {
  const unavailable = value === null;
  const tones: Record<StatTone, string> = {
    default: "border-border",
    danger: "border-destructive/50",
    warning: "border-amber-500/50",
  };
  const accents: Record<StatTone, string> = {
    default: "bg-primary/10 text-primary",
    danger: "bg-destructive/10 text-destructive",
    warning: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  };

  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      aria-label={unavailable ? `${label}: dato no disponible` : `${label}: ${value}`}
      className={cn(
        "flex min-h-[76px] flex-col justify-between rounded-xl border bg-card p-3 transition-colors",
        "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        tones[tone],
        active && "ring-2 ring-primary ring-offset-1"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase leading-tight tracking-[0.1em] text-muted-foreground">
          {label}
        </span>
        <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg", accents[tone])}>
          <Icon name={icon} className="size-3.5" />
        </span>
      </div>
      <span
        className="tf-num text-[26px] leading-none"
        title={unavailable ? "No se pudo calcular este contador" : undefined}
      >
        {unavailable ? "—" : value}
      </span>
      {description && <span className="sr-only">{description}</span>}
    </Link>
  );
}
