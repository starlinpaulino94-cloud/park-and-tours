"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Icon } from "@/components/tf/icon";
import { COMPANY_TYPE } from "@/lib/labels";
import { FILES } from "../../../assets/files";

const CURRENCIES = [
  { value: "usd", label: "Dólar estadounidense (USD)" },
  { value: "dop", label: "Peso dominicano (DOP)" },
  { value: "eur", label: "Euro (EUR)" },
  { value: "mxn", label: "Peso mexicano (MXN)" },
  { value: "cop", label: "Peso colombiano (COP)" },
  { value: "brl", label: "Real brasileño (BRL)" },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "", company_type: "excursion_company", base_currency: "usd",
    country: "República Dominicana", city: "", phone: "", tax_id: "", group_name: "",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error("Indica el nombre de tu empresa");
      return;
    }
    setSaving(true);
    const res = await api.post<{
      company: { name: string } | null;
      demo: Record<string, number> | null;
      demoError?: string | null;
    }>("/api/setup", { ...form, seed_demo: true });
    setSaving(false);
    if (!res.ok) {
      console.error("[onboarding] error creando la empresa:", res.error);
      toast.error(res.error?.message || "No se pudo crear la empresa");
      return;
    }
    if (res.data?.demoError) {
      // The tenant exists and is usable; only the sample data failed.
      console.error("[onboarding] datos de ejemplo incompletos:", res.data.demoError);
      toast.warning("Empresa creada. Los datos de ejemplo quedaron incompletos, puedes cargarlos luego.");
    } else {
      toast.success("Empresa creada con datos de ejemplo listos para explorar");
    }
    router.push("/dashboard");
    router.refresh();
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_0.9fr]">
      <div className="flex items-center justify-center px-4 py-12 sm:px-10">
        <div className="w-full max-w-lg tf-rise">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-primary font-display text-base font-bold text-primary-foreground">T</span>
            <span className="font-display text-lg font-semibold">TourFlow</span>
          </div>

          <h1 className="mt-8 font-display text-3xl font-semibold leading-tight">Configura tu empresa</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Creamos tu espacio aislado, la configuración base (sucursal, caja, categorías, políticas y reglas de comisión)
            y un juego de datos de ejemplo para que puedas explorar el sistema funcionando.
          </p>

          <div className="mt-8 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Nombre de la empresa *</Label>
              <Input id="name" value={form.name} onChange={(e) => set("name", e.target.value)}
                placeholder="Caribe Excursions SRL" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="type">Tipo de empresa</Label>
                <Select value={form.company_type} onValueChange={(v) => set("company_type", v)}>
                  <SelectTrigger id="type" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(COMPANY_TYPE).map(([value, def]) => (
                      <SelectItem key={value} value={value}>{def.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="currency">Moneda contable</Label>
                <Select value={form.base_currency} onValueChange={(v) => set("base_currency", v)}>
                  <SelectTrigger id="currency" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="country">País</Label>
                <Input id="country" value={form.country} onChange={(e) => set("country", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="city">Ciudad</Label>
                <Input id="city" value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="Punta Cana" />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="tax">RNC / Identificación fiscal</Label>
                <Input id="tax" value={form.tax_id} onChange={(e) => set("tax_id", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Teléfono</Label>
                <Input id="phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+1 809 000 0000" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="group">Grupo empresarial (opcional)</Label>
              <Input id="group" value={form.group_name} onChange={(e) => set("group_name", e.target.value)}
                placeholder="Grupo Caribe Holdings" />
            </div>

            <Button className="w-full gap-2" size="lg" onClick={submit} disabled={saving}>
              {saving ? "Creando tu empresa…" : "Crear empresa y entrar"}
              {!saving && <Icon name="ArrowRight" className="size-4" />}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Podrás cambiar cualquier dato después en Configuración.
            </p>
          </div>
        </div>
      </div>

      <div className="tf-mesh tf-grain relative hidden overflow-hidden lg:block">
        <img src={FILES.heroBoat} alt="Catamarán navegando al atardecer" className="absolute inset-0 size-full object-cover opacity-45" />
        <div className="relative flex h-full flex-col justify-end gap-4 p-12">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/80">Listo en segundos</p>
          <h2 className="max-w-md font-display text-3xl font-semibold text-white">
            Tu empresa arranca con catálogo, calendario, red de ventas y caja configurados
          </h2>
          <ul className="mt-2 space-y-2 text-sm text-white/75">
            {[
              "8 excursiones con modalidades, tarifas y costes",
              "Calendario de salidas con cupos reales",
              "Tour centers, agencias y vendedores con comisiones",
              "Reservas, pagos, vouchers y comisiones generadas",
            ].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <Icon name="Check" className="size-4 text-amber" /> {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
