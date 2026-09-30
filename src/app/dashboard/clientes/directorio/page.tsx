"use client";

import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CUSTOMER_STATUS } from "@/lib/labels";
import { optionsFrom, CURRENCY_OPTIONS, LANGUAGE_OPTIONS } from "@/components/tf/options";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import {
  estaVetado, mensajeInterno, motivoValido, MOTIVO_MINIMO, MENSAJE_SIN_MOTIVO, VETADO,
} from "@/lib/lista-negra";

/**
 * EL DIRECTORIO, CON LA PUERTA DE LA LISTA NEGRA.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LO QUE FALTABA, Y ERA SOLO ESTO
 *
 * `PUT /api/customers/:id/lista-negra` estaba entera —motivo obligatorio, rango
 * de gerencia, el estado y el motivo escritos juntos, auditoría con severidad de
 * aviso, y se niega a bloquear al que ya está bloqueado— y **no la llamaba
 * nadie**. El resto del ciclo sí estaba enchufado: `booking-service` rechaza la
 * venta, la web y la API del socio traducen el rechazo sin decir la palabra, y el
 * CRUD genérico ya rechazaba el cambio de estado por `puertaEquivocada`.
 *
 * O sea que este módulo estaba a un botón de funcionar, y sin ese botón la lista
 * negra era exactamente lo que su propio comentario avisa: **una casilla que no
 * hace nada, y de esas la peor es la que deja a quien la marca convencido de que
 * hizo algo**.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TRES DECISIONES DE PANTALLA
 *
 * 1. **El desplegable ya no ofrece «Lista negra».** Lo ofrecía, y al guardar
 *    saltaba `puertaEquivocada` con su mensaje. La guarda estaba bien; lo que
 *    estaba mal era invitar a un callejón. Ahora el formulario tiene los dos
 *    estados que sí edita y el veto tiene su botón.
 *
 * 2. **El motivo se enseña en la fila.** No es adorno: el caso real es el cliente
 *    en el mostrador y el cajero decidiendo en treinta segundos. Un «bloqueado»
 *    sin motivo se levanta —y entonces no valía nada— o se sostiene a ciegas.
 *
 * 3. **El mínimo del motivo sale del módulo**, no de un número tecleado aquí. Con
 *    dos definiciones, la pantalla deja pasar lo que el servidor rechaza y quien
 *    lo escribe no entiende por qué.
 */

interface Cliente {
  _id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  status?: string;
  blocked_reason?: string;
  blocked_at?: string;
  country?: string;
  nationality?: string;
  room?: string;
  hotel?: { name?: string } | string;
  bookings_count?: number;
  total_spent?: number;
  createdAt?: string;
}

const fullName = (c: Cliente) => [c.first_name, c.last_name].filter(Boolean).join(" ") || "Sin nombre";

/**
 * Los estados que se editan por formulario: todos menos el veto.
 *
 * Derivado del diccionario, no escrito a mano: si mañana se añade un estado, sale
 * aquí sin que nadie tenga que acordarse.
 */
const ESTADOS_EDITABLES = optionsFrom(CUSTOMER_STATUS).filter((o) => o.value !== VETADO);

