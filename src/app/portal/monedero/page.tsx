"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { usePortal } from "../portal-context";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { DataTable } from "@/components/tf/data-table";
import { EmptyState } from "@/components/tf/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney, formatDateTime } from "@/lib/format";
import { SIGNO_DEL_MOVIMIENTO, type TipoDeMovimiento } from "@/lib/monedero-socio";

interface Movimiento {
  _id: string;
  movement_type?: string | null;
  amount?: number | null;
  currency?: string | null;
  reference?: string | null;
  note?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
}

interface Respuesta {
  partner_id: string;
  currency: string;
  prepaid: boolean;
  balance: number;
  movements: Movimiento[];
}

const ETIQUETA: Record<TipoDeMovimiento, { texto: string; tono: string }> = {
  topup: { texto: "Recarga", tono: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  consumption: { texto: "Venta", tono: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  refund: { texto: "Devolución", tono: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  adjustment: { texto: "Ajuste", tono: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
};

const fecha = (m: Movimiento) => m.created_at || m.createdAt || null;

/**
 * MI SALDO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AQUÍ NO SE RECARGA, Y NO ES UN OLVIDO
 *
 * Quien apunta una recarga es quien VE la transferencia en el banco, y eso es
 * la operadora. Si el tour center pudiera escribir en su propio monedero, el
 * saldo dejaría de significar «dinero ingresado» para significar «lo que el
 * socio dice que ingresó» — y con eso vendería sin haber pagado. La ruta del
 * portal solo lee.
 *
 * Lo que sí hace esta pantalla es que el socio no tenga que llamar para saber
 * si su transferencia llegó y cuánto le queda, que es lo que hacía hasta ahora
 * con una libreta al lado del teléfono.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y EL SALDO NO SE GUARDA EN NINGÚN SITIO
 *
 * Es la suma de la lista de abajo. Por eso la lista está en la misma pantalla:
 * un saldo que no se puede cuadrar contra sus movimientos es un número que hay
 * que creerse.
 */
export default function PortalMonederoPage() {
  const { isStaff, partnerId } = usePortal();
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    const params = new URLSearchParams();
    if (isStaff && partnerId) params.set("partner_id", partnerId);
    const res = await api.get<Respuesta>(`/api/portal/monedero${params.toString() ? `?${params}` : ""}`);
    setCargando(false);
    if (!res.ok) {
      console.error("[portal/monedero] no se pudo cargar el saldo:", res.error);
      toast.error(res.error?.message || "No se pudo cargar tu saldo");
      setDatos(null);
      return;
    }
    setDatos(res.data ?? null);
  }, [isStaff, partnerId]);

  useEffect(() => { void cargar(); }, [cargar]);

  const moneda = datos?.currency || "usd";
  const movimientos = datos?.movements ?? [];
  const recargado = movimientos
    .filter((m) => m.movement_type === "topup")
    .reduce((a, m) => a + Math.abs(Number(m.amount ?? 0)), 0);
  const gastado = movimientos
    .filter((m) => m.movement_type === "consumption")
    .reduce((a, m) => a + Math.abs(Number(m.amount ?? 0)), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mi saldo"
        description="Lo que has ingresado, lo que has gastado y lo que te queda para vender."
      />

      {!cargando && datos && !datos.prepaid ? (
        <Card>
          <CardHeader><CardTitle>Trabajas a crédito, no con saldo</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Tu contrato es a crédito: vendes ahora y se te factura después, con el límite que tengas
            pactado. No necesitas ingresar por adelantado. Si quieres pasar a saldo prepago, háblalo
            con tu comercial.
            {movimientos.length > 0 && (
              <p className="mt-2">
                Abajo quedan los movimientos de cuando sí trabajabas con saldo; no se usan para vender.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <KpiCard label="Saldo disponible" value={formatMoney(datos?.balance ?? 0, moneda)} icon="Wallet" />
          <KpiCard label="Ingresado" value={formatMoney(recargado, moneda)} icon="ArrowDownToLine" />
          <KpiCard label="Gastado en ventas" value={formatMoney(gastado, moneda)} icon="ShoppingCart" />
        </div>
      )}

      {!cargando && movimientos.length === 0 ? (
        <EmptyState
          icon="Wallet"
          title="Todavía no hay movimientos"
          description="Cuando tu operador registre tu primera transferencia, la verás aquí con su referencia y tu saldo actualizado."
        />
      ) : (
        <DataTable
          loading={cargando}
          rows={movimientos}
          columns={[
            { key: "created_at", header: "Fecha", render: (m: Movimiento) => {
              const f = fecha(m);
              return f ? formatDateTime(f) : "—";
            } },
            { key: "movement_type", header: "Concepto", render: (m: Movimiento) => {
              const tipo = ETIQUETA[(m.movement_type ?? "") as TipoDeMovimiento];
              return (
                <div className="space-y-0.5">
                  <Badge variant="outline" className={tipo?.tono}>{tipo?.texto || m.movement_type || "—"}</Badge>
                  {m.note && <div className="text-xs text-muted-foreground">{m.note}</div>}
                </div>
              );
            } },
            { key: "reference", header: "Referencia", render: (m: Movimiento) => (
              m.reference || <span className="text-muted-foreground">—</span>
            ) },
            /**
             * El signo lo pone el TIPO, igual que en el saldo. La columna
             * `amount` siempre es positiva —la base tiene un `check`—, así que
             * pintarla tal cual haría que una venta pareciera un ingreso.
             */
            { key: "amount", header: "Importe", align: "right", render: (m: Movimiento) => {
              const signo = SIGNO_DEL_MOVIMIENTO[(m.movement_type ?? "") as TipoDeMovimiento] ?? 0;
              const valor = signo * Math.abs(Number(m.amount ?? 0));
              return (
                <span className={valor < 0 ? "text-muted-foreground" : "text-emerald-600 dark:text-emerald-400"}>
                  {valor > 0 ? "+" : ""}{formatMoney(valor, m.currency || moneda)}
                </span>
              );
            } },
          ]}
        />
      )}
    </div>
  );
}
