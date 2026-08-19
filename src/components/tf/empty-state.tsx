import { Icon } from "@/components/tf/icon";

export function EmptyState({
  icon = "Inbox", title, description, action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/80 bg-muted/30 px-6 py-14 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
        <Icon name={icon} className="size-5" />
      </div>
      <p className="font-display text-lg font-semibold">{title}</p>
      {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      {action}
    </div>
  );
}
