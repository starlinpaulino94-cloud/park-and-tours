/** Esqueleto de la ruta completa mientras se resuelve el contexto de empresa. */
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Cargando Mi día">
      <div className="h-8 w-32 animate-pulse rounded bg-muted/50" />
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[76px] animate-pulse rounded-xl border border-border bg-muted/40" />
        ))}
      </div>
      <div className="space-y-1.5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg border border-border bg-muted/40" />
        ))}
      </div>
    </div>
  );
}
