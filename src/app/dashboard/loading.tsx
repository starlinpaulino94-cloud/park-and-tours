import { Skeleton } from "@/components/ui/skeleton";

/**
 * Esqueleto compartido por todo el dashboard.
 *
 * Sin este archivo, Next.js mantiene la pantalla anterior bloqueada mientras el
 * servidor renderiza la siguiente: para quien navega, la app parece congelada.
 * Con él, el cambio de módulo se pinta al instante y además el `prefetch` de los
 * enlaces puede cachear esta frontera, de modo que el menú responde de inmediato.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-xl" />
        ))}
      </div>

      <Skeleton className="h-[420px] rounded-xl" />
    </div>
  );
}
