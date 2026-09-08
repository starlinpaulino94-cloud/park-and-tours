"use client";

import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TICKET_STATUS, TICKET_TYPE } from "@/lib/labels-modules";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { isClosed, isExpired, isNotYetValid, isUsable, remainingEntries } from "@/lib/tickets";
import { TicketValidator, type AccessTicket } from "./ticket-validator";

/**
 * Vigencia real del pase.
 *
 * `status` se queda obsoleto solo —un pase con `valid_to` pasado sigue diciendo
 * "Emitido"—, así que la fecha manda sobre el campo almacenado. Los predicados
 * viven en `src/lib/tickets.ts`, los mismos que usa la puerta para decidir.
 */
function ValidityPill({ t }: { t: AccessTicket }) {
  if (isClosed(t)) return <Pill tone="neutral">Cerrado</Pill>;
  if (isExpired(t)) return <Pill tone="danger">Vencido</Pill>;
  if (isNotYetValid(t)) return <Pill tone="warning">Aún no vigente</Pill>;
  if (!isUsable(t)) return <Pill tone="warning">Agotado</Pill>;
  return <Pill tone="success">Vigente</Pill>;
}

export default function AccesosPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [voiding, setVoiding] = useState<AccessTicket | null>(null);
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);

  const reload = () => setReloadKey((k) => k + 1);

  const confirmVoid = async () => {
    if (!voiding) return;
    setWorking(true);
    const res = await api.post(`/api/tickets/${voiding._id}/void`, { reason });
    setWorking(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo anular el pase");
      return;
    }
    toast.success(`Pase ${voiding.code || voiding.wristband_code || ""} anulado`);
    setVoiding(null);
    setReason("");
    reload();
  };

  return (
    <>
      <ResourcePage
        key={reloadKey}
        resource="access_ticket"
        eyebrow="Parque"
        title="Accesos y pulseras"
        description="Pases emitidos con su vigencia, entradas restantes y redenciones. Cada validación en puerta descuenta de aquí."
        createLabel="Emitir pase"
        emptyIcon="Nfc"
        emptyTitle="Sin pases emitidos"
        emptyDescription="Los pases se emiten desde el punto de venta o manualmente para cortesías y staff."
        initialSort="-issued_at"
        extraActions={<TicketValidator onRedeemed={reload} />}
        filters={[
          { name: "status", label: "Estado", options: optionsFrom(TICKET_STATUS) },
          { name: "ticket_type", label: "Tipo", options: optionsFrom(TICKET_TYPE) },
        ]}
        renderSummary={(rows: AccessTicket[], total) => {
          const usable = rows.filter((t) => isUsable(t)).length;
          const expired = rows.filter((t) => !isClosed(t) && isExpired(t)).length;
          return (
            <p className="text-xs text-muted-foreground">
              {formatNumber(total)} pases · <span className="text-success">{formatNumber(usable)} vigentes</span>
              {expired > 0 && <> · <span className="text-danger">{formatNumber(expired)} vencidos sin cerrar</span></>}
              {" "}(en esta página)
            </p>
          );
        }}
        columns={[
          {
            key: "code", header: "Pase",
            render: (t: AccessTicket) => (
              <div>
                <p className="tf-num font-semibold">{t.code || t.wristband_code || "—"}</p>
                <p className="text-xs text-muted-foreground">
                  {t.holder_name || t.customer?.first_name
                    ? t.holder_name || `${t.customer?.first_name || ""} ${t.customer?.last_name || ""}`.trim()
                    : "Sin titular"}
                </p>
              </div>
            ),
          },
          { key: "type", header: "Tipo", render: (t: AccessTicket) => <StatusBadge value={t.ticket_type} dict={TICKET_TYPE} dot={false} /> },
          { key: "product", header: "Producto", hideOn: "md", render: (t: AccessTicket) => <span className="text-xs">{t.product?.name || "—"}</span> },
          {
            key: "uses", header: "Entradas", align: "right",
            render: (t: AccessTicket) => {
              const left = remainingEntries(t);
              return (
                <span className="tf-num">
                  {formatNumber(t.entries_used ?? 0)}
                  <span className="text-muted-foreground">/{t.entries_allowed ? formatNumber(t.entries_allowed) : "∞"}</span>
                  {left !== null && left > 0 && <span className="ml-1 text-xs text-muted-foreground">({left} libres)</span>}
                </span>
              );
            },
          },
          { key: "valid", header: "Vigencia", hideOn: "sm", render: (t: AccessTicket) => <span className="tf-num text-xs">{formatDateTime(t.valid_to)}</span> },
          { key: "real", header: "Estado real", hideOn: "md", render: (t: AccessTicket) => <ValidityPill t={t} /> },
          { key: "price", header: "Precio", align: "right", hideOn: "lg", render: (t: AccessTicket) => formatMoney(t.price, t.currency || "usd") },
          { key: "status", header: "Estado", render: (t: AccessTicket) => <StatusBadge value={t.status} dict={TICKET_STATUS} /> },
          {
            key: "actions", header: "", align: "right",
            render: (t: AccessTicket) => (
              <Button
                variant="ghost"
                size="sm"
                disabled={isClosed(t)}
                onClick={(e) => { e.stopPropagation(); setVoiding(t); }}
                title={isClosed(t) ? "Este pase ya está cerrado" : "Anular el pase"}
              >
                <Icon name="Ban" className="size-4" />
              </Button>
            ),
          },
        ]}
        // `status`, `entries_used` y `redeemed_at` no están aquí a propósito: son
        // estado de consumo y se mueven solo por las acciones de validación y
        // anulación, que dejan auditoría. Editarlos a mano permitía rearmar un
        // pase ya usado.
        fields={[
          { name: "code", label: "Código", required: true },
          { name: "ticket_type", label: "Tipo", type: "select", defaultValue: "day_pass", options: optionsFrom(TICKET_TYPE) },
          { name: "holder_name", label: "Titular" },
          { name: "customer", label: "Cliente", type: "reference", resource: "customer",
            optionLabel: (c: any) => `${c.first_name || ""} ${c.last_name || ""}`.trim() || c.email || c._id },
          { name: "product", label: "Producto", type: "reference", resource: "product" },
          { name: "booking", label: "Reserva", type: "reference", resource: "booking", optionLabel: (b: any) => b.booking_number || b._id },
          { name: "valid_from", label: "Válido desde", type: "datetime" },
          { name: "valid_to", label: "Válido hasta", type: "datetime" },
          { name: "entries_allowed", label: "Entradas permitidas", type: "number", help: "Vacío = ilimitadas." },
          { name: "wristband_code", label: "Código de pulsera" },
          { name: "price", label: "Precio", type: "number" },
          { name: "currency", label: "Moneda", type: "select", options: CURRENCY_OPTIONS },
          { name: "notes", label: "Notas", type: "textarea", span: 2 },
        ]}
      />

      <Dialog open={Boolean(voiding)} onOpenChange={(o) => { if (!o) { setVoiding(null); setReason(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Anular pase {voiding?.code || voiding?.wristband_code}</DialogTitle>
            <DialogDescription>
              El pase deja de ser válido en puerta. Queda registrado quién lo anuló y por qué.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="void-reason">Motivo</Label>
            <Input
              id="void-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej.: emitido por error / pulsera perdida"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setVoiding(null); setReason(""); }}>Cancelar</Button>
            <Button variant="destructive" onClick={confirmVoid} disabled={working || !reason.trim()}>
              {working ? "Anulando…" : "Anular pase"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
