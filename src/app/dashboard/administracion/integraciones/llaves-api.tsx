"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill } from "@/components/tf/status-badge";
import { Icon } from "@/components/tf/icon";
import { formatDate } from "@/lib/format";

/**
 * LLAVES DE API.
 *
 * Es la puerta por la que otro sistema —la web de una agencia, un conector de
 * OTA— consulta el catálogo y crea reservas. Emitir una es entregar una
 * credencial que vende en nombre de la operadora y que vivirá años en el
 * servidor de otra empresa, así que esta pantalla hace tres cosas:
 *
 *  1. ENSEÑA EL SECRETO UNA VEZ, con un aviso claro. Guardarlo para poder
 *     volver a mostrarlo sería guardar una contraseña en claro.
 *  2. DICE CUÁNDO SE USÓ CADA UNA. Sin ese dato nadie revoca nunca una llave
 *     «por si acaso alguien la está usando», y las llaves viejas se acumulan.
 *  3. SEPARA LEER DE VENDER. La mayoría de las integraciones solo necesitan
 *     consultar; dar escritura «por si acaso» es el hábito que convierte una
 *     filtración en reservas falsas.
 */

interface ApiKeyRow {
  _id: string;
  name: string;
  token: string;
  scope: "read" | "write";
  last_used_at: string | null;
  revoked_at: string | null;
  createdAt: string;
}

export function LlavesApi() {
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "write">("read");
  const [busy, setBusy] = useState(false);
  const [nuevo, setNuevo] = useState<{ name: string; token: string } | null>(null);

  const load = useCallback(async () => {
    const res = await api.get<ApiKeyRow[]>("/api/api-keys");
    setKeys(res.ok ? res.data || [] : []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const crear = async () => {
    if (!name.trim()) { toast.error("Ponle un nombre para saber cuál es cuál"); return; }
    setBusy(true);
    const res = await api.post<{ name: string; token: string }>("/api/api-keys", { name: name.trim(), scope });
    setBusy(false);
    if (!res.ok) { toast.error(res.error?.message || "No se pudo emitir la llave"); return; }
    setNuevo(res.data || null);
    setName("");
    load();
  };

  const revocar = async (key: ApiKeyRow) => {
    setBusy(true);
    const res = await api.delete(`/api/api-keys?id=${encodeURIComponent(key._id)}`);
    setBusy(false);
    if (!res.ok) { toast.error(res.error?.message || "No se pudo revocar"); return; }
    toast.success(`Llave «${key.name}» revocada. Deja de funcionar ahora mismo.`);
    load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon name="KeyRound" className="size-4 text-primary" /> Llaves de API
        </CardTitle>
        <CardDescription>
          Para que la web de una agencia o un conector consulte tu catálogo y cree reservas. Cada llave es una
          credencial que vende en tu nombre: dale solo el alcance que necesite.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* El secreto, una sola vez. */}
        {nuevo && (
          <div className="space-y-2 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4">
            <p className="text-sm font-semibold">Copia la llave ahora: no se vuelve a mostrar</p>
            <code className="block break-all rounded-lg bg-background p-3 font-mono text-xs">{nuevo.token}</code>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => {
                  navigator.clipboard?.writeText(nuevo.token);
                  toast.success("Copiada");
                }}
              >
                <Icon name="Copy" className="size-3.5" /> Copiar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setNuevo(null)}>Ya la guardé</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Guardamos solo su huella, no la llave: si se pierde, se emite otra y se revoca esta.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1 space-y-1.5">
            <Label htmlFor="key-name" className="text-xs">Nombre</Label>
            <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Web de Bávaro Tours" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Alcance</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as "read" | "write")}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="read">Solo consultar</SelectItem>
                <SelectItem value="write">Consultar y crear reservas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={crear} disabled={busy}>Emitir llave</Button>
        </div>

        {keys === null ? (
          <Skeleton className="h-24 w-full rounded-xl" />
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay llaves emitidas.</p>
        ) : (
          <ul className="space-y-2">
            {keys.map((key) => (
              <li key={key._id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    {key.name}
                    <Pill tone={key.revoked_at ? "danger" : key.scope === "write" ? "warning" : "neutral"}>
                      {key.revoked_at ? "Revocada" : key.scope === "write" ? "Crea reservas" : "Solo lectura"}
                    </Pill>
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">{key.token}</p>
                  <p className="text-xs text-muted-foreground">
                    {/* Sin este dato nadie revoca nunca «por si acaso alguien la usa». */}
                    {key.last_used_at
                      ? `Último uso: ${formatDate(key.last_used_at)}`
                      : "Nunca se ha usado"}
                  </p>
                </div>
                {!key.revoked_at && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => revocar(key)}>
                    Revocar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        <p className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
          La documentación para quien integra está en <span className="font-mono">docs/api/API_SOCIOS.md</span>:
          catálogo, disponibilidad y creación de reservas con clave de idempotencia.
        </p>
      </CardContent>
    </Card>
  );
}
