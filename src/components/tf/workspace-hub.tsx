import Link from "next/link";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/tf/icon";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { visibleGroups, type NavContext, type Workspace } from "@/lib/nav";

export interface HubMetric {
  /** Short live figure shown on the module card, e.g. "18 abiertas". */
  value: string;
  /** Draws attention when something needs action. */
  tone?: "neutral" | "good" | "warn" | "bad";
}

export interface HubKpi {
  label: string;
  value: string;
  hint?: string;
  icon?: string;
  tone?: "default" | "primary" | "coral" | "amber" | "ink";
}

const METRIC_TONE: Record<string, string> = {
  neutral: "bg-muted text-muted-foreground",
  good: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200",
  warn: "bg-amber-50 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200",
  bad: "bg-rose-50 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200",
};

/**
 * Pantalla de entrada de un workspace: sus propios módulos en tarjetas,
 * agrupadas igual que en el panel contextual y con una cifra viva cada una.
 * Entrar a un workspace se siente como abrir un sistema más pequeño con su
 * propio tablero, no como saltar a una lista.
 */
export function WorkspaceHub({
  workspace, role, modules, companyType, kpis, metrics, children,
}: {
  workspace: Workspace;
  role?: string;
  modules?: string[] | null;
  companyType?: string;
  kpis?: HubKpi[];
  /** Keyed by module href. */
  metrics?: Record<string, HubMetric>;
  children?: React.ReactNode;
}) {
  const ctx: NavContext = { role, modules, companyType };
  const groups = visibleGroups(workspace, ctx);
  const moduleCount = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow={`Workspace · ${moduleCount} módulos`}
        title={workspace.label}
        description={workspace.tagline}
      />

      {kpis && kpis.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((k, i) => (
            <KpiCard
              key={k.label}
              label={k.label}
              value={k.value}
              hint={k.hint}
              icon={k.icon}
              tone={k.tone}
              className="tf-rise"
              style={{ animationDelay: `${i * 55}ms` }}
            />
          ))}
        </div>
      )}

      {children}

      <div className="space-y-7">
        {groups.map((section) => (
          <section key={section.id}>
            <div className="mb-3 flex items-center gap-3">
              <h2 className="font-display text-[15px] font-semibold tracking-tight">{section.title}</h2>
              <span className="tf-rule flex-1" />
              <span className="text-[11px] font-semibold text-muted-foreground">
                {section.items.length}
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {section.items.map((item) => {
                const metric = metrics?.[item.href];
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    target={item.external ? "_blank" : undefined}
                    className={cn(
                      "group tf-card flex flex-col gap-2.5 p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg",
                      item.primary && "border-primary/30 bg-primary/[0.03]"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={cn(
                          "grid size-9 shrink-0 place-items-center rounded-xl transition-colors",
                          item.primary
                            ? "bg-primary text-primary-foreground"
                            : "bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground"
                        )}
                      >
                        <Icon name={item.icon} className="size-[17px]" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 font-display text-[14px] font-semibold leading-tight">
                          <span className="truncate">{item.label}</span>
                          {item.tag && (
                            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-primary">
                              {item.tag}
                            </span>
                          )}
                          {item.external && (
                            <Icon name="ArrowUpRight" className="size-3.5 shrink-0 text-muted-foreground" />
                          )}
                        </p>
                        <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">
                          {item.description}
                        </p>
                      </div>
                    </div>
                    <div className="mt-auto flex items-center justify-between pt-1">
                      {metric ? (
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums",
                            METRIC_TONE[metric.tone || "neutral"]
                          )}
                        >
                          {metric.value}
                        </span>
                      ) : (
                        <span />
                      )}
                      <Icon
                        name="ArrowRight"
                        className="size-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                      />
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
