import Link from "next/link";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/tf/icon";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { visibleSections, type Domain } from "@/lib/nav";

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
 * Landing screen of a domain. Lists the domain's own modules as cards grouped
 * by section, each carrying a live figure, so entering an area feels like
 * opening a smaller system with its own dashboard rather than jumping to a list.
 */
export function DomainHub({
  domain, role, modules, companyType, kpis, metrics, children,
}: {
  domain: Domain;
  role?: string;
  modules?: string[] | null;
  companyType?: string;
  kpis?: HubKpi[];
  /** Keyed by module href. */
  metrics?: Record<string, HubMetric>;
  children?: React.ReactNode;
}) {
  const sections = visibleSections(domain, role, modules, companyType);
  const moduleCount = sections.reduce((n, s) => n + s.items.length, 0);

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow={`Área · ${moduleCount} módulos`}
        title={domain.label}
        description={domain.tagline}
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
        {sections.map((section) => (
          <section key={section.title}>
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
                    key={item.href}
                    href={item.href}
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
                          {item.badge && (
                            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-primary">
                              {item.badge}
                            </span>
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
