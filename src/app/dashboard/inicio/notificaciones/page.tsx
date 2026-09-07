"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/tf/page-header";
import { EmptyState } from "@/components/tf/empty-state";
import { StatusBadge } from "@/components/tf/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Icon } from "@/components/tf/icon";
import { NOTIFICATION_TYPE } from "@/lib/labels-modules";
import { formatDateTime } from "@/lib/format";
import { humanizeElapsed } from "@/lib/time";

interface NotificationRow {
  _id?: string;
  id?: string;
  title: string;
  message: string | null;
  notification_type: string | null;
  link: string | null;
  read_status: boolean;
  createdAt?: string;
  created_at?: string;
}

// Icono por tipo de aviso, reutilizando la semántica de NOTIFICATION_TYPE.
const TYPE_ICON: Record<string, string> = {
  info: "Info", booking: "CalendarCheck", payment: "Banknote",
  operation: "Settings", alert: "TriangleAlert", settlement: "Wallet",
};

const SCOPES = [
  { value: "all", label: "Todas" },
  { value: "unread", label: "No leídas" },
] as const;
type Scope = (typeof SCOPES)[number]["value"];

const rowId = (n: NotificationRow) => String(n._id || n.id || "");
const rowDate = (n: NotificationRow) => n.createdAt || n.created_at || null;

export default function Page() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("all");
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const seq = useRef(0);

  const load = useCallback(async () => {
    const current = ++seq.current;
    setError(null);
    setLoading(true);
    const res = await api.get<{ items: NotificationRow[]; unreadCount: number }>(
      `/api/notifications${scope === "unread" ? "?scope=unread" : ""}`
    );
    if (current !== seq.current) return;
    setLoading(false);
    if (!res.ok || !res.data) {
      setError(res.error?.message || "No se pudieron cargar las notificaciones");
      return;
    }
    setItems(res.data.items || []);
    setUnreadCount(res.data.unreadCount || 0);
  }, [scope]);

  useEffect(() => { void load(); }, [load]);

  const setRead = async (n: NotificationRow, read: boolean) => {
    const id = rowId(n);
    if (!id) return;
    // Optimista: refleja el cambio de inmediato y ajusta el contador.
    setItems((prev) => prev.map((x) => (rowId(x) === id ? { ...x, read_status: read } : x)));
    setUnreadCount((c) => Math.max(0, c + (read ? -1 : 1)));
    const res = await api.post(`/api/notifications/${id}/read`, { read });
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo actualizar la notificación");
      void load();
    }
  };

  const open = (n: NotificationRow) => {
    if (!n.read_status) void setRead(n, true);
    if (n.link) startTransition(() => router.push(n.link!));
  };

  const markAll = async () => {
    setBusy(true);
    const res = await api.post<{ updated: number }>("/api/notifications", { action: "mark_all_read" });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudieron marcar como leídas");
      return;
    }
    toast.success(res.data?.updated ? `${res.data.updated} marcadas como leídas` : "No había notificaciones sin leer");
    void load();
  };

  const visible = scope === "unread" ? items.filter((n) => !n.read_status) : items;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notificaciones"
        actions={
          <Button variant="outline" className="gap-1.5" onClick={markAll} disabled={busy || unreadCount === 0}>
            <Icon name="CheckCheck" className="size-4" aria-hidden /> Marcar todas como leídas
          </Button>
        }
      />

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtros de notificaciones">
        {SCOPES.map((chip) => (
          <button
            key={chip.value}
            type="button"
            onClick={() => setScope(chip.value)}
            aria-pressed={scope === chip.value}
            className={cn(
              "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              scope === chip.value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-muted"
            )}
          >
            {chip.label}
            {chip.value === "unread" && unreadCount > 0 && (
              <span className="tf-num rounded-full bg-background/20 px-1.5 text-[11px]">{unreadCount}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>
      ) : error ? (
        <div className="tf-card p-6 text-center">
          <p className="mb-4 text-sm text-muted-foreground">{error}</p>
          <Button onClick={() => void load()}>Reintentar</Button>
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon="Bell"
          title={scope === "unread" ? "No tienes notificaciones sin leer" : "No tienes notificaciones"}
          description="Aquí aparecen tus avisos de reservas, pagos, operación y liquidaciones."
        />
      ) : (
        <ul className="space-y-1.5">
          {visible.map((n) => {
            const id = rowId(n);
            const date = rowDate(n);
            const clickable = Boolean(n.link);
            return (
              <li
                key={id}
                className={cn(
                  "flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                  n.read_status ? "border-border bg-card" : "border-primary/40 bg-primary/5"
                )}
              >
                <span className={cn("mt-0.5 shrink-0", n.read_status ? "text-muted-foreground" : "text-primary")}>
                  <Icon name={TYPE_ICON[n.notification_type || "info"] || "Bell"} className="size-4" aria-hidden />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {!n.read_status && <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="No leída" />}
                    {clickable ? (
                      <button type="button" onClick={() => open(n)}
                        className={cn("truncate text-left text-sm hover:underline", n.read_status ? "font-medium" : "font-semibold")}>
                        {n.title}
                      </button>
                    ) : (
                      <p className={cn("truncate text-sm", n.read_status ? "font-medium" : "font-semibold")} title={n.title}>{n.title}</p>
                    )}
                    <StatusBadge value={n.notification_type} dict={NOTIFICATION_TYPE} />
                  </div>
                  {n.message && <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">{n.message}</p>}
                  {date && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground" title={formatDateTime(date)}>
                      {humanizeElapsed(date, new Date())}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {clickable && (
                    <Button variant="ghost" size="sm" className="h-9 px-2" onClick={() => open(n)} aria-label={`Abrir ${n.title}`}>
                      <Icon name="ArrowUpRight" className="size-4" aria-hidden />
                    </Button>
                  )}
                  <Button
                    variant="ghost" size="sm" className="h-9 px-2"
                    onClick={() => void setRead(n, !n.read_status)}
                    aria-label={n.read_status ? `Marcar como no leída ${n.title}` : `Marcar como leída ${n.title}`}
                  >
                    <Icon name={n.read_status ? "Undo2" : "Check"} className="size-4" aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
