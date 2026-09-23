"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { DataTable } from "@/components/tf/data-table";
import { EmptyState } from "@/components/tf/empty-state";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatMoney, formatDateTime } from "@/lib/format";
import { SIGNO_DEL_MOVIMIENTO, type TipoDeMovimiento } from "@/lib/monedero-socio";

interface Socio { _id: string; name?: string; commercial_name?: string; currency?: string; payment_mode?: string }
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

const ETIQUETA: Record<TipoDeMovimiento, { texto: string; tono: string }> = {
  topup: { texto: "Recarga", tono: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  consumption: { texto: "Venta", tono: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  refund: { texto: "Devolución", tono: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  adjustment: { texto: "Ajuste", tono: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
};

/** Lo que se puede apuntar a mano. El consumo lo escribe la venta. */
const A_MANO = [
  { value: "topup", label: "Recarga (el socio transfirió)" },
  { value: "refund", label: "Devolución" },
  { value: "adjustment", label: "Ajuste (resta)" },
] as const;

/**
 * EL SALDO PREPAGO DE CADA TOUR CENTER.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTA PANTALLA ES LA QUE TIENE QUE EXISTIR, Y LA DEL SOCIO NO
 *
 * Quien apunta una recarga es quien VE la transferencia en el banco, y eso es
 * la operadora. Si el tour center pudiera escribir en su propio monedero, el
 * saldo dejaría de significar «dinero ingresado» para significar «lo que el
 * socio dice que ingresó», y con eso vendería sin haber pagado. El portal solo
 * lee.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL CONSUMO NO SE APUNTA AQUÍ
 *
 * Lo escribe la venta, con su orden colgada y bajo un índice único que impide
 * descontar dos veces la misma. Dejarlo entrar a mano crearía consumos sin
 * venta detrás — el saldo bajaría y no habría nada que enseñarle al socio
 * cuando pregunte por qué.
 *
 * Y el ajuste SIEMPRE resta, por eso no hay signo que elegir: un ajuste que
 * suma es una recarga, y tiene que entrar por la puerta de las recargas, donde
 * queda el número de la transferencia.
 */
export default function PartnerWalletPage() {
  const [socios, setSocios] = useState<Socio[]>([]);
  const [socioId, setSocioId] = useState("");
  const [balance, setBalance] = useState(0);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const [tipo, setTipo] = useState<string>("topup");
  const [importe, setImporte] = useState("");
  const [referencia, setReferencia] = useState("");
  const [nota, setNota] = useState("");

  useEffect(() => {
    void (async () => {
      const res = await api.get<Socio[]>("/api/erp/partner?limit=200&filter.status=active&sort=name");
      if (res.ok) setSocios(res.data ?? []);
    })();
  }, []);

  const cargar = useCallback(async () => {
    if (!socioId) { setMovimientos([]); setBalance(0); return; }
    setCargando(true);
    const res = await api.get<{ balance: number; movements: Movimiento[] }>(
      `/api/partners/wallet?partner_id=${encodeURIComponent(socioId)}`
    );
    setCargando(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo cargar el saldo");
      return;
    }
    setBalance(res.data?.balance ?? 0);
    setMovimientos(res.data?.movements ?? []);
  }, [socioId]);

  useEffect(() => { void cargar(); }, [cargar]);

  const socio = socios.find((s) => s._id === socioId);
  const moneda = socio?.currency || "usd";

  const apuntar = async () => {
    const monto = Number(importe);
    if (!(monto > 0)) {
      toast.error("El importe tiene que ser mayor que cero");
      return;
    }
    setGuardando(true);
    const res = await api.post<{ balance: number }>("/api/partners/wallet", {
      partner_id: socioId, movement_type: tipo, amount: monto,
      reference: referencia, note: nota,
    });
    setGuardando(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo apuntar el movimiento");
      return;
    }
    toast.success(`Saldo actualizado: ${formatMoney(res.data?.balance ?? 0, moneda)}`);
    setImporte(""); setReferencia(""); setNota("");
    void cargar();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Saldo de partners"
        description="Lo que cada tour center ingresó por adelantado y en qué se ha ido gastando."
        actions={
          <Select value={socioId} onValueChange={setSocioId}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Elige un tour center" /></SelectTrigger>
            <SelectContent>
              {socios.map((s) => (
                <SelectItem key={s._id} value={s._id}>{s.commercial_name || s.name || s._id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {!socioId ? (
        <EmptyState
          icon="Wallet"
          title="Elige un tour center"
          description="Verás su saldo, sus movimientos y podrás apuntarle una recarga."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <KpiCard label="Saldo disponible" value={formatMoney(balance, moneda)} icon="Wallet" />
            <KpiCard
              label="Forma de pago"
              value={socio?.payment_mode === "prepaid" ? "Prepago" : "A crédito"}
              icon="Handshake"
            />
          </div>

          {socio?.payment_mode !== "prepaid" && (
            <Card>
              <CardHeader><CardTitle>Este socio trabaja a crédito</CardTitle></CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Su saldo no se mira al vender: se le comprueba el límite de crédito. Puedes apuntarle
                movimientos igualmente, pero para que el saldo decida sus ventas hay que cambiarle la
                forma de pago a «prepago» en su ficha.
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Apuntar un movimiento</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="tipo">Concepto</Label>
                <Select value={tipo} onValueChange={setTipo}>
                  <SelectTrigger id="tipo"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {A_MANO.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="importe">Importe ({moneda.toUpperCase()})</Label>
                {/* En positivo siempre: el signo lo pone el concepto. */}
                <Input id="importe" type="number" min={0} step="0.01" value={importe}
                  onChange={(e) => setImporte(e.target.value)} placeholder="0.00" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="referencia">Referencia</Label>
                <Input id="referencia" value={referencia} onChange={(e) => setReferencia(e.target.value)}
                  placeholder="Nº de transferencia" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nota">Nota</Label>
                <Textarea id="nota" rows={1} value={nota} onChange={(e) => setNota(e.target.value)} />
              </div>
              <div className="sm:col-span-4">
                <Button onClick={() => void apuntar()} disabled={guardando || !importe}>
                  Apuntar movimiento
                </Button>
              </div>
            </CardContent>
          </Card>

          <DataTable
            loading={cargando}
            rows={movimientos}
            columns={[
              { key: "created_at", header: "Fecha", render: (m: Movimiento) => {
                const f = m.created_at || m.createdAt;
                return f ? formatDateTime(f) : "—";
              } },
              { key: "movement_type", header: "Concepto", render: (m: Movimiento) => {
                const t = ETIQUETA[(m.movement_type ?? "") as TipoDeMovimiento];
                return (
                  <div className="space-y-0.5">
                    <Badge variant="outline" className={t?.tono}>{t?.texto || m.movement_type || "—"}</Badge>
                    {m.note && <div className="text-xs text-muted-foreground">{m.note}</div>}
                  </div>
                );
              } },
              { key: "reference", header: "Referencia", render: (m: Movimiento) => (
                m.reference || <span className="text-muted-foreground">—</span>
              ) },
              { key: "amount", header: "Importe", align: "right", render: (m: Movimiento) => {
                // El signo lo pone el tipo: la columna siempre es positiva.
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
        </>
      )}
    </div>
  );
}
