"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LEDGER_SOURCE } from "@/lib/labels-modules";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { optionsFrom } from "@/components/tf/options";

/**
 * LIBRO DIARIO, CON EL ASIENTO MANUAL Y LA REVERSA QUE PROMETÍA.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LO QUE PASABA ANTES
 *
 * Esta pantalla se describía a sí misma así: «un error no se borra: se corrige
 * con un asiento de reversa, así la historia se conserva». Y **no se podía
 * reversar nada**. `POST /api/ledger/post` acepta `reverseEntry` desde el primer
 * día, escribe el asiento espejo y marca el original — y no lo llamaba ni una
 * línea de la aplicación.
 *
 * Tampoco se podía registrar un asiento. `ledger_entry` tiene `writable: []` a
 * propósito (una línea inmutable no se teclea en un formulario genérico), así
 * que la ÚNICA vía para un ajuste era la ruta huérfana. En la práctica: un
 * ajuste contable había que meterlo por SQL. El texto de la pantalla prometía
 * algo que el producto no podía cumplir, que es peor que no prometerlo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DOS COSAS QUE ESTA PANTALLA NO HACE, A PROPÓSITO
 *
 * 1. **No edita ni borra.** La columna de acciones trae solo la reversa. Un
 *    libro del que se puede borrar una línea no es un libro.
 * 2. **No cuadra el asiento por su cuenta.** Si no cuadra, el botón no se
 *    habilita y se dice cuánto falta y de qué lado. Ajustar el descuadre
 *    automáticamente —metiéndolo en una cuenta de ajuste— es justo la
 *    «comodidad» que hace que nadie vuelva a mirar de dónde salía la diferencia.
 *
 * El servidor valida lo mismo por su cuenta: no cuadrar es un 400, y un mes
 * cerrado es un 409. Aquí se adelanta el aviso, no se sustituye.
 */

interface Linea {
  account: string;
  debit: string;
  credit: string;
  memo: string;
}

interface Cuenta {
  _id: string;
  code?: string;
  name?: string;
  is_postable?: boolean;
  status?: string;
}

interface Asiento {
  _id: string;
  entry_code?: string;
  line_no?: number;
  posted_at?: string;
  period?: string;
  ledger_account?: { code?: string; name?: string } | string;
  debit?: number;
  credit?: number;
  memo?: string;
  source_type?: string;
  reversed?: boolean;
  reversal_of?: string;
}

/**
 * Los orígenes que teclea una persona.
 *
 * `LedgerSource` tiene quince valores y doce los pone el sistema al vender,
 * cobrar o liquidar. Ofrecerlos todos aquí invita a teclear a mano un asiento de
 * «venta» que ninguna venta respalda, y entonces el libro deja de poder
 * contrastarse con la operación.
 */
const ORIGENES_MANUALES = ["adjustment", "opening", "tax"] as const;

/** El filtro sí ofrece los quince: por ahí se LEE, no se teclea. */
const ORIGENES_FILTRO = optionsFrom(LEDGER_SOURCE);

const LINEA_VACIA: Linea = { account: "", debit: "", credit: "", memo: "" };
const hoy = () => new Date().toISOString().slice(0, 10);
const num = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const centavos = (n: number) => Math.round(n * 100) / 100;

