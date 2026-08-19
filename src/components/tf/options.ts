import type { LabelDef } from "@/lib/labels";

/** Turns a label dictionary into <Select> options. */
export function optionsFrom(dict: Record<string, LabelDef>, only?: string[]) {
  return Object.entries(dict)
    .filter(([k]) => !only || only.includes(k))
    .map(([value, def]) => ({ value, label: def.label }));
}

export const CURRENCY_OPTIONS = [
  { value: "usd", label: "USD — Dólar" },
  { value: "dop", label: "DOP — Peso dominicano" },
  { value: "eur", label: "EUR — Euro" },
  { value: "mxn", label: "MXN — Peso mexicano" },
  { value: "cop", label: "COP — Peso colombiano" },
  { value: "brl", label: "BRL — Real" },
];

export const STATUS_OPTIONS = [
  { value: "active", label: "Activo" },
  { value: "inactive", label: "Inactivo" },
];

export const LANGUAGE_OPTIONS = [
  { value: "es", label: "Español" }, { value: "en", label: "Inglés" },
  { value: "fr", label: "Francés" }, { value: "de", label: "Alemán" },
  { value: "it", label: "Italiano" }, { value: "pt", label: "Portugués" },
  { value: "ru", label: "Ruso" },
];
