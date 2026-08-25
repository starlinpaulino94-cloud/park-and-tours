"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Icon } from "@/components/tf/icon";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { APPROVAL_ACTION } from "@/lib/labels-modules";
import { RelativeTime } from "./relative-time";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

/** Datos ya resueltos en el servidor: importe formateado, nombre del solicitante, tiempos. */
export interface ApprovalRowData {
  id: string;
  code: string;
  actionType: string | null;
  reason: string;
  amountLabel: string | null;
  requesterName: string;
  requestedAtLabel: string;
  /** Instante de la solicitud, para mantener el "pendiente hace X" al día. */
  requestedAtIso: string | null;
  pendingForLabel: string;
  expiresLabel: string | null;
  requiresTwo: boolean;
  hasFirstSignature: boolean;
  /** Zona horaria de la empresa (configuración, no identidad del usuario). */
  timeZone: string;
}

type Decision = "approve" | "reject";

export function ApprovalRow({ approval }: { approval: ApprovalRowData }) {
  const router = useRouter();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();

  const signatureLabel = approval.requiresTwo
    ? approval.hasFirstSignature ? "Falta la segunda firma" : "Doble firma"
    : "Firma simple";

  const close = () => {
    setDecision(null);
    setNotes("");
  };

  const submit = async () => {
    if (!decision) return;
    if (decision === "reject" && !notes.trim()) {
      toast.error("Indica el motivo del rechazo");
      return;
    }

    setSaving(true);
    const res = await api.post<{ pendingSecondSignature?: boolean }>(
      `/api/approvals/${approval.id}/decide`,
      { action: decision, comment: notes.trim() || undefined }
    );
    setSaving(false);

    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo registrar la decisión");
      return;
    }
    toast.success(
      res.data?.pendingSecondSignature
        ? `${approval.code}: primera firma registrada, falta la segunda`
        : decision === "approve" ? `${approval.code} aprobada` : `${approval.code} rechazada`
    );
    close();
    startTransition(() => router.refresh());
  };

  return (
    <li className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="shrink-0 text-muted-foreground">
          <Icon name="UserCheck" className="size-4" aria-hidden />
        </span>

        <div className="min-w-0 flex-1 basis-[240px]">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="tf-num text-xs font-semibold">{approval.code}</span>
            <StatusBadge value={approval.actionType} dict={APPROVAL_ACTION} dot={false} />
            {approval.amountLabel && (
              <span className="tf-num text-sm font-semibold">{approval.amountLabel}</span>
            )}
            <Pill tone={approval.requiresTwo ? "warning" : "neutral"}>{signatureLabel}</Pill>
          </div>
          <p className="truncate text-sm text-muted-foreground" title={approval.reason}>
            {approval.reason}
          </p>
          <p className="text-xs text-muted-foreground">
            {approval.requesterName} · {approval.requestedAtLabel} · pendiente{" "}
            <RelativeTime
              kind="elapsed"
              iso={approval.requestedAtIso}
              timeZone={approval.timeZone}
              initial={approval.pendingForLabel}
            />
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" className="h-9">Revisar</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle className="text-left">{approval.code}</DialogTitle>
                <DialogDescription className="text-left">{signatureLabel}</DialogDescription>
              </DialogHeader>
              <dl className="space-y-2 text-sm">
                <Field label="Acción">
                  <StatusBadge value={approval.actionType} dict={APPROVAL_ACTION} dot={false} />
                </Field>
                <Field label="Motivo"><span className="whitespace-pre-wrap">{approval.reason}</span></Field>
                {approval.amountLabel && <Field label="Importe">{approval.amountLabel}</Field>}
                <Field label="Solicitante">{approval.requesterName}</Field>
                <Field label="Solicitada">{approval.requestedAtLabel}</Field>
                <Field label="Tiempo pendiente">{approval.pendingForLabel}</Field>
                {approval.expiresLabel && <Field label="Expira">{approval.expiresLabel}</Field>}
              </dl>
            </DialogContent>
          </Dialog>

          <Button size="sm" className="h-9" onClick={() => setDecision("approve")}>
            <Icon name="Check" className="mr-1 size-4" aria-hidden /> Aprobar
          </Button>
          <Button variant="outline" size="sm" className="h-9" onClick={() => setDecision("reject")}>
            <Icon name="X" className="mr-1 size-4" aria-hidden /> Rechazar
          </Button>
        </div>
      </div>

      {/* Confirmación accesible con observaciones. Nada se ejecuta sin ella. */}
      <Dialog open={decision !== null} onOpenChange={(open) => { if (!open) close(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {decision === "approve" ? "Confirmar aprobación" : "Confirmar rechazo"}
            </DialogTitle>
            <DialogDescription>
              {approval.code} · {approval.reason}
              {decision === "approve" && approval.requiresTwo && !approval.hasFirstSignature
                ? " — esta solicitud necesita dos firmas: la tuya quedará como la primera."
                : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor={`notes-${approval.id}`}>
              Observaciones{decision === "reject" ? " (obligatorio)" : " (opcional)"}
            </Label>
            <Textarea
              id={`notes-${approval.id}`}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              required={decision === "reject"}
              placeholder={decision === "reject" ? "Explica por qué se rechaza" : "Contexto de la decisión"}
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={close} disabled={saving}>Cancelar</Button>
            <Button
              variant={decision === "reject" ? "destructive" : "default"}
              onClick={() => void submit()}
              disabled={saving}
            >
              {saving ? "Registrando…" : decision === "approve" ? "Aprobar" : "Rechazar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <dt className="w-32 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}