export default function DiarioPage() {
  const [version, setVersion] = useState(0);
  const [abierto, setAbierto] = useState(false);
  const [cuentas, setCuentas] = useState<Cuenta[] | null>(null);
  const [origen, setOrigen] = useState<string>("adjustment");
  const [fecha, setFecha] = useState(hoy());
  const [concepto, setConcepto] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([{ ...LINEA_VACIA }, { ...LINEA_VACIA }]);
  const [trabajando, setTrabajando] = useState(false);
  const [reversando, setReversando] = useState<Asiento | null>(null);

  const recargar = () => setVersion((v) => v + 1);

  const cargarCuentas = useCallback(async () => {
    const res = await api.get<Cuenta[]>("/api/erp/ledger_account?limit=500&sort=code");
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo cargar el plan de cuentas");
      setCuentas([]);
      return;
    }
    setCuentas((res.data || []).filter((c) => c.is_postable !== false && c.status !== "inactive"));
  }, []);

  useEffect(() => { if (abierto && cuentas === null) void cargarCuentas(); }, [abierto, cuentas, cargarCuentas]);

  const conImporte = lineas.filter((l) => num(l.debit) !== 0 || num(l.credit) !== 0);
  const totalDebito = centavos(conImporte.reduce((s, l) => s + num(l.debit), 0));
  const totalCredito = centavos(conImporte.reduce((s, l) => s + num(l.credit), 0));
  const diferencia = centavos(totalDebito - totalCredito);
  const sinCuenta = conImporte.some((l) => !l.account);
  const dobleLado = conImporte.some((l) => num(l.debit) !== 0 && num(l.credit) !== 0);
  const negativo = conImporte.some((l) => num(l.debit) < 0 || num(l.credit) < 0);
  const puedeGuardar =
    conImporte.length >= 2 && diferencia === 0 && !sinCuenta && !dobleLado && !negativo && !trabajando;

  const cambiar = (i: number, campo: keyof Linea, valor: string) =>
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)));

  const limpiar = () => {
    setLineas([{ ...LINEA_VACIA }, { ...LINEA_VACIA }]);
    setConcepto("");
    setFecha(hoy());
    setOrigen("adjustment");
  };

  const guardar = async () => {
    setTrabajando(true);
    const res = await api.post<{ entryCode: string; total: number }>("/api/ledger/post", {
      source: origen,
      memo: concepto || undefined,
      postedAt: new Date(`${fecha}T12:00:00`).toISOString(),
      lines: conImporte.map((l) => ({
        account: l.account,
        debit: num(l.debit) || undefined,
        credit: num(l.credit) || undefined,
        memo: l.memo || undefined,
      })),
    });
    setTrabajando(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo registrar el asiento");
      return;
    }
    toast.success(`Asiento ${res.data?.entryCode} registrado por ${formatMoney(res.data?.total ?? 0, "dop")}`);
    setAbierto(false);
    limpiar();
    recargar();
  };

  const reversar = async () => {
    if (!reversando?.entry_code) return;
    setTrabajando(true);
    const res = await api.post<{ entryCode: string }>("/api/ledger/post", {
      reverseEntry: reversando.entry_code,
    });
    setTrabajando(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo reversar el asiento");
      return;
    }
    toast.success(`${reversando.entry_code} reversado por ${res.data?.entryCode}`);
    setReversando(null);
    recargar();
  };

  const planVacio = cuentas !== null && cuentas.length === 0;

  return (
    <>
      <ResourcePage
        key={version}
        resource="ledger_entry"
        eyebrow="Finanzas"
        title="Libro diario"
        description="Líneas de asiento inmutables. Un error no se borra: se corrige con un asiento de reversa, y aquí está el botón para hacerlo."
        emptyIcon="Scale"
        emptyTitle="Sin asientos"
        emptyDescription="El sistema contabiliza solo al vender, cobrar y liquidar. Un ajuste manual se registra con el botón de arriba."
        searchPlaceholder="Buscar por asiento, concepto o periodo…"
        // Una línea de asiento no se edita ni se borra: solo se reversa.
        canWrite={false}
        extraActions={
          <Button onClick={() => setAbierto(true)}>
            <Icon name="Plus" className="size-4" /> Nuevo asiento
          </Button>
        }
        filters={[{ name: "source_type", label: "Origen", options: ORIGENES_FILTRO }]}
        rowActions={(row: Asiento) =>
          row.reversed ? (
            <Pill tone="neutral">Reversado</Pill>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setReversando(row)}>
              <Icon name="Undo2" className="size-3.5" /> Reversar
            </Button>
          )
        }
        columns={[
          { key: "posted_at", header: "Fecha", render: (r: Asiento) => (
            <span className="tf-num text-xs">{formatDateTime(r.posted_at)}</span>
          ) },
          { key: "entry_code", header: "Asiento", render: (r: Asiento) => (
            <div>
              <p className="tf-num font-semibold">{r.entry_code || "—"}</p>
              <p className="text-xs text-muted-foreground">
                línea {formatNumber(r.line_no ?? 0)}
                {r.reversal_of ? ` · reversa de ${r.reversal_of}` : ""}
              </p>
            </div>
          ) },
          { key: "cuenta", header: "Cuenta", render: (r: Asiento) => {
            const c = typeof r.ledger_account === "object" ? r.ledger_account : null;
            return c ? <span className="text-sm">{c.code} · {c.name}</span> : <span>—</span>;
          } },
          { key: "memo", header: "Concepto", hideOn: "md", render: (r: Asiento) => (
            <span className="text-xs text-muted-foreground">{r.memo || "—"}</span>
          ) },
          { key: "debit", header: "Débito", align: "right", render: (r: Asiento) => (
            <span className="tf-num">{r.debit ? formatMoney(r.debit, "dop") : "—"}</span>
          ) },
          { key: "credit", header: "Crédito", align: "right", render: (r: Asiento) => (
            <span className="tf-num">{r.credit ? formatMoney(r.credit, "dop") : "—"}</span>
          ) },
          { key: "source_type", header: "Origen", hideOn: "lg",
            render: (r: Asiento) => <StatusBadge value={r.source_type} dict={LEDGER_SOURCE} /> },
        ]}
        fields={[]}
      />

      {/* ─────────────────────────── asiento manual ─────────────────────────── */}
      <Dialog open={abierto} onOpenChange={(o) => { if (!o) { setAbierto(false); limpiar(); } }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Nuevo asiento</DialogTitle>
            <DialogDescription>
              Partida doble: los débitos y los créditos tienen que sumar lo mismo. No se guarda un
              asiento que no cuadre, ni dentro de un mes ya cerrado.
            </DialogDescription>
          </DialogHeader>

          {planVacio ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              No hay cuentas contables donde registrar. Siembra el plan base desde{" "}
              <span className="font-semibold">Finanzas → Plan de cuentas</span> y vuelve.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="as-origen">Origen</Label>
                  <Select value={origen} onValueChange={setOrigen}>
                    <SelectTrigger id="as-origen"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ORIGENES_MANUALES.map((o) => (
                        <SelectItem key={o} value={o}>{LEDGER_SOURCE[o]?.label ?? o}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="as-fecha">Fecha</Label>
                  <Input id="as-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="as-concepto">Concepto</Label>
                  <Input id="as-concepto" value={concepto} onChange={(e) => setConcepto(e.target.value)}
                    placeholder="Ej.: ajuste de inventario de septiembre" />
                </div>
              </div>

              <div className="space-y-2">
                {lineas.map((l, i) => (
                  <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto]">
                    <Select value={l.account} onValueChange={(v) => cambiar(i, "account", v)}>
                      <SelectTrigger aria-label={`Cuenta de la línea ${i + 1}`}>
                        <SelectValue placeholder={cuentas === null ? "Cargando…" : "Cuenta"} />
                      </SelectTrigger>
                      <SelectContent>
                        {(cuentas || []).map((c) => (
                          <SelectItem key={c._id} value={c.code || c._id}>{c.code} · {c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input type="number" min="0" step="0.01" className="tf-num" placeholder="Débito"
                      aria-label={`Débito de la línea ${i + 1}`}
                      value={l.debit} onChange={(e) => cambiar(i, "debit", e.target.value)} />
                    <Input type="number" min="0" step="0.01" className="tf-num" placeholder="Crédito"
                      aria-label={`Crédito de la línea ${i + 1}`}
                      value={l.credit} onChange={(e) => cambiar(i, "credit", e.target.value)} />
                    <Input placeholder="Nota" aria-label={`Nota de la línea ${i + 1}`}
                      value={l.memo} onChange={(e) => cambiar(i, "memo", e.target.value)} />
                    <Button variant="ghost" size="icon" aria-label={`Quitar la línea ${i + 1}`}
                      disabled={lineas.length <= 2}
                      onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}>
                      <Icon name="X" className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setLineas((ls) => [...ls, { ...LINEA_VACIA }])}>
                  <Icon name="Plus" className="size-4" /> Añadir línea
                </Button>
              </div>

              {/* El descuadre se dice, no se arregla solo. */}
              <div className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap justify-between gap-3">
                  <span className="text-muted-foreground">Débitos</span>
                  <span className="tf-num font-semibold">{formatMoney(totalDebito, "dop")}</span>
                </div>
                <div className="flex flex-wrap justify-between gap-3">
                  <span className="text-muted-foreground">Créditos</span>
                  <span className="tf-num font-semibold">{formatMoney(totalCredito, "dop")}</span>
                </div>
                <div className={`mt-1 flex flex-wrap justify-between gap-3 border-t pt-1 font-semibold ${
                  diferencia === 0 ? "" : "text-destructive"}`}>
                  <span>{diferencia === 0 ? "Cuadra" : "Diferencia"}</span>
                  <span className="tf-num">
                    {diferencia === 0 ? formatMoney(totalDebito, "dop") : formatMoney(Math.abs(diferencia), "dop")}
                  </span>
                </div>
                {diferencia !== 0 && (
                  <p className="mt-1 text-xs text-destructive">
                    {diferencia > 0
                      ? `Faltan ${formatMoney(diferencia, "dop")} de crédito.`
                      : `Faltan ${formatMoney(Math.abs(diferencia), "dop")} de débito.`}
                  </p>
                )}
                {conImporte.length < 2 && (
                  <p className="mt-1 text-xs text-muted-foreground">Un asiento necesita al menos dos líneas con importe.</p>
                )}
                {sinCuenta && <p className="mt-1 text-xs text-destructive">Hay una línea con importe y sin cuenta.</p>}
                {dobleLado && (
                  <p className="mt-1 text-xs text-destructive">
                    Una línea lleva débito o crédito, no los dos: pártela en dos líneas.
                  </p>
                )}
                {negativo && (
                  <p className="mt-1 text-xs text-destructive">
                    Un importe en negativo se registra al otro lado, no con signo.
                  </p>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => { setAbierto(false); limpiar(); }}>Cancelar</Button>
            <Button onClick={guardar} disabled={!puedeGuardar || planVacio}>
              {trabajando ? "Registrando…" : "Registrar asiento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ───────────────────────────── reversa ───────────────────────────── */}
      <Dialog open={Boolean(reversando)} onOpenChange={(o) => { if (!o) setReversando(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reversar {reversando?.entry_code}</DialogTitle>
            <DialogDescription>
              Se registra el asiento espejo y el original queda marcado como reversado. Nada se
              borra: los dos asientos siguen en el libro.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Se reversa el <span className="font-semibold">asiento completo</span>, con todas sus
            líneas — no solo la que tienes seleccionada.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReversando(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={reversar} disabled={trabajando}>
              {trabajando ? "Reversando…" : "Reversar el asiento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
