"use client";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/tf/icon";
import { useOrg } from "@/components/tf/org-context";

/**
 * LO QUE CONVIERTE UNA PANTALLA EN UN DOCUMENTO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO VIVE EN UN SOLO SITIO
 *
 * Una hoja impresa sin empresa, sin nombre de documento y sin período es una
 * hoja que dentro de seis meses nadie puede archivar: se encuentra en una
 * carpeta y no se sabe de qué es. El encabezado y el pie son, literalmente, lo
 * que la hace archivable.
 *
 * Había ya dos sitios que lo resolvían por su cuenta —el marco de los reportes
 * de listado y el cierre del día— y venían tres más (estados financieros,
 * declaración fiscal, antigüedad de saldos). Cinco copias del mismo encabezado
 * es garantía de que a los seis meses tres digan la empresa y dos no. Aquí hay
 * una, y las cinco la usan.
 */

/** El encabezado que SOLO sale en el papel. */
export function EncabezadoImpreso({
  titulo, periodo, nota,
}: {
  titulo: string;
  /** El período o la fecha de corte, ya redactado. */
  periodo: string;
  /** Una precisión sobre el alcance, cuando el período no lo dice todo. */
  nota?: string;
}) {
  const { companyName } = useOrg();
  return (
    <header className="print-only mb-3 border-b border-black/20 pb-3">
      <p className="text-[13px] font-semibold">{companyName}</p>
      <h1 className="text-[17px] font-bold">{titulo}</h1>
      <p className="text-[12px]">{periodo}</p>
      {nota && <p className="text-[11px]">{nota}</p>}
    </header>
  );
}

/** El pie que dice cuándo se generó y de dónde salió. */
export function PieImpreso({ nota }: { nota?: string }) {
  const { companyName } = useOrg();
  return (
    <footer className="print-only mt-4 border-t border-black/20 pt-2 text-[10px]">
      Generado el {new Date().toLocaleString("es-DO")} · {companyName}
      {nota ? ` · ${nota}` : ""}
    </footer>
  );
}

/**
 * Las líneas de firma.
 *
 * Un documento que se archiva sin quien responde por él es un papel. Va
 * `print-block` para que la impresión no lo parta por la mitad.
 */
export function Firmas({ roles }: { roles: string[] }) {
  return (
    <section className="print-block mt-6 grid gap-8" style={{ gridTemplateColumns: `repeat(${roles.length}, minmax(0, 1fr))` }}>
      {roles.map((rol) => (
        <div key={rol} className="pt-8">
          <div className="border-t border-black/40" />
          <p className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">{rol}</p>
        </div>
      ))}
    </section>
  );
}

export function BotonImprimir({ children = "Imprimir" }: { children?: React.ReactNode }) {
  return (
    <Button className="shrink-0 gap-1.5" onClick={() => window.print()}>
      <Icon name="Printer" className="size-4" />{children}
    </Button>
  );
}

/** El encabezado de pantalla de un documento: título, descripción y acciones. */
export function CabeceraDocumento({
  titulo, descripcion, acciones,
}: {
  titulo: string;
  descripcion?: string;
  acciones?: React.ReactNode;
}) {
  return (
    <header className="no-print flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Reporte</p>
        <h1 className="truncate text-2xl font-bold tracking-tight">{titulo}</h1>
        {descripcion && <p className="mt-1 text-sm text-muted-foreground">{descripcion}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {acciones}
        <BotonImprimir />
      </div>
    </header>
  );
}
