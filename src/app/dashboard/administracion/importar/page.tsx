"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/tf/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill } from "@/components/tf/status-badge";
import { Icon } from "@/components/tf/icon";
import { formatNumber } from "@/lib/format";
import type { ImportSummary, RowIssue, Mapping } from "@/lib/import";

/**
 * IMPORTAR DATOS.
 *
 * La pantalla que decide si una operadora se muda. Todo aquí está construido
 * sobre una regla: NADA SE ESCRIBE SIN QUE SE VEA ANTES. El usuario sube su
 * archivo, ve cómo se entendieron sus columnas, las corrige si hace falta, lee
 * cuántas filas se crean, cuántas se actualizan y cuáles fallan —con su número
 * de fila, el mismo que ve en su Excel— y solo entonces confirma.
 *
 * Un importador que escribe primero y explica después es un importador que
 * nadie usa dos veces.
 */

interface TargetInfo {
  key: string;
  label: string;
  description: string;
  fields: { name: string; label: string; type: string; required: boolean; values?: string[] }[];
  sample: string;
}

interface Preview {
  headers: string[];
  delimiter: string;
  mapping: Mapping;
  summary: ImportSummary;
  issues: RowIssue[];
  issuesTotal: number;
  preview: { line: number; values: Record<string, unknown>; issues: number }[];
}