export default function CustomersPage() {
  const [version, setVersion] = useState(0);
  const [objetivo, setObjetivo] = useState<Cliente | null>(null);
  const [motivo, setMotivo] = useState("");
  const [trabajando, setTrabajando] = useState(false);

  const bloqueado = objetivo ? estaVetado(objetivo) : false;
  // Levantar no pide motivo; bloquear sí, y con el mismo mínimo que el servidor.
  const puedeEnviar = bloqueado ? true : motivoValido(motivo);

  const cerrar = () => { setObjetivo(null); setMotivo(""); };

  const aplicar = async () => {
    if (!objetivo) return;
    setTrabajando(true);
    const res = await api.put<{ blocked: boolean }>(`/api/customers/${objetivo._id}/lista-negra`, {
      blocked: !bloqueado,
      reason: motivo.trim() || undefined,
    });
    setTrabajando(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo cambiar la lista negra");
      return;
    }
    toast.success(bloqueado
      ? `${fullName(objetivo)} salió de la lista negra`
      : `${fullName(objetivo)} entró en la lista negra`);
    cerrar();
    setVersion((v) => v + 1);
  };

  return (
    <>
      <ResourcePage
        key={version}
        resource="customer"
        eyebrow="Comercial"
        title="Clientes"
        description="El comprador y los participantes son entidades distintas: un cliente puede comprar entradas para otras personas. La lista negra bloquea VENDERLE de nuevo; no toca lo que ya tiene reservado."
        createLabel="Nuevo cliente"
        searchPlaceholder="Buscar por nombre, email, teléfono o documento…"
        emptyIcon="Users"
        emptyTitle="Todavía no hay clientes"
        emptyDescription="Los clientes se crean automáticamente al registrar una venta, o puedes darlos de alta aquí."
        // Para ver la lista negra entera, que es la pregunta que se hace un gerente.
        filters={[{ name: "status", label: "Estado", options: optionsFrom(CUSTOMER_STATUS) }]}
        rowActions={(c: Cliente) =>
          estaVetado(c) ? (
            <Button variant="ghost" size="sm" onClick={() => { setObjetivo(c); setMotivo(""); }}>
              <Icon name="CircleCheck" className="size-3.5" /> Levantar
            </Button>
          ) : (
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive"
              onClick={() => { setObjetivo(c); setMotivo(""); }}>
              <Icon name="Ban" className="size-3.5" /> Bloquear
            </Button>
          )
        }
        columns={[
          {
            key: "name", header: "Cliente",
            render: (c: Cliente) => (
              <div>
                <p className="font-semibold">{fullName(c)}</p>
                <p className="text-xs text-muted-foreground">{c.email || c.phone || "Sin contacto"}</p>
              </div>
            ),
          },
          { key: "country", header: "País", hideOn: "md",
            render: (c: Cliente) => c.country || c.nationality || "—" },
          {
            key: "hotel", header: "Hotel", hideOn: "lg",
            render: (c: Cliente) => (typeof c.hotel === "object" && c.hotel
              ? `${c.hotel.name}${c.room ? ` · hab. ${c.room}` : ""}` : "—"),
          },
          { key: "bookings", header: "Reservas", align: "right", hideOn: "sm",
            render: (c: Cliente) => c.bookings_count ?? 0 },
          { key: "spent", header: "Facturado", align: "right",
            render: (c: Cliente) => formatMoney(c.total_spent ?? 0, "usd") },
          { key: "created", header: "Alta", align: "right", hideOn: "lg",
            render: (c: Cliente) => formatDate(c.createdAt) },
          {
            key: "status", header: "Estado",
            /**
             * El motivo, debajo de la insignia. Es el dato con el que se decide en
             * el mostrador, y tenerlo que ir a buscar a otra pantalla equivale a
             * no tenerlo.
             */
            render: (c: Cliente) => (
              <div className="space-y-1">
                <StatusBadge value={c.status} dict={CUSTOMER_STATUS} />
                {estaVetado(c) && (
                  <p className="max-w-[22ch] text-xs text-destructive" title={c.blocked_reason || undefined}>
                    {c.blocked_reason || "sin motivo registrado"}
                  </p>
                )}
              </div>
            ),
          },
        ]}
        fields={[
          { name: "first_name", label: "Nombre", required: true },
          { name: "last_name", label: "Apellidos" },
          { name: "email", label: "Email", type: "email" },
          { name: "phone", label: "Teléfono" },
          { name: "whatsapp", label: "WhatsApp" },
          { name: "document_id", label: "Documento / pasaporte" },
          { name: "country", label: "País" },
          { name: "nationality", label: "Nacionalidad" },
          { name: "language", label: "Idioma", type: "select", options: LANGUAGE_OPTIONS },
          { name: "birth_date", label: "Fecha de nacimiento", type: "date" },
          { name: "hotel", label: "Hotel", type: "reference", resource: "hotel" },
          { name: "room", label: "Habitación" },
          { name: "assigned_seller", label: "Vendedor asignado", type: "reference", resource: "seller",
            optionLabel: (s: any) => [s.first_name, s.last_name].filter(Boolean).join(" ") },
          { name: "source", label: "Origen", type: "select", options: [
            { value: "web", label: "Web" }, { value: "walk_in", label: "Walk-in" },
            { value: "referral", label: "Referido" }, { value: "whatsapp", label: "WhatsApp" },
            { value: "agency", label: "Agencia" }, { value: "ota", label: "OTA" },
          ] },
          // Sin «Lista negra»: eso tiene su botón, que pide el motivo y deja
          // constancia de quién fue. Ofrecerlo aquí era un callejón — el CRUD lo
          // rechaza con `puertaEquivocada`.
          { name: "status", label: "Estado", type: "select", defaultValue: "active", options: ESTADOS_EDITABLES,
            help: "Para la lista negra, usa el botón de bloquear de la fila." },
          { name: "address", label: "Dirección", span: 2 },
          { name: "preferences", label: "Preferencias", type: "textarea", span: 2 },
          { name: "notes", label: "Notas internas", type: "textarea", span: 2 },
        ]}
      />

      <Dialog open={Boolean(objetivo)} onOpenChange={(o) => { if (!o) cerrar(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {bloqueado ? "Levantar el bloqueo" : "Bloquear"} · {objetivo ? fullName(objetivo) : ""}
            </DialogTitle>
            <DialogDescription>
              {bloqueado
                ? "Vuelve a poder comprar. El episodio queda en la bitácora con los dos motivos."
                : "Bloquea VENDERLE de nuevo. No toca lo que ya tiene: sus reservas siguen en pie, se le cobra lo que debe y viaja si ya pagó."}
            </DialogDescription>
          </DialogHeader>

          {/* Al levantar, lo primero es POR QUÉ estaba bloqueado. */}
          {bloqueado && objetivo && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p className="flex items-start gap-2">
                <Icon name="Ban" className="mt-0.5 size-4 shrink-0 text-destructive" />
                <span>{mensajeInterno(objetivo)}</span>
              </p>
              {objetivo.blocked_at && (
                <p className="mt-1 tf-num text-xs text-muted-foreground">
                  Desde {formatDateTime(objetivo.blocked_at)}
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="ln-motivo">
              {bloqueado ? "Motivo de levantarlo (opcional)" : "Motivo (obligatorio)"}
            </Label>
            <Textarea id="ln-motivo" rows={3} value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={bloqueado
                ? "Ej.: acuerdo alcanzado, pagó lo pendiente"
                : "Ej.: no se presentó tres veces con plaza pagada por la operadora"} />
            {!bloqueado && !motivoValido(motivo) && (
              <p className="text-xs text-muted-foreground">
                {MENSAJE_SIN_MOTIVO} ({motivo.trim().length}/{MOTIVO_MINIMO})
              </p>
            )}
          </div>

          {!bloqueado && (
            <p className="text-xs text-muted-foreground">
              Queda en auditoría con tu nombre y la hora. Al levantarlo, el motivo se borra de la
              ficha —una ficha activa con un texto de bloqueo no se entiende— y el episodio se
              reconstruye desde la bitácora.
            </p>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={cerrar}>Cancelar</Button>
            <Button variant={bloqueado ? "default" : "destructive"}
              onClick={aplicar} disabled={!puedeEnviar || trabajando}>
              {trabajando
                ? (bloqueado ? "Levantando…" : "Bloqueando…")
                : (bloqueado ? "Levantar el bloqueo" : "Bloquear")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
