"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PRIORITY, TASK_TYPE } from "@/lib/labels-modules";

interface TeamMember { _id?: string; id?: string; name?: string; email?: string }

const TYPE_OPTIONS = Object.entries(TASK_TYPE).map(([value, def]) => ({ value, label: def.label }));
const PRIORITY_OPTIONS = Object.entries(PRIORITY).map(([value, def]) => ({ value, label: def.label }));

const EMPTY_FORM = { title: "", description: "", task_type: "general", priority: "medium", due_at: "" };

export function CreateTaskDialog({ currentUserId, currentUserName }: { currentUserId: string; currentUserName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [assignedTo, setAssignedTo] = useState(currentUserId);
  const [team, setTeam] = useState<{ id: string; name: string }[] | null>(null);
  const [, startTransition] = useTransition();

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && team === null) void loadTeam();
    if (!next) { setForm(EMPTY_FORM); setAssignedTo(currentUserId); }
  };

  // Solo managers/admin pueden listar el equipo; si el rol no puede, se asigna
  // a uno mismo en silencio (la vista solo muestra las tareas propias de todos
  // modos, así que el valor por defecto es el correcto para cualquier rol).
  async function loadTeam() {
    const res = await api.get<TeamMember[]>("/api/team");
    if (!res.ok || !Array.isArray(res.data)) { setTeam([]); return; }
    const members = res.data
      .map((m) => ({ id: String(m._id || m.id || ""), name: m.name || m.email || "Sin nombre" }))
      .filter((m) => m.id);
    if (!members.some((m) => m.id === currentUserId)) {
      members.unshift({ id: currentUserId, name: `${currentUserName} (yo)` });
    }
    setTeam(members);
  }

  const create = async () => {
    const title = form.title.trim();
    if (!title) { toast.error("El título es obligatorio"); return; }
    setBusy(true);
    const res = await api.post("/api/erp/task", {
      title,
      description: form.description.trim() || null,
      task_type: form.task_type,
      priority: form.priority,
      due_at: form.due_at || null,
      status: "todo",
      assigned_to: assignedTo || currentUserId,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo crear la tarea");
      return;
    }
    const mine = (assignedTo || currentUserId) === currentUserId;
    toast.success(mine ? "Tarea creada" : "Tarea creada y asignada");
    setOpen(false);
    setForm(EMPTY_FORM);
    setAssignedTo(currentUserId);
    startTransition(() => router.refresh());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="gap-1.5"><Icon name="Plus" className="size-4" aria-hidden /> Nueva tarea</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-left">Nueva tarea</DialogTitle>
          <DialogDescription className="text-left">
            Se crea con estado &laquo;Por hacer&raquo;. Aparecerá en esta vista si te la asignas a ti.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="task-title">Título</Label>
            <Input id="task-title" value={form.title} maxLength={200}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="p. ej. Llamar al proveedor de transporte" autoFocus />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-desc">Descripción (opcional)</Label>
            <Textarea id="task-desc" value={form.description} rows={3}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Detalles, contexto o pasos a seguir" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={form.task_type} onValueChange={(v) => setForm((f) => ({ ...f, task_type: v }))}>
                <SelectTrigger aria-label="Tipo de tarea"><SelectValue /></SelectTrigger>
                <SelectContent>{TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Prioridad</Label>
              <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v }))}>
                <SelectTrigger aria-label="Prioridad"><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="task-due">Vencimiento (opcional)</Label>
              <Input id="task-due" type="datetime-local" value={form.due_at}
                onChange={(e) => setForm((f) => ({ ...f, due_at: e.target.value }))} />
            </div>
            {team && team.length > 1 && (
              <div className="space-y-1.5">
                <Label>Asignar a</Label>
                <Select value={assignedTo} onValueChange={setAssignedTo}>
                  <SelectTrigger aria-label="Asignar a"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {team.map((m) => <SelectItem key={m.id} value={m.id}>{m.id === currentUserId ? `${m.name}` : m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={create} disabled={busy}>{busy ? "Creando…" : "Crear tarea"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
