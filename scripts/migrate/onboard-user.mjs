#!/usr/bin/env node
/**
 * Onboarding de un usuario real a una organización (post-ETL M5).
 *
 * El ETL cargó los datos de las empresas reales pero NO migró usuarios a Supabase
 * Auth (las referencias a usuarios históricos quedaron en NULL). Con RLS activa,
 * un tenant sin membresías falla cerrado: nadie ve sus datos. Este script cierra
 * ese hueco de forma segura e idempotente: garantiza el usuario Auth y su
 * `organization_membership` activa y primaria, de modo que el access-token hook
 * inyecte `org_id` (y `partner_id` si la org es un partner) en su JWT.
 *
 * Uso:
 *   node scripts/migrate/onboard-user.mjs \
 *     --email=persona@empresa.com \
 *     --org=<slug-o-uuid-de-la-organización> \
 *     --role=owner \
 *     [--password='ClaveSegura123!' | --invite] \
 *     [--name='Nombre Apellido']
 *
 *   --org    slug (p.ej. 'havelgo-demo-presentaciones') o uuid de organizations.
 *            Puede ser un tenant (staff) o un partner (usuario de portal B2B).
 *   --role   owner|admin|manager|operations|cashier|seller|partner|superadmin
 *   Para un usuario NUEVO se exige --password o --invite (elige tú, no se generan
 *   contraseñas en silencio). --invite envía el enlace de Supabase para que la
 *   persona ponga su propia clave (requiere SMTP configurado en Auth).
 *
 * Requiere en el entorno/.env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Salida segura: no imprime contraseñas, tokens ni payloads de filas.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

// ── env ──────────────────────────────────────────────────────────────────────
for (const envFile of [".env", `.env.${process.env.NODE_ENV || "development"}`, ".env.local"]) {
  const envPath = path.resolve(process.cwd(), envFile);
  if (!fs.existsSync(envPath)) continue;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

// ── args ─────────────────────────────────────────────────────────────────────
const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([a-z-]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] ?? true;
}
const VALID_ROLES = new Set([
  "superadmin", "owner", "admin", "manager", "operations", "cashier", "seller", "partner",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(msg) { console.error(`✗ ${msg}`); process.exit(1); }

const email = typeof args.email === "string" ? args.email.trim().toLowerCase() : "";
const org = typeof args.org === "string" ? args.org.trim() : "";
const role = typeof args.role === "string" ? args.role.trim() : "owner";
const password = typeof args.password === "string" ? args.password : null;
const invite = args.invite === true;
const name = typeof args.name === "string" ? args.name : null;

if (!email || !email.includes("@")) fail("Falta --email válido.");
if (!org) fail("Falta --org (slug o uuid de la organización).");
if (!VALID_ROLES.has(role)) fail(`--role inválido: ${role}. Válidos: ${[...VALID_ROLES].join(", ")}`);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) fail("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");

const sb = createClient(url, key, { auth: { persistSession: false } });

// ── helpers ──────────────────────────────────────────────────────────────────
async function findUserByEmail(target) {
  for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const users = data?.users ?? [];
    const found = users.find((u) => u.email?.toLowerCase() === target);
    if (found) return found;
    if (users.length < 200) return null;
  }
}

async function ensureUser() {
  const existing = await findUserByEmail(email);
  if (existing) {
    if (password) {
      const { error } = await sb.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
      if (error) throw new Error(`updateUser: ${error.message}`);
    }
    return { id: existing.id, created: false };
  }
  if (invite) {
    const { data, error } = await sb.auth.admin.inviteUserByEmail(email, name ? { data: { name } } : undefined);
    if (error || !data?.user) throw new Error(`inviteUser: ${error?.message ?? "sin usuario"}`);
    return { id: data.user.id, created: true, invited: true };
  }
  if (!password) {
    fail("Usuario nuevo: especifica --password='...' o --invite (no se generan claves en silencio).");
  }
  const { data, error } = await sb.auth.admin.createUser({
    email, password, email_confirm: true, ...(name ? { user_metadata: { name } } : {}),
  });
  if (error || !data?.user) throw new Error(`createUser: ${error?.message ?? "sin usuario"}`);
  return { id: data.user.id, created: true };
}

async function resolveOrg() {
  const filter = UUID_RE.test(org) ? { col: "id", val: org } : { col: "slug", val: org };
  const { data, error } = await sb
    .from("organizations").select("id, name, kind, status").eq(filter.col, filter.val).maybeSingle();
  if (error) throw new Error(`load org: ${error.message}`);
  if (!data) fail(`No existe una organización con ${filter.col}='${org}'.`);
  if (data.status !== "active") console.warn(`⚠ La organización está en estado '${data.status}'.`);
  return data;
}

async function ensureMembership(userId, orgId) {
  // El hook elige la membresía primaria; se limpia cualquier otra del usuario.
  const { error: clearErr } = await sb
    .from("organization_memberships").update({ is_primary: false })
    .eq("user_id", userId).neq("organization_id", orgId);
  if (clearErr) throw new Error(`clear primaries: ${clearErr.message}`);

  const { data: existing, error } = await sb
    .from("organization_memberships").select("id")
    .eq("user_id", userId).eq("organization_id", orgId).maybeSingle();
  if (error) throw new Error(`load membership: ${error.message}`);

  if (existing?.id) {
    const { error: upErr } = await sb
      .from("organization_memberships")
      .update({ role, status: "active", is_primary: true }).eq("id", existing.id);
    if (upErr) throw new Error(`update membership: ${upErr.message}`);
    return "actualizada";
  }
  const { error: insErr } = await sb
    .from("organization_memberships")
    .insert({ user_id: userId, organization_id: orgId, role, status: "active", is_primary: true });
  if (insErr) throw new Error(`insert membership: ${insErr.message}`);
  return "creada";
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const orgRow = await resolveOrg();
  const user = await ensureUser();
  const action = await ensureMembership(user.id, orgRow.id);

  console.log("── Onboarding completado ──");
  console.log(`  organización: ${orgRow.name} (kind=${orgRow.kind})`);
  console.log(`  usuario Auth: ${user.created ? (user.invited ? "invitado (pendiente de aceptar)" : "creado") : "ya existía"}`);
  console.log(`  membresía: ${action} · rol=${role} · status=active · primary=true`);
  if (user.invited) {
    console.log("\n  → La persona recibirá un correo para fijar su contraseña (requiere SMTP en Auth).");
  } else if (user.created && password) {
    console.log("\n  → Contraseña fijada. Compártela por un canal seguro y pide cambiarla al entrar.");
  }
  console.log("\n  El access-token hook inyectará org_id en su próximo login; verá los datos de su empresa bajo RLS.");
}

main().catch((e) => { console.error("Onboarding falló:", e.message); process.exit(1); });
