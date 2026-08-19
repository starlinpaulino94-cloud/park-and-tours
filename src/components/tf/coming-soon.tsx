import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/tf/icon";
import { PageHeader } from "@/components/tf/page-header";

/**
 * Placeholder for modules whose backend is already live (see /api/*) but whose
 * screen is not built yet. Keeps every navigation link resolvable.
 */
export function ComingSoon({
  eyebrow, title, description, endpoints = [], icon = "Hammer",
}: {
  eyebrow: string;
  title: string;
  description: string;
  endpoints?: string[];
  icon?: string;
}) {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <div className="tf-card flex flex-col items-center gap-4 px-6 py-16 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-primary/10 text-primary">
          <Icon name={icon} className="size-6" />
        </span>
        <p className="font-display text-xl font-semibold">Pantalla en construcción</p>
        <p className="max-w-lg text-sm text-muted-foreground">
          La lógica de negocio de este módulo ya está implementada en el servidor. Falta únicamente la interfaz.
        </p>
        {endpoints.length > 0 && (
          <ul className="mt-2 flex flex-wrap justify-center gap-2">
            {endpoints.map((e) => (
              <li key={e} className="rounded-full border border-border bg-muted/50 px-3 py-1 font-mono text-[11px]">{e}</li>
            ))}
          </ul>
        )}
        <Link href="/dashboard" className="mt-2">
          <Button variant="outline" className="gap-1.5"><Icon name="ArrowLeft" className="size-4" /> Volver al panel</Button>
        </Link>
      </div>
    </div>
  );
}
