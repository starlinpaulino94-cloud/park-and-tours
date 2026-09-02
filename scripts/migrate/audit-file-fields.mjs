#!/usr/bin/env node
/**
 * Auditoría (SOLO LECTURA) de los campos que guardan archivos, para diseñar la
 * migración de blobs Totalum → Supabase Storage (pendiente P1 del cutover).
 *
 * No migra nada: por cada columna de archivo reporta cuántas filas tienen valor,
 * cuántas parecen URL de Totalum vs. ya un path de Storage vs. otro, y hasta 3
 * ejemplos truncados. Con esa salida se decide el formato real de las URLs y se
 * escribe el migrador con la detección correcta.
 *
 * Requiere: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (en .env / entorno).
 * Uso:  node scripts/migrate/audit-file-fields.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

for (const envFile of [".env", `.env.${process.env.NODE_ENV || "development"}`, ".env.local"]) {
  const p = path.resolve(process.cwd(), envFile);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

// Mapa tabla → columnas de archivo (derivado del esquema real; kind: text|array).
const FILE_FIELDS = [
  ["attraction",      [["cover_image_url", "text"]]],
  ["certification",   [["document", "text"]]],
  ["document",        [["file", "text"], ["url", "text"]]],
  ["expense",         [["receipt_file", "text"]]],
  ["incident",        [["photos", "array"]]],
  ["inspection",      [["photos", "array"]]],
  ["inventory_item",  [["image_url", "text"]]],
  ["invoice",         [["pdf_url", "text"]]],
  ["membership",      [["photo", "text"]]],
  ["membership_plan", [["image_url", "text"]]],
  ["staff",           [["document_file", "array"], ["photo_url", "text"]]],
  ["vehicle",         [["photo_url", "text"]]],
  ["waiver",          [["guardian_document", "text"]]],
];

const looksTotalum = (v) => /totalum/i.test(v) || (/^https?:\/\//i.test(v) && !/supabase/i.test(v));
const looksStorage = (v) => /supabase\.co\/storage|\/storage\/v1\/|^[0-9a-f-]{8,}\//i.test(v);
const trunc = (v) => (v.length > 70 ? v.slice(0, 67) + "…" : v);

function classify(values, bucket) {
  const b = bucket;
  for (const raw of values) {
    if (raw == null) continue;
    const arr = Array.isArray(raw) ? raw : [raw];
    for (const v of arr) {
      if (typeof v !== "string" || v === "") continue;
      b.withValue++;
      if (looksStorage(v)) b.storage++;
      else if (looksTotalum(v)) b.totalum++;
      else b.other++;
      if (b.samples.length < 3) b.samples.push(trunc(v));
    }
  }
}

async function auditColumn(table, col, kind) {
  const bucket = { withValue: 0, totalum: 0, storage: 0, other: 0, samples: [] };
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select(col).not(col, "is", null).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}.${col}: ${error.message}`);
    classify(data.map((r) => r[col]), bucket);
    if (data.length < PAGE) break;
  }
  return bucket;
}

async function main() {
  console.log("── Auditoría de campos de archivo (solo lectura) ──\n");
  let grand = { withValue: 0, totalum: 0, storage: 0, other: 0 };
  for (const [table, cols] of FILE_FIELDS) {
    for (const [col, kind] of cols) {
      let b;
      try { b = await auditColumn(table, col, kind); }
      catch (e) { console.log(`  ✗ ${table}.${col}: ${e.message}`); continue; }
      grand.withValue += b.withValue; grand.totalum += b.totalum; grand.storage += b.storage; grand.other += b.other;
      const tag = b.withValue === 0 ? "vacío"
        : `${b.withValue} val · totalum=${b.totalum} storage=${b.storage} otro=${b.other}`;
      console.log(`  ${table}.${col} [${kind}] → ${tag}`);
      for (const s of b.samples) console.log(`       e.g. ${s}`);
    }
  }
  console.log(`\n  TOTAL: ${grand.withValue} valores · a migrar (totalum)=${grand.totalum} · ya en storage=${grand.storage} · otros=${grand.other}`);
  console.log(grand.totalum > 0
    ? "\n  → Hay archivos apuntando a Totalum: procede el migrador de blobs."
    : "\n  → No se detectaron URLs de Totalum: revisa 'otros'/'storage' antes de migrar.");
}

main().catch((e) => { console.error("Auditoría falló:", e.message); process.exit(1); });
