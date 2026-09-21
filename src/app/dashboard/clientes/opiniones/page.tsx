"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { Icon } from "@/components/tf/icon";
import { EmptyState } from "@/components/tf/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, formatNumber } from "@/lib/format";
import { SKIP_LABEL, type SkipReason } from "@/lib/voice";

/**
 * LA REPUTACIÓN DE LA OPERADORA.
 *
 * La pantalla contesta tres preguntas y ninguna más:
 *
 *  · ¿nos recomiendan? (el NPS, no una media de estrellas);
 *  · ¿con quién y con qué salen contentos? (por guía y por producto);
 *  · ¿a quién hay que llamar HOY?
 *
 * La tercera es la que justifica el módulo. Un panel donde el detractor solo
 * baja una media es un panel que se mira y no se usa: lo que recupera a un
 * cliente es que alguien coja el teléfono el mismo día.
 */

interface Nps {
  score: number | null;
  promoters: number;
  passives: number;
  detractors: number;
  answered: number;
}

interface Row {
  id: string;
  bookingId: string;
  customerName: string;
  productName: string;
  guideName: string;
  nps: number | null;
  comment: string | null;
  answeredAt: string | null;
  status: string;
  skipReason: string | null;
  caseId: string | null;
}

interface Payload {
  summary: {
    total: number; asked: number; answered: number; skipped: number;
    responseRate: number | null; nps: Nps; skips: Record<string, number>;
  };
  byProduct: { key: string; name: string; nps: Nps }[];
  byGuide: { key: string; name: string; nps: Nps }[];
  byMonth: { key: string; nps: Nps }[];
  detractors: Row[];
  latest: Row[];
}

const VENTANAS = [
  { days: 30, label: "30 días" },
  { days: 90, label: "90 días" },
  { days: 365, label: "Un año" },
];

/** Un NPS nulo no es un cero: es «todavía no hay datos». */
const nota = (nps: Nps) => (nps.score === null ? "—" : String(nps.score));

const tono = (nps: Nps): "primary" | "coral" | "ink" | "default" => {
  if (nps.score === null) return "default";
  if (nps.score >= 50) return "primary";
  if (nps.score < 0) return "coral";
  return "ink";
};

