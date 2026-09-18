"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/tf/icon";
import { PageHeader } from "@/components/tf/page-header";
import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge } from "@/components/tf/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GENERIC_STATUS } from "@/lib/labels";
import { formatDateTime, formatNumber } from "@/lib/format";
import { optionsFrom } from "@/components/tf/options";

const ROUTE_STATUS = ["planned", "confirmed", "in_progress", "completed", "cancelled"];
const PICKUP_STATUS = ["pending", "confirmed", "picked_up", "no_show", "cancelled"];

export default function PickupsPage() {
  const [tab, setTab] = useState("routes");

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Operación"
        title="Recogidas y hoteles"
        description="Las rutas agrupan las recogidas por zona: cada parada conoce su hotel, su habitación, su hora y sus pasajeros."
        actions={
          // Armar se hace por salida, y es en el despacho donde se ve cuáles hay.
          <Link href="/dashboard/operaciones/despacho">
            <Button variant="outline" className="gap-1.5">
              <Icon name="Route" className="size-4" /> Armar las rutas del día
            </Button>
          </Link>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="routes">Rutas</TabsTrigger>
          <TabsTrigger value="stops">Recogidas</TabsTrigger>
          <TabsTrigger value="hotels">Hoteles</TabsTrigger>
          <TabsTrigger value="zones">Zonas</TabsTrigger>
        </TabsList>

        <TabsContent value="routes" className="mt-5">
          <ResourcePage
            embedded
            resource="pickup_route"
            title="Rutas de pickup"
            description="Una ruta por zona y salida, con su vehículo, conductor y guía asignados."
            createLabel="Nueva ruta"
            searchPlaceholder="Buscar por nombre de ruta…"
            emptyIcon="MapPin"
            emptyTitle="Todavía no hay rutas de pickup"
            emptyDescription="Crea una ruta por zona para organizar las recogidas de cada salida."
            filters={[{ name: "status", label: "Estado", options: optionsFrom(GENERIC_STATUS, ROUTE_STATUS) }]}
            columns={[
              {
                key: "name", header: "Ruta",
                render: (r: any) => (
                  <div>
                    <p className="font-semibold">{r.name || "Ruta sin nombre"}</p>
                    <p className="text-xs text-muted-foreground">
                      {typeof r.zone === "object" && r.zone ? r.zone.name : "Sin zona"}
                      {r.start_time ? ` · salida ${r.start_time}` : ""}
                    </p>
                  </div>
                ),
              },
              {
                key: "departure", header: "Salida", hideOn: "md",
                render: (r: any) => {
                  const d = r.departure;
                  if (!d || typeof d !== "object") return "—";
                  const product = typeof d.product === "object" ? d.product?.name : "Salida";
                  return (
                    <div className="text-xs">
                      <p className="font-medium">{product}</p>
                      <p className="text-muted-foreground">{formatDateTime(d.departure_at)}</p>
                    </div>
                  );
                },
              },
              { key: "vehicle", header: "Vehículo", hideOn: "lg",
                render: (r: any) => (typeof r.vehicle === "object" && r.vehicle ? `${r.vehicle.name}${r.vehicle.plate ? ` · ${r.vehicle.plate}` : ""}` : "Sin asignar") },
              { key: "driver", header: "Conductor", hideOn: "lg",
                render: (r: any) => (typeof r.driver === "object" && r.driver ? r.driver.full_name : "—") },
              { key: "guide", header: "Guía", hideOn: "lg",
                render: (r: any) => (typeof r.guide === "object" && r.guide ? r.guide.full_name : "—") },
              { key: "stops", header: "Paradas", align: "right", hideOn: "sm", render: (r: any) => formatNumber(r.stops_count ?? 0) },
              { key: "pax", header: "Pax", align: "right", render: (r: any) => <span className="font-semibold">{formatNumber(r.pax_total ?? 0)}</span> },
              { key: "status", header: "Estado", render: (r: any) => <StatusBadge value={r.status} dict={GENERIC_STATUS} /> },
              {
                key: "hoja", header: "", align: "right",
                render: (r: any) => (
                  <Link href={`/dashboard/operaciones/rutas/${r._id}/hoja`}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                    <Icon name="Printer" className="size-3.5" /> Hoja de ruta
                  </Link>
                ),
              },
            ]}
            fields={[
              { name: "name", label: "Nombre de la ruta", required: true, span: 2 },
              { name: "departure", label: "Salida", type: "reference", resource: "departure",
                optionLabel: (d: any) => `${typeof d.product === "object" ? d.product?.name : "Salida"} · ${formatDateTime(d.departure_at)}` },
              { name: "zone", label: "Zona", type: "reference", resource: "zone" },
              { name: "vehicle", label: "Vehículo", type: "reference", resource: "vehicle" },
              { name: "driver", label: "Conductor", type: "reference", resource: "staff", optionLabel: (s: any) => s.full_name },
              { name: "guide", label: "Guía", type: "reference", resource: "staff", optionLabel: (s: any) => s.full_name },
              { name: "start_time", label: "Hora de inicio", placeholder: "07:30" },
              // `stops_count` y `pax_total` ya no se teclean: son el resultado de
              // quién va en la ruta. Un número escrito a mano miente en cuanto se
              // añade una parada, y esa mentira acaba en la hoja del conductor.
              // Los recalcula «Armar rutas» en el despacho, también para las
              // rutas hechas a mano.
              { name: "status", label: "Estado", type: "select", defaultValue: "planned", options: optionsFrom(GENERIC_STATUS, ROUTE_STATUS) },
              { name: "notes", label: "Notas", type: "textarea", span: 2 },
            ]}
          />
        </TabsContent>

        <TabsContent value="stops" className="mt-5">
          <ResourcePage
            embedded
            resource="pickup"
            title="Recogidas"
            description="Cada recogida enlaza una reserva con su hotel, habitación y hora exacta."
            createLabel="Nueva recogida"
            searchPlaceholder="Buscar por ubicación o habitación…"
            emptyIcon="MapPin"
            emptyTitle="Todavía no hay recogidas"
            emptyDescription="Las recogidas se crean al vender con hotel de pickup, o puedes añadirlas manualmente."
            filters={[{ name: "status", label: "Estado", options: optionsFrom(GENERIC_STATUS, PICKUP_STATUS) }]}
            columns={[
              {
                key: "booking", header: "Reserva",
                render: (p: any) => {
                  const b = p.booking;
                  if (!b || typeof b !== "object") return "—";
                  const c = b.customer;
                  return (
                    <div>
                      <p className="font-semibold">{b.booking_number || "Reserva"}</p>
                      <p className="text-xs text-muted-foreground">
                        {c && typeof c === "object" ? [c.first_name, c.last_name].filter(Boolean).join(" ") : "Sin cliente"}
                      </p>
                    </div>
                  );
                },
              },
              { key: "hotel", header: "Hotel", render: (p: any) => (typeof p.hotel === "object" && p.hotel ? p.hotel.name : p.location || "—") },
              { key: "room", header: "Habitación", hideOn: "md", render: (p: any) => p.room || "—" },
              { key: "seq", header: "Parada", align: "right", hideOn: "lg",
                render: (p: any) => (p.sequence ? formatNumber(p.sequence) : "—") },
              {
                // Las dos horas juntas y con el desajuste dicho con palabras. Si
                // el motor pisara la prometida, un cliente con un voucher que
                // dice 07:15 pasaría a las 07:00 sin que nadie se enterara.
                key: "time", header: "Hora", hideOn: "sm",
                render: (p: any) => {
                  const prometida = p.pickup_time || null;
                  const calculada = p.planned_time || null;
                  if (!prometida && !calculada) return "—";
                  const difiere = prometida && calculada && prometida.slice(0, 5) !== calculada.slice(0, 5);
                  return (
                    <div className="text-xs">
                      <p className="font-mono font-semibold">{prometida || calculada}</p>
                      {difiere && (
                        <p className="text-destructive">Al transporte le toca {calculada}</p>
                      )}
                      {!prometida && calculada && <p className="text-muted-foreground">Calculada, sin confirmar</p>}
                    </div>
                  );
                },
              },
              { key: "pax", header: "Pax", align: "right", render: (p: any) => formatNumber(p.pax ?? 0) },
              { key: "status", header: "Estado", render: (p: any) => <StatusBadge value={p.status} dict={GENERIC_STATUS} /> },
            ]}
            fields={[
              { name: "booking", label: "Reserva", type: "reference", resource: "booking", optionLabel: (b: any) => b.booking_number || b._id, span: 2 },
              { name: "hotel", label: "Hotel", type: "reference", resource: "hotel" },
              { name: "route", label: "Ruta", type: "reference", resource: "pickup_route" },
              { name: "pickup_time", label: "Hora prometida al cliente", placeholder: "07:45",
                help: "La que va en su voucher. El motor calcula la suya aparte y nunca pisa esta." },
              { name: "sequence", label: "Parada nº", type: "number",
                help: "Para reordenar el recorrido a mano cuando el conductor sabe algo que el motor no." },
              { name: "room", label: "Habitación" },
              { name: "pax", label: "Pax", type: "number" },
              { name: "status", label: "Estado", type: "select", defaultValue: "pending", options: optionsFrom(GENERIC_STATUS, PICKUP_STATUS) },
              { name: "location", label: "Ubicación / referencia", span: 2 },
              { name: "notes", label: "Notas", type: "textarea", span: 2 },
            ]}
          />
        </TabsContent>

        <TabsContent value="hotels" className="mt-5">
          <ResourcePage
            embedded
            resource="hotel"
            title="Hoteles"
            description="El hotel determina la zona de recogida y, con ella, la hora de pickup del cliente."
            createLabel="Nuevo hotel"
            searchPlaceholder="Buscar hotel…"
            emptyIcon="Building2"
            emptyTitle="Todavía no hay hoteles"
            emptyDescription="Añade los hoteles donde se alojan tus clientes para automatizar las recogidas."
            columns={[
              {
                key: "name", header: "Hotel",
                render: (h: any) => (
                  <div>
                    <p className="font-semibold">{h.name}</p>
                    <p className="text-xs text-muted-foreground">{h.address || "Sin dirección"}</p>
                  </div>
                ),
              },
              { key: "zone", header: "Zona", render: (h: any) => (typeof h.zone === "object" && h.zone ? h.zone.name : "Sin zona") },
              { key: "pickup", header: "Punto de recogida", hideOn: "md", render: (h: any) => h.pickup_point || "—" },
              { key: "offset", header: "Margen", align: "right", hideOn: "lg",
                render: (h: any) => (h.pickup_offset_min != null ? `${h.pickup_offset_min} min` : "—") },
              { key: "phone", header: "Teléfono", hideOn: "lg", render: (h: any) => h.phone || "—" },
              { key: "status", header: "Estado", render: (h: any) => <StatusBadge value={h.status} dict={GENERIC_STATUS} /> },
            ]}
            fields={[
              { name: "name", label: "Nombre", required: true, span: 2 },
              { name: "zone", label: "Zona", type: "reference", resource: "zone" },
              { name: "pickup_point", label: "Punto de recogida", help: "Lobby, entrada principal, etc." },
              { name: "phone", label: "Teléfono" },
              { name: "category", label: "Categoría", placeholder: "5 estrellas" },
              // La otra pantalla del mismo campo (Administración → Hoteles) decía
              // «minutos antes de la salida a los que pasa el transporte», que es
              // lo que hace de verdad. Aquí decía otra cosa. Dos definiciones del
              // mismo dato garantizan que alguien lo cargue mal.
              { name: "pickup_offset_min", label: "Margen de recogida (min)", type: "number",
                help: "Minutos antes de la salida a los que pasa el transporte por este hotel. Si se deja vacío, se usa el de su zona." },
              { name: "latitude", label: "Latitud", type: "number" },
              { name: "longitude", label: "Longitud", type: "number" },
              { name: "address", label: "Dirección", span: 2 },
              { name: "status", label: "Estado", type: "select", defaultValue: "active", options: optionsFrom(GENERIC_STATUS, ["active", "inactive"]) },
              { name: "notes", label: "Notas", type: "textarea", span: 2 },
            ]}
          />
        </TabsContent>

        <TabsContent value="zones" className="mt-5">
          <ResourcePage
            embedded
            resource="zone"
            title="Zonas"
            description="Agrupan hoteles por área. Su margen de recogida es el que heredan los hoteles que no tienen el suyo, y de ahí sale la hora a la que pasa el transporte."
            createLabel="Nueva zona"
            searchPlaceholder="Buscar zona…"
            emptyIcon="Map"
            emptyTitle="Todavía no hay zonas"
            emptyDescription="Define las zonas turísticas donde operas para organizar las rutas."
            columns={[
              { key: "name", header: "Zona", render: (z: any) => <span className="font-semibold">{z.name}</span> },
              { key: "description", header: "Descripción", hideOn: "md",
                render: (z: any) => <span className="text-muted-foreground">{z.description || "—"}</span> },
              { key: "offset", header: "Margen", align: "right", hideOn: "sm",
                render: (z: any) => (z.pickup_offset_min != null ? `${z.pickup_offset_min} min` : "—") },
              { key: "color", header: "Color", align: "center", hideOn: "lg",
                render: (z: any) => (
                  <span className="inline-block size-4 rounded-full border border-border align-middle"
                    style={{ background: z.color || "var(--muted)" }} />
                ) },
              { key: "status", header: "Estado", render: (z: any) => <StatusBadge value={z.status} dict={GENERIC_STATUS} /> },
            ]}
            fields={[
              { name: "name", label: "Nombre", required: true, span: 2 },
              // Es lo que hace utilizable el margen del hotel: nadie carga
              // doscientos hoteles poniéndoselo uno por uno, y la zona ya los
              // agrupa por lo único de lo que el margen depende, que es dónde
              // están.
              { name: "pickup_offset_min", label: "Margen de recogida (min)", type: "number",
                help: "Minutos antes de la salida a los que pasa el transporte por esta zona. El hotel que tenga el suyo manda sobre este." },
              { name: "color", label: "Color", placeholder: "#0E7C86" },
              { name: "status", label: "Estado", type: "select", defaultValue: "active", options: optionsFrom(GENERIC_STATUS, ["active", "inactive"]) },
              { name: "description", label: "Descripción", type: "textarea", span: 2 },
            ]}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
