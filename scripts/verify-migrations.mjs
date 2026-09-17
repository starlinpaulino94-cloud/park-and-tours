#!/usr/bin/env node
/**
 * Comprueba que la base REAL tiene lo que el código espera (migraciones 0032-0057).
 *
 * `schema-contract.test.ts` verifica el código contra los ARCHIVOS de migración.
 * Esto es lo otro: pregunta a la base de datos de verdad. Se ejecuta después de
 * aplicar las migraciones, y responde la única pregunta que importa entonces —
 * "¿quedó todo?"— sin tener que abrir el editor SQL y mirar tabla por tabla.
 *
 * Solo lee. No escribe nada, no consume un NCF, no toca una fila. Salida segura:
 * nombres de tablas y columnas, nunca datos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL VERDE DE AQUÍ TIENE QUE SIGNIFICAR ALGO
 *
 * Este inventario se quedó declarando «0032-0040» mientras llegaban dieciséis
 * migraciones más, así que respondía «todo en verde» sin haber mirado las
 * tablas nuevas — y ese verde es exactamente lo que alguien usa para decidir
 * que puede desplegar.
 *
 * Ahora hay dos guardas en `schema-contract.test.ts` que lo impiden: una
 * comprueba que el inventario no pida cosas que ninguna migración crea, y otra
 * que no le FALTE ninguna tabla nueva.
 *
 * Uso:  node scripts/verify-migrations.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const envFiles = [".env", ".env.local", `.env.${process.env.NODE_ENV || "development"}`];
for (const envFile of envFiles) {
  const envPath = path.resolve(process.cwd(), envFile);
  if (!fs.existsSync(envPath)) continue;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error(
    "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.\n" +
    "Ponlas en .env.local (las encuentras en Supabase → Project Settings → API)."
  );
  process.exit(2);
}

const sb = createClient(URL, KEY, { auth: { persistSession: false } });

import { MIGRATION_CHECKS as CHECKS } from "./migration-checks.mjs";

let failures = 0;
let checks = 0;
const missing = [];

const ok = (msg) => console.log(`  ✅ ${msg}`);
const bad = (msg, detail) => {
  failures += 1;
  missing.push(msg);
  console.log(`  ❌ ${msg}${detail ? ` — ${detail}` : ""}`);
};

/** La tabla existe y se puede leer. */
async function checkTable(table) {
  checks += 1;
  const { error } = await sb.from(table).select("id").limit(1);
  if (error) return bad(`tabla ${table}`, error.message);
  ok(`tabla ${table}`);
}

/**
 * Las columnas existen.
 *
 * Se piden TODAS de una vez con `limit(0)`: no trae ni una fila, y si falta
 * alguna PostgREST responde 42703 nombrándola.
 */
async function checkColumns(table, columns) {
  checks += 1;
  const { error } = await sb.from(table).select(columns.join(",")).limit(0);
  if (!error) return ok(`${table}: ${columns.length} columnas`);

  // Con el error genérico no se sabe cuál falta: se prueban de una en una.
  const absent = [];
  for (const column of columns) {
    const probe = await sb.from(table).select(column).limit(0);
    if (probe.error) absent.push(column);
  }
  bad(
    `${table}: faltan ${absent.length > 0 ? absent.join(", ") : "columnas"}`,
    absent.length > 0 ? undefined : error.message
  );
}

/** El valor del enum es aceptable (se filtra por él, sin leer nada). */
async function checkEnum(table, column, value) {
  checks += 1;
  const { error } = await sb.from(table).select("id").eq(column, value).limit(0);
  if (error) return bad(`${table}.${column} admite '${value}'`, error.message);
  ok(`${table}.${column} admite '${value}'`);
}

/**
 * La función está publicada.
 *
 * Se la llama con una organización ajena a propósito: `next_ncf` comprueba el
 * inquilino ANTES de tocar la secuencia, así que responde con un error de
 * permisos y NO consume ningún comprobante. Lo que se comprueba es que
 * responda algo distinto de "esa función no existe".
 */
async function checkRpc(name) {
  checks += 1;
  const { error } = await sb.rpc(name, {
    p_org: "00000000-0000-0000-0000-000000000000",
    p_type: "b02",
  });
  if (error && /PGRST202|could not find|does not exist/i.test(`${error.code} ${error.message}`)) {
    return bad(`función ${name}()`, error.message);
  }
  ok(`función ${name}() publicada`);
}

console.log(`\nComprobando el esquema de ${URL.replace(/^https?:\/\//, "").split(".")[0]}…\n`);

for (const group of CHECKS) {
  console.log(`── ${group.migration}`);
  for (const table of group.tables ?? []) await checkTable(table);
  for (const [table, columns] of group.columns ?? []) await checkColumns(table, columns);
  for (const [table, column, value] of group.enums ?? []) await checkEnum(table, column, value);
  for (const name of group.rpc ?? []) await checkRpc(name);
  console.log("");
}

console.log("─".repeat(60));
if (failures === 0) {
  console.log(`✔ ${checks} comprobaciones en verde: la base tiene todo lo que el código espera.`);
  process.exit(0);
}
console.log(`✖ ${failures} de ${checks} comprobaciones fallaron:\n`);
for (const item of missing) console.log(`   · ${item}`);
console.log(
  "\nVuelve a ejecutar la migración correspondiente. Todas son re-ejecutables:\n" +
  "relanzarlas no duplica nada ni borra datos."
);
process.exit(1);