export default function OpinionesPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(90);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.get<Payload>(`/api/voice?days=${days}`);
    setLoading(false);
    if (!res.ok) {
      console.error("[opiniones] no se pudo cargar:", res.error);
      toast.error(res.error?.message || "No se pudieron cargar las opiniones");
      return;
    }
    setData(res.data || null);
  }, [days]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const s = data?.summary;
  const vacio = (s?.total ?? 0) === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Clientes"
        title="Opiniones"
        description="Qué dice quien ya viajó. Se pregunta solo, cuatro horas después de que termina la excursión, y quien pone una nota baja abre un caso para que alguien lo llame."
        actions={
          <>
            <div className="flex rounded-lg border border-border p-0.5">
              {VENTANAS.map((v) => (
                <Button key={v.days} size="sm"
                  variant={days === v.days ? "default" : "ghost"}
                  onClick={() => setDays(v.days)}>
                  {v.label}
                </Button>
              ))}
            </div>
            <Button variant="outline" size="icon" onClick={load} aria-label="Actualizar">
              <Icon name="RefreshCw" className="size-4" />
            </Button>
          </>
        }
      />

      {vacio ? (
        <div className="tf-card p-2">
          <EmptyState
            icon="MessageSquare"
            title="Todavía no hay opiniones"
            description="Las encuestas salen solas cuatro horas después de que termina una excursión. En cuanto opere la primera salida, esto se llena."
            action={
              <Link href="/dashboard/salidas">
                <Button className="gap-1.5"><Icon name="CalendarDays" className="size-4" /> Ver salidas</Button>
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard tone={tono(s!.nps)} icon="Heart" label="NPS"
              value={nota(s!.nps)}
              hint={`${formatNumber(s!.nps.promoters)} recomiendan · ${formatNumber(s!.nps.detractors)} no`} />
            <KpiCard icon="MessageSquare" label="Contestaron"
              value={s!.responseRate === null ? "—" : `${s!.responseRate}%`}
              hint={`${formatNumber(s!.answered)} de ${formatNumber(s!.asked)} preguntados`} />
            <KpiCard tone={(data?.detractors.length ?? 0) > 0 ? "coral" : "default"} icon="PhoneCall"
              label="Por llamar" value={formatNumber(data?.detractors.length ?? 0)}
              hint="Detractores con caso abierto" />
            <KpiCard icon="UserX" label="Sin preguntar"
              value={formatNumber(s!.skipped)}
              hint={resumenOmisiones(s!.skips)} />
          </section>

          {(data?.detractors.length ?? 0) > 0 ? (
            <section className="tf-card">
              <header className="flex items-center gap-2 border-b px-4 py-3">
                <Icon name="PhoneCall" className="size-4 text-coral" />
                <h2 className="font-medium">A quién llamar hoy</h2>
              </header>
              <ul className="divide-y">
                {data!.detractors.map((r) => (
                  <li key={r.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {r.customerName}
                        <span className="ml-2 rounded-md bg-coral/10 px-1.5 py-0.5 text-xs font-semibold text-coral">
                          {r.nps}/10
                        </span>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {[r.productName, r.guideName && `con ${r.guideName}`].filter(Boolean).join(" · ")}
                      </p>
                      {r.comment ? <p className="mt-1 text-sm">«{r.comment}»</p> : null}
                    </div>
                    <div className="shrink-0 text-right text-xs text-muted-foreground">
                      {r.answeredAt ? formatDateTime(r.answeredAt) : ""}
                      {r.caseId ? (
                        <Link href="/dashboard/clientes/casos" className="ml-2 underline underline-offset-2">
                          Ver caso
                        </Link>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <Tabla titulo="Por guía" icono="UserCheck" filas={data?.byGuide ?? []}
              vacio="Ninguna salida tenía guía asignado" />
            <Tabla titulo="Por excursión" icono="Map" filas={data?.byProduct ?? []}
              vacio="Sin respuestas todavía" />
          </div>

          {(data?.latest.length ?? 0) > 0 ? (
            <section className="tf-card">
              <header className="flex items-center gap-2 border-b px-4 py-3">
                <Icon name="MessageSquare" className="size-4" />
                <h2 className="font-medium">Lo último que nos dijeron</h2>
              </header>
              <ul className="divide-y">
                {data!.latest.filter((r) => r.comment).slice(0, 15).map((r) => (
                  <li key={r.id} className="px-4 py-3">
                    <p className="text-sm">«{r.comment}»</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[`${r.nps}/10`, r.customerName, r.productName, r.guideName]
                        .filter(Boolean).join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function resumenOmisiones(skips: Record<string, number>): string {
  const partes = Object.entries(skips)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([motivo, n]) => `${n} ${(SKIP_LABEL[motivo as SkipReason] ?? motivo).toLowerCase()}`);
  return partes.join(" · ") || "A todos se les preguntó";
}

function Tabla({
  titulo, icono, filas, vacio,
}: {
  titulo: string;
  icono: "UserCheck" | "Map";
  filas: { key: string; name: string; nps: Nps }[];
  vacio: string;
}) {
  return (
    <section className="tf-card">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <Icon name={icono} className="size-4" />
        <h2 className="font-medium">{titulo}</h2>
      </header>
      {filas.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">{vacio}</p>
      ) : (
        <ul className="divide-y">
          {filas.map((f) => (
            <li key={f.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="truncate">{f.name}</span>
              <span className="flex shrink-0 items-center gap-2">
                {/*
                  El recuento va SIEMPRE al lado de la nota: un NPS de 100 sobre
                  dos respuestas y otro de 62 sobre ciento veinte no se pueden
                  leer igual, y esconder el segundo número es cómo alguien acaba
                  moviendo a un guía por dos encuestas.
                */}
                <span className="text-xs text-muted-foreground">
                  {formatNumber(f.nps.answered)} resp.
                </span>
                <span className="w-10 text-right font-semibold tabular-nums">{nota(f.nps)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
