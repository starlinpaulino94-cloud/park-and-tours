#!/usr/bin/env node
/**
 * Verifica la integridad de `approval_request` contra las reglas del dominio.
 *
 * Sustituye la comprobación manual que quedó pendiente tras corregir la doble
 * firma: confirma que `requires_two` es un booleano real en TODAS las filas
 * (nunca las cadenas "yes"/"no" del código heredado), que ninguna solicitud
 * caducada sigue figurando como pendiente y que ninguna aprobación se cerró con
 * la misma persona en las dos firmas.
 *
 * Solo lee. No modifica nada. Sale con código 1 si encuentra inconsistencias,
 * para poder encadenarlo en CI o en un despliegue.
 *
 *   npm run verify:approvals
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const file of [".env", `.env.${process.env.NODE_ENV || "development"}`, ".env.local"]) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("❌ Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const problems = [];
const note = (message) => console.log(`   ${message}`);

async function fetchAll() {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await sb
      .from("approval_request")
      .select("id, code, organization_id, status, requires_two, expires_at, requested_by, approved_by, second_approver_id")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

const rows = await fetchAll();
console.log(`\n🔎 ${rows.length} solicitudes de aprobación revisadas\n`);

// 1) requires_two es un booleano real.
console.log("1. requires_two es booleano");
const badType = rows.filter((r) => typeof r.requires_two !== "boolean");
if (badType.length > 0) {
  problems.push(`${badType.length} filas con requires_two no booleano`);
  for (const r of badType.slice(0, 10)) note(`✗ ${r.code}: ${JSON.stringify(r.requires_two)} (${typeof r.requires_two})`);
} else {
  const withTwo = rows.filter((r) => r.requires_two === true).length;
  note(`✓ todas booleanas — ${withTwo} exigen doble firma, ${rows.length - withTwo} firma simple`);
}

// 2) Ninguna pendiente con expires_at pasado.
console.log("\n2. Sin pendientes caducadas");
const now = Date.now();
const staleOpen = rows.filter(
  (r) => r.status === "pending" && r.expires_at && new Date(r.expires_at).getTime() < now
);
if (staleOpen.length > 0) {
  // No es corrupción: las lecturas ya las descartan. Indica que el cron no corrió.
  note(`⚠ ${staleOpen.length} pendientes con plazo vencido — ejecuta /api/cron/expire-approvals`);
  for (const r of staleOpen.slice(0, 10)) note(`  ${r.code} expiró ${r.expires_at}`);
} else {
  note("✓ ninguna solicitud pendiente tiene el plazo vencido");
}

// 3) Nadie firmó dos veces la misma solicitud.
console.log("\n3. Doble firma por personas distintas");
const sameSigner = rows.filter(
  (r) => r.second_approver_id && r.approved_by && r.second_approver_id === r.approved_by
);
if (sameSigner.length > 0) {
  problems.push(`${sameSigner.length} solicitudes firmadas dos veces por la misma persona`);
  for (const r of sameSigner.slice(0, 10)) note(`✗ ${r.code}`);
} else {
  note("✓ ninguna solicitud tiene la misma persona en las dos firmas");
}

// 4) Nadie aprobó su propia solicitud.
console.log("\n4. Sin autoaprobaciones");
const selfApproved = rows.filter(
  (r) => r.requested_by && (r.requested_by === r.approved_by || r.requested_by === r.second_approver_id)
);
if (selfApproved.length > 0) {
  problems.push(`${selfApproved.length} solicitudes decididas por su propio solicitante`);
  for (const r of selfApproved.slice(0, 10)) note(`✗ ${r.code}`);
} else {
  note("✓ ningún solicitante decidió su propia solicitud");
}

// 5) Toda solicitud de doble firma aprobada tiene las dos firmas.
console.log("\n5. Doble firma completa en las aprobadas");
const missingSecond = rows.filter(
  (r) => r.requires_two === true && r.status === "approved" && !r.second_approver_id
);
if (missingSecond.length > 0) {
  problems.push(`${missingSecond.length} aprobaciones de doble firma sin segunda firma registrada`);
  note("   (probablemente cerradas antes de corregir el booleano; revísalas manualmente)");
  for (const r of missingSecond.slice(0, 10)) note(`✗ ${r.code}`);
} else {
  note("✓ todas las aprobaciones de doble firma tienen segunda firma");
}

console.log("");
if (problems.length > 0) {
  console.error("❌ Inconsistencias encontradas:");
  for (const p of problems) console.error(`   • ${p}`);
  process.exit(1);
}
console.log("✅ approval_request íntegro\n");