export default function ImportarPage() {
  const [targets, setTargets] = useState<TargetInfo[] | null>(null);
  const [targetKey, setTargetKey] = useState<string>("");
  const [csv, setCsv] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [onExisting, setOnExisting] = useState<"update" | "skip">("update");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ created: number; updated: number; failed: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<TargetInfo[]>("/api/import").then((res) => {
      if (res.ok && res.data) {
        setTargets(res.data);
        if (res.data.length > 0) setTargetKey(res.data[0].key);
      } else {
        setTargets([]);
      }
    });
  }, []);

  const target = targets?.find((t) => t.key === targetKey);

  const reset = () => { setPreview(null); setMapping({}); setDone(null); };

  const onFile = async (file: File) => {
    // Se lee en el navegador para poder enseñar la vista previa antes de mandar
    // nada: el archivo del cliente no sale de su equipo hasta que él lo decide.
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    reset();
    await analyze(text, {});
  };

  const analyze = useCallback(async (text: string, useMapping: Mapping) => {
    if (!text.trim() || !targetKey) return;
    setBusy(true);
    const res = await api.post<Preview>("/api/import", {
      target: targetKey,
      csv: text,
      dryRun: true,
      ...(Object.keys(useMapping).length > 0 ? { mapping: useMapping } : {}),
    });
    setBusy(false);
    if (!res.ok || !res.data) {
      toast.error(res.error?.message || "No se pudo leer el archivo");
      return;
    }
    setPreview(res.data);
    setMapping(res.data.mapping);
  }, [targetKey]);

  const changeMapping = async (index: number, field: string) => {
    const next: Mapping = { ...mapping, [index]: field === "__ignorar__" ? null : field };
    setMapping(next);
    await analyze(csv, next);
  };

  const confirm = async () => {
    setBusy(true);
    const res = await api.post<{ outcome: { created: number; updated: number; failed: { line: number; message: string }[] } }>(
      "/api/import",
      { target: targetKey, csv, mapping, dryRun: false, onExisting }
    );
    setBusy(false);
    if (!res.ok || !res.data) {
      toast.error(res.error?.message || "No se pudo importar");
      return;
    }
    const { created, updated, failed } = res.data.outcome;
    setDone({ created, updated, failed: failed.length });
    toast.success(`${created} creados y ${updated} actualizados`);
  };

  const descargarEjemplo = () => {
    if (!target) return;
    const blob = new Blob([`\uFEFF${target.sample}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ejemplo-${target.key}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (targets === null) {
    return <div className="space-y-6"><Skeleton className="h-10 w-64" /><Skeleton className="h-64 w-full" /></div>;
  }
  if (targets.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Administración" title="Importar datos" />
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          Tu rol no permite importar datos. Pide a un administrador que lo haga.
        </CardContent></Card>
      </div>
    );
  }

  const errores = preview?.issues.filter((i) => i.severity === "error") ?? [];
  const avisos = preview?.issues.filter((i) => i.severity === "warning") ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administración"
        title="Importar datos"
        description="Trae tus clientes, productos y proveedores desde una hoja de cálculo. Nada se guarda hasta que lo confirmes."
      />

      {/* ── 1. Qué se importa ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">1 · ¿Qué vas a importar?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {targets.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => { setTargetKey(t.key); reset(); if (csv) analyze(csv, {}); }}
                className={
                  "rounded-lg border p-3 text-left transition-colors " +
                  (t.key === targetKey
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40")
                }
              >
                <p className="text-sm font-semibold">{t.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
              </button>
            ))}
          </div>

          {target && (
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">Columnas que se reconocen</p>
              <p>
                {target.fields.map((f) => f.label + (f.required ? " *" : "")).join(" · ")}
              </p>
              <p className="mt-1">
                Las marcadas con * son obligatorias. Las que no reconozca, las ignora — y puedes
                corregir el emparejamiento en el paso 3.
              </p>
              <Button variant="link" size="sm" className="mt-1 h-auto p-0 text-xs" onClick={descargarEjemplo}>
                <Icon name="ArrowDownToLine" className="mr-1 h-3 w-3" />
                Descargar un archivo de ejemplo
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── 2. El archivo ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">2 · Tu archivo</CardTitle>
          <CardDescription>
            CSV separado por comas o por punto y coma. Desde Excel: <em>Archivo → Guardar como → CSV</em>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Icon name="Upload" className="mr-1.5 h-4 w-4" />
              {fileName ? "Cambiar archivo" : "Elegir archivo"}
            </Button>
            {fileName && (
              <span className="text-sm text-muted-foreground">
                {fileName}
                {preview && ` · separador «${preview.delimiter === "\t" ? "tabulador" : preview.delimiter}»`}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── 3. El emparejamiento ── */}
      {preview && target && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">3 · Cómo se entendieron tus columnas</CardTitle>
            <CardDescription>
              Corrige cualquier emparejamiento que no cuadre. Lo que pongas en «Ignorar» no se importa.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {preview.headers.map((header, index) => {
                const value = mapping[index] ?? "__ignorar__";
                const campo = target.fields.find((f) => f.name === value);
                return (
                  <div key={index} className="rounded-md border p-2">
                    <p className="truncate text-xs font-medium" title={header}>{header || "(sin nombre)"}</p>
                    <select
                      className="mt-1 w-full rounded border bg-background px-2 py-1 text-sm"
                      value={value}
                      onChange={(e) => changeMapping(index, e.target.value)}
                      disabled={busy}
                    >
                      <option value="__ignorar__">— Ignorar —</option>
                      {target.fields.map((f) => (
                        <option key={f.name} value={f.name}>
                          {f.label}{f.required ? " *" : ""}
                        </option>
                      ))}
                    </select>
                    {campo?.values && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Valores: {campo.values.join(", ")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── 4. Qué va a pasar ── */}
      {preview && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">4 · Qué va a pasar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              {[
                { label: "Se crean", value: preview.summary.create, tone: "text-emerald-600" },
                { label: "Se actualizan", value: preview.summary.update, tone: "text-sky-600" },
                { label: "Se omiten", value: preview.summary.skipped, tone: "text-muted-foreground" },
                { label: "Con error", value: preview.summary.errors, tone: "text-rose-600" },
              ].map((m) => (
                <div key={m.label} className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">{m.label}</p>
                  <p className={`mt-1 text-xl font-semibold tabular-nums ${m.tone}`}>
                    {formatNumber(m.value)}
                  </p>
                </div>
              ))}
            </div>

            {preview.summary.update > 0 && (
              <div className="rounded-md border p-3">
                <p className="text-sm font-medium">Las que ya existen</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Se reconocen por su correo, teléfono o código. Solo se tocan los campos que trae
                  tu archivo: una columna que no venga no borra lo que la ficha ya tenía.
                </p>
                <div className="mt-2 flex gap-2">
                  {(["update", "skip"] as const).map((mode) => (
                    <Button
                      key={mode}
                      size="sm"
                      variant={onExisting === mode ? "default" : "outline"}
                      onClick={() => setOnExisting(mode)}
                      disabled={busy}
                    >
                      {mode === "update" ? "Actualizarlas" : "Dejarlas como están"}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {(errores.length > 0 || avisos.length > 0) && (
              <div className="rounded-md border">
                <div className="flex items-center justify-between border-b px-3 py-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Problemas encontrados
                    {preview.issuesTotal > preview.issues.length &&
                      ` (se muestran ${preview.issues.length} de ${preview.issuesTotal})`}
                  </p>
                </div>
                <ul className="max-h-64 divide-y overflow-y-auto">
                  {[...errores, ...avisos].map((issue, i) => (
                    <li key={i} className="flex items-start gap-2 px-3 py-2 text-sm">
                      <Pill tone={issue.severity === "error" ? "danger" : "warning"}>
                        Fila {issue.line}
                      </Pill>
                      <span className="min-w-0 flex-1 text-muted-foreground">{issue.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={confirm} disabled={busy || preview.summary.create + preview.summary.update === 0}>
                <Icon name="Check" className="mr-1.5 h-4 w-4" />
                Importar {formatNumber(preview.summary.create + preview.summary.update)} fila(s)
              </Button>
              <span className="text-xs text-muted-foreground">
                Puedes volver a subir el mismo archivo: lo ya importado se detecta y no se duplica.
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── El resultado ── */}
      {done && (
        <Card>
          <CardContent className="py-6 text-center">
            <Icon name="CheckCheck" className="mx-auto h-8 w-8 text-emerald-600" />
            <p className="mt-2 text-lg font-semibold">Importación terminada</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatNumber(done.created)} creados · {formatNumber(done.updated)} actualizados
              {done.failed > 0 && ` · ${formatNumber(done.failed)} con error`}
            </p>
            {done.failed > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Las filas con error no se escribieron. Corrígelas en tu archivo y vuelve a subirlo:
                lo que ya entró no se duplica.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
