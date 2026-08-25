"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { Icon } from "@/components/tf/icon";
import { StatusBadge } from "@/components/tf/status-badge";
import { Button } from "@/components/ui/button";
import { PRIORITY, TASK_STATUS } from "@/lib/labels-modules";
import { RelativeTime } from "./relative-time";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Todo llega ya formateado en la zona horaria de la empresa desde el servidor. */
export interface TaskRowData {
  id: string;
  title: string;
  description: string | null;
  status: string | null;
  priority: string | null;
  /** "Vencida hace 3 h", "Hoy 06:00 p. m.", "Sin vencimiento". */
  dueLabel: string;
  /** Instante de vencimiento, para mantener la etiqueta al día en el cliente. */
  dueIso: string | null;
  /** Fecha y hora completas, para el detalle. */
  dueExact: string;
  bucketLabel: string;
  overdue: boolean;
  canComplete: boolean;
  /** Zona horaria de la empresa (configuración, no identidad del usuario). */
  timeZone: string;
}

export function TaskRow({ task }: { task: TaskRowData }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();

  const complete = async () => {
    setSaving(true);
    const res = await api.post(`/api/tasks/${task.id}/complete`, {});
    setSaving(false);
    setConfirming(false);

    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo completar la tarea");
      return;
    }
    toast.success("Tarea completada");
    startTransition(() => router.refresh());
  };

  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card px-3 py-2.5",
        task.overdue ? "border-destructive/50" : "border-border"
      )}
    >
      <span className={cn("shrink-0", task.overdue ? "text-destructive" : "text-muted-foreground")}>
        <Icon name={task.overdue ? "TriangleAlert" : "SquareCheck"} className="size-4" aria-hidden />
      </span>

      <div className="min-w-0 flex-1 basis-[220px]">
        {/* `title` nativo cubre el truncado; el detalle completo está a un clic. */}
        <p className="truncate text-sm font-semibold" title={task.title}>
          {task.title}
        </p>
        <RelativeTime
          kind="due"
          iso={task.dueIso}
          timeZone={task.timeZone}
          initial={task.dueLabel}
          className={cn("block text-xs", task.overdue ? "font-semibold text-destructive" : "text-muted-foreground")}
        />
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <StatusBadge value={task.priority} dict={PRIORITY} />
        <StatusBadge value={task.status} dict={TASK_STATUS} />
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="h-9 px-2" aria-label={`Abrir detalle de ${task.title}`}>
              <Icon name="Eye" className="size-4" aria-hidden />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-left">{task.title}</DialogTitle>
              <DialogDescription className="text-left">
                {task.bucketLabel} · {task.dueExact}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge value={task.priority} dict={PRIORITY} />
                <StatusBadge value={task.status} dict={TASK_STATUS} />
              </div>
              <p className="whitespace-pre-wrap text-muted-foreground">
                {task.description || "Esta tarea no tiene descripción."}
              </p>
            </div>
            <DialogFooter>
              {task.canComplete && (
                <Button onClick={() => setConfirming(true)} disabled={saving}>
                  <Icon name="Check" className="mr-1.5 size-4" aria-hidden /> Marcar completada
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {task.canComplete && (
          <Button
            variant="outline"
            size="sm"
            className="h-9 px-2"
            onClick={() => setConfirming(true)}
            disabled={saving}
            aria-label={`Marcar como completada la tarea ${task.title}`}
          >
            <Icon name="Check" className="size-4" aria-hidden />
          </Button>
        )}
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Marcar la tarea como completada?</AlertDialogTitle>
            <AlertDialogDescription>
              {task.title}. La acción se registra en la auditoría.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => { event.preventDefault(); void complete(); }}
              disabled={saving}
            >
              {saving ? "Guardando…" : "Completar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
