"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { EmptyState } from "@/components/tf/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney, formatDateTime } from "@/lib/format";
import { SinFicha } from "../_components/sin-ficha";

interface Moneda {
  currency: string;
  opening: number;
  cash_sales: number;
  cash_refunds: number;
  retained: number;
  expenses: number;
  withdrawals: number;
  deposits: number;
  card: number;
  transfer: number;
  other_methods: number;
  expected: number;
  counted: number | null;
  difference: number | null;
}

interface Turno {
  session: { _id: string; code?: string; status?: string; opened_at?: string; seller?: unknown };
  currencies: Moneda[];
}

interface Sesion { _id: string; code?: string; status?: string; seller?: { _id?: string } | string | null }

/**
 * MI TURNO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL VENDEDOR NO PODÍA TENER CAJA
 *
 * Las rutas de caja pedían rango `cashier`, y un `seller` está por debajo. Así
 * que el promotor de playa —la persona entera para la que existe el modo
 * «retiene su comisión»— no podía abrir un turno; y sin turno no hay dónde
 * apuntar lo que se queda ni con qué cuadrar al final del día. Se llevaba en
 * una libreta, como el cupo antes de 6.4 y el saldo antes de 6.6.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y CUADRA POR MEDIO DE PAGO
 *
 * Que es el criterio del plan. Lo que entró en efectivo, lo que entró por
 * tarjeta y transferencia —que no está en su bolsillo—, lo que se quedó de
 * comisión, y lo que le toca entregar. La comisión retenida va en su propia
 * línea y no dentro de los retiros: sale del cajón igual, pero no es dinero que
 * él tenga que dar, y mezclarlas le pide que entregue de más.
 */
export default function MiTurnoPage() {
  const [sesionId, setSesionId] = useState<string | null>(null);
  const [turno, setTurno] = useState<Turno | null>(null);
  const [cargando, setCargando] = useState(true);
  const [sinFicha, setSinFicha] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    const abiertas = await api.get<Sesion[]>("/api/cash/sessions?status=open");
    if (!abiertas.ok) {
      setCargando(false);
      // 403 sin ficha de vendedor: no es un error que haya que gritar.
      if (abiertas.error?.status === 403) { setSinFicha(true); return; }
      toast.error(abiertas.error?.message || "No se pudo cargar tu turno");
      return;
    }
    /**
     * La ruta ya devuelve solo lo que este usuario puede ver, así que aquí NO
     * se vuelve a filtrar por vendedor: un segundo filtro en el navegador es
     * una segunda definición de «lo mío», y la que se quede corta decide.
     */
    const mia = (abiertas.data ?? [])[0];
    if (!mia) { setCargando(false); setSesionId(null); setTurno(null); return; }

    setSesionId(mia._id);
    const arqueo = await api.get<Turno>(`/api/cash/sessions/${mia._id}/arqueo`);
    setCargando(false);
    if (!arqueo.ok) {
      toast.error(arqueo.error?.message || "No se pudo cargar el arqueo");
      return;
    }
    setTurno(arqueo.data ?? null);
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  if (sinFicha) return <SinFicha />;
  if (cargando) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    );
  }

  if (!sesionId || !turno) {
    return (
      <div className="space-y-6">
        <PageHeader title="Mi turno" description="Lo que llevas cobrado hoy y lo que te toca entregar." />
        <EmptyState
          icon="Wallet"
          title="No tienes un turno abierto"
          description="Cuando tu operador te abra una caja a tu nombre, verás aquí lo que llevas cobrado, lo que te quedas de comisión y lo que tienes que entregar."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mi turno"
        description={`Abierto ${turno.session.opened_at ? formatDateTime(turno.session.opened_at) : ""}`.trim()}
      />

      {turno.currencies.map((m) => {
        /**
         * Lo que entrega es lo ESPERADO, que ya lleva restada su comisión.
         * Recalcularlo aquí sería una segunda cuenta del mismo dinero, y la que
         * se equivoque decide lo que el vendedor pone sobre la mesa.
         */
        const entregar = m.expected;
        return (
          <Card key={m.currency}>
            <CardHeader><CardTitle>{m.currency.toUpperCase()}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <KpiCard label="Cobrado en efectivo" value={formatMoney(m.cash_sales, m.currency)} icon="Banknote" />
                <KpiCard label="Te quedas de comisión" value={formatMoney(m.retained, m.currency)} icon="BadgeDollarSign" />
                <KpiCard label="Tienes que entregar" value={formatMoney(entregar, m.currency)} icon="HandCoins" />
              </div>

              <div className="space-y-1 text-sm">
                <div className="font-medium">Por medio de pago</div>
                <ul className="space-y-0.5 text-muted-foreground tabular-nums">
                  <li>Efectivo · {formatMoney(m.cash_sales, m.currency)}</li>
                  {/**
                    * Tarjeta y transferencia se enseñan aunque no estén en su
                    * bolsillo: el vendedor tiene que poder cuadrar lo que vendió
                    * con lo que entrega, y sin estas dos líneas la resta no le
                    * sale y cree que le falta dinero.
                    */}
                  <li>Tarjeta · {formatMoney(m.card, m.currency)} <span className="text-xs">(no lo entregas)</span></li>
                  <li>Transferencia · {formatMoney(m.transfer, m.currency)} <span className="text-xs">(no lo entregas)</span></li>
                  {m.other_methods ? <li>Otros · {formatMoney(m.other_methods, m.currency)}</li> : null}
                  {m.opening ? <li>Fondo de apertura · {formatMoney(m.opening, m.currency)}</li> : null}
                  {m.cash_refunds ? <li>Devoluciones en efectivo · −{formatMoney(m.cash_refunds, m.currency)}</li> : null}
                  {m.retained ? <li>Comisión retenida · −{formatMoney(m.retained, m.currency)}</li> : null}
                  {m.withdrawals ? <li>Retiros · −{formatMoney(m.withdrawals, m.currency)}</li> : null}
                  {m.expenses ? <li>Gastos · −{formatMoney(m.expenses, m.currency)}</li> : null}
                </ul>
              </div>
            </CardContent>
          </Card>
        );
      })}

      <p className="text-xs text-muted-foreground">
        El conteo y el cierre los hace quien recibe el dinero, en «Caja y turnos». Aquí solo ves lo
        tuyo, para que sepas qué entregar antes de llegar.
      </p>
    </div>
  );
}
