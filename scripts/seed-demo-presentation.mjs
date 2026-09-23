#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import { SEED_TABLES, TEARDOWN_TABLES } from "./demo/tables.mjs";
import { helpers } from "./demo/lib.mjs";
import { seed as seedCatalogo } from "./demo/catalogo.mjs";
import { seed as seedComercial } from "./demo/comercial.mjs";
import { seed as seedOperacion } from "./demo/operacion.mjs";
import { seed as seedAlmacen } from "./demo/almacen.mjs";
import { seed as seedFinanzas } from "./demo/finanzas.mjs";
import { seed as seedPlataforma } from "./demo/plataforma.mjs";

/**
 * Los módulos que llenan lo que el sembrador original no tocaba.
 *
 * Van EN ORDEN: el comercial cuelga de productos, clientes y vendedores que
 * siembra el cuerpo de este archivo, y las cotizaciones y pases cuelgan de los
 * catálogos del primero. Cada uno busca en la base lo que necesita en vez de
 * recibirlo, así que si algo falta simplemente siembra menos en lugar de
 * reventar a mitad y dejar la demostración a medias.
 */
const MODULOS = [
  ["catálogo", seedCatalogo],
  ["comercial", seedComercial],
  ["operación", seedOperacion],
  ["almacén", seedAlmacen],
  ["finanzas", seedFinanzas],
  ["plataforma", seedPlataforma],
];

/**
 * A QUIÉN SE LE SIEMBRA, Y DÓNDE.
 *
 * El correo identifica a una persona; lo que se siembra es una EMPRESA. Los
 * datos de este sistema están alcanzados por `organization_id`, no por usuario,
 * así que sembrar la empresa alcanza a todas las cuentas que pertenecen a ella
 * — que es exactamente lo que se quiere para una demostración.
 *
 * Y NO se siembra la empresa real. Se crea una empresa hermana de demostración
 * y se le da membresía a las mismas personas. Meter clientes inventados,
 * reservas que nadie hizo y comisiones que nadie cobró dentro de la operación de
 * verdad contamina arqueos, cobros y contabilidad mientras estén ahí, y eso no
 * se deshace tirando de un hilo.
 *
 * La membresía nueva nace con `is_primary: false` a propósito: al entrar, cada
 * quien sigue aterrizando en su empresa real. Para presentar se cambia de
 * empresa en el selector, y al salir no queda nadie con la demo por defecto.
 */
const OWNER_EMAIL =
  process.argv.find((a) => a.startsWith("--email="))?.slice(8) ||
  process.env.DEMO_OWNER_EMAIL ||
  "starlinpaulino94@gmail.com";

const RESET = process.argv.includes("--reset");
/** Borra la empresa de demostración entera y no siembra nada. */
const ONLY_REMOVE = process.argv.includes("--remove");

for (const file of [".env", `.env.${process.env.NODE_ENV || "development"}`, ".env.local"]) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const now = new Date();
const at = (days, hour = 9, minute = 0) => {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};
const dateOnly = (days) => at(days).slice(0, 10);
const code = (prefix, i) => `${prefix}-${String(i).padStart(3, "0")}`;

async function insert(table, row) {
  const { data, error } = await sb.from(table).insert(row).select("id").single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data.id;
}

async function maybeCount(table, filter = {}) {
  let q = sb.from(table).select("*", { count: "exact", head: true });
  for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
  const { count, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

async function ensureRuntimeColumns() {
  for (const [table, columns] of [
    ["booking", "id,booking_date"],
    ["product", "id,sort_order"],
    ["product_modality", "id,sort_order"],
  ]) {
    const { error } = await sb.from(table).select(columns).limit(1);
    if (error) {
      throw new Error(`Falta una columna requerida en ${table}: ${error.message}. Ejecuta supabase/migrations/0021_missing_runtime_columns.sql primero.`);
    }
  }
}

/**
 * El Admin API no tiene «buscar por correo», así que se pagina.
 *
 * Miraba SOLO la primera página. Con más usuarios de los que caben en ella,
 * devolvía «no existe» sobre una cuenta que sí existe — y el script paraba
 * diciendo que hay que crear un usuario que ya está.
 */
async function findUserByEmail(email) {
  const wanted = email.toLowerCase();
  for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`auth.users: ${error.message}`);
    const users = data?.users ?? [];
    const found = users.find((u) => u.email?.toLowerCase() === wanted);
    if (found) return found;
    if (users.length < 200) return null;
  }
}

/** La empresa real de esa persona: la raíz del inquilino, no la sucursal. */
async function realOrgOf(userId) {
  const { data, error } = await sb
    .from("organization_memberships")
    .select("organization_id, is_primary, created_at, organizations(id, name, tenant_org_id)")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(`membresías: ${error.message}`);
  const first = (data ?? [])[0];
  if (!first) return null;
  const org = first.organizations;
  return { id: org.tenant_org_id || org.id, name: org.name };
}

/** Todas las personas de esa empresa: la demo es de la empresa, no de una cuenta. */
async function membersOf(orgId) {
  const { data, error } = await sb
    .from("organization_memberships")
    .select("user_id, role")
    .eq("organization_id", orgId)
    .eq("status", "active");
  if (error) throw new Error(`miembros: ${error.message}`);
  return data ?? [];
}

/**
 * Cada persona de la empresa real entra también en la de demostración.
 *
 * `is_primary: false` SIEMPRE, incluso al actualizar una membresía que ya
 * existiera: si se pusiera a true, al entrar aterrizarían en la demo en vez de
 * en su operación, y esa clase de sorpresa se descubre con un cliente esperando.
 */
async function ensureMemberships(demoOrgId, members) {
  for (const m of members) {
    const { data: existing, error } = await sb
      .from("organization_memberships")
      .select("id")
      .eq("user_id", m.user_id)
      .eq("organization_id", demoOrgId)
      .maybeSingle();
    if (error) throw new Error(`membresía demo: ${error.message}`);

    const row = { role: m.role === "partner" ? "staff" : m.role, status: "active", is_primary: false };
    if (existing?.id) {
      const { error: upErr } = await sb.from("organization_memberships").update(row).eq("id", existing.id);
      if (upErr) throw new Error(`membresía demo: ${upErr.message}`);
    } else {
      const { error: insErr } = await sb
        .from("organization_memberships")
        .insert({ user_id: m.user_id, organization_id: demoOrgId, ...row });
      if (insErr) throw new Error(`membresía demo: ${insErr.message}`);
    }
  }
}

/* ══════════════════════════ las cuentas de demostración ══════════════════ */

/**
 * TRES CUENTAS CON SU PROPIA CONTRASEÑA, DENTRO DE LA EMPRESA DEMO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PARA QUÉ, SI YA HAY UN SELECTOR DE EMPRESA
 *
 * El selector sirve para TI: entras con tu cuenta y saltas a la demo. Estas
 * cuentas sirven para lo otro — entregarle una a un comercial, a un cliente que
 * quiere trastear el fin de semana, o a quien prepara una feria — sin darle
 * acceso a tu operación de verdad.
 *
 * Solo tienen membresía en la empresa de demostración. Aunque alguien les dé la
 * dirección de tu panel, no hay nada que ver: la RLS resuelve por membresía y
 * no tienen ninguna en tu empresa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TRES ROLES Y NO UNO
 *
 * Enseñar el sistema desde el propietario da una idea equivocada de él: todo se
 * puede, todo se ve, y el visitante se lleva la impresión de un ERP sin
 * permisos. Con las tres cuentas se puede enseñar lo que de verdad convence —
 * que el vendedor no ve los márgenes y que el guía solo ve su manifiesto—.
 */
const DEMO_USERS = [
  { suffix: "demo", role: "owner", name: "Demo · Propietario" },
  { suffix: "demo.ventas", role: "seller", name: "Demo · Vendedor" },
  { suffix: "demo.guia", role: "operations", name: "Demo · Operación" },
];

/**
 * La contraseña NO vive en el repositorio.
 *
 * Se toma de `DEMO_USER_PASSWORD` si está puesta, y si no se genera una y se
 * imprime UNA vez al terminar. Escribir aquí una contraseña «de demostración»
 * sería publicar una credencial válida contra una base real, y las
 * credenciales de demostración son justo las que nadie cambia nunca.
 */
function demoPassword() {
  const puesta = process.env.DEMO_USER_PASSWORD;
  if (puesta && puesta.length >= 12) return { value: puesta, generated: false };
  if (puesta) throw new Error("DEMO_USER_PASSWORD es demasiado corta: mínimo 12 caracteres.");
  const bytes = crypto.randomBytes(12);
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (const b of bytes) out += alfabeto[b % alfabeto.length];
  return { value: `Demo-${out}`, generated: true };
}

/** El correo de cada cuenta, derivado del dominio de la empresa demo. */
function demoEmail(suffix, slug) {
  return `${suffix}@${slug}.demo.local`.toLowerCase();
}

/**
 * Crea (o actualiza) las cuentas y las mete SOLO en la empresa de demostración.
 *
 * Es idempotente: si la cuenta ya existe se le repone la contraseña y se
 * comprueba su membresía. Así, volver a ejecutar el sembrador sirve también
 * para «se me olvidó la contraseña de la demo».
 */
async function ensureDemoUsers(demoOrgId, slug, password) {
  const creadas = [];
  for (const perfil of DEMO_USERS) {
    const email = demoEmail(perfil.suffix, slug);
    let user = await findUserByEmail(email);

    if (!user) {
      const { data, error } = await sb.auth.admin.createUser({
        email,
        password,
        // Sin confirmar, Supabase le pide verificar un correo que nadie va a
        // recibir: el dominio `.demo.local` no existe a propósito, para que
        // ninguna de estas cuentas pueda recibir un mensaje de verdad.
        email_confirm: true,
        user_metadata: { name: perfil.name, demo: true },
      });
      if (error) throw new Error(`crear ${email}: ${error.message}`);
      user = data.user;
      creadas.push({ email, role: perfil.role, nuevo: true, userId: user.id });
    } else {
      const { error } = await sb.auth.admin.updateUserById(user.id, {
        password,
        user_metadata: { name: perfil.name, demo: true },
      });
      if (error) throw new Error(`actualizar ${email}: ${error.message}`);
      creadas.push({ email, role: perfil.role, nuevo: false, userId: user.id });
    }

    const { data: existing, error: memErr } = await sb
      .from("organization_memberships")
      .select("id")
      .eq("user_id", user.id)
      .eq("organization_id", demoOrgId)
      .maybeSingle();
    if (memErr) throw new Error(`membresía de ${email}: ${memErr.message}`);

    // `is_primary: true` y aquí SÍ es lo correcto: para estas cuentas la
    // demostración es su única empresa, así que es donde tienen que aterrizar.
    const row = { role: perfil.role, status: "active", is_primary: true };
    const { error: upErr } = existing?.id
      ? await sb.from("organization_memberships").update(row).eq("id", existing.id)
      : await sb.from("organization_memberships").insert({ user_id: user.id, organization_id: demoOrgId, ...row });
    if (upErr) throw new Error(`membresía de ${email}: ${upErr.message}`);
  }
  return creadas;
}

/**
 * VINCULA LA CUENTA DE VENDEDOR DE LA DEMO CON UNA FICHA DE VENDEDOR.
 *
 * Desde que el ámbito del vendedor existe (`src/lib/seller-scope.ts`), lo que
 * ve esa cuenta depende de `seller.user_id`: sin vínculo solo vería las ventas
 * SIN vendedor asignado, y en esta demostración todas lo tienen. Es decir, la
 * pantalla que existe para enseñar «el vendedor solo ve lo suyo» habría
 * enseñado una lista vacía, que no demuestra nada y parece una avería.
 *
 * Se elige la ficha con MÁS ventas para que la demostración tenga cuerpo, y se
 * respeta un vínculo que ya exista: reasignarlo en cada ejecución movería la
 * demo de sitio sin avisar.
 */
async function linkDemoSeller(orgId, cuentas) {
  const cuenta = cuentas.find((c) => c.role === "seller");
  if (!cuenta?.userId) return null;

  const { data: yaVinculada } = await sb
    .from("seller").select("id,first_name,last_name")
    .eq("organization_id", orgId).eq("user_id", cuenta.userId).maybeSingle();
  if (yaVinculada?.id) return { ...yaVinculada, email: cuenta.email, nueva: false };

  const { data: fichas } = await sb
    .from("seller").select("id,first_name,last_name")
    .eq("organization_id", orgId).eq("status", "active").is("user_id", null);
  if (!fichas?.length) return null;

  const { data: ventas } = await sb
    .from("sales_order").select("seller_id").eq("organization_id", orgId).not("seller_id", "is", null);
  const cuenta_por_ficha = new Map();
  for (const v of ventas || []) cuenta_por_ficha.set(v.seller_id, (cuenta_por_ficha.get(v.seller_id) || 0) + 1);

  const elegida = [...fichas].sort(
    (a, b) => (cuenta_por_ficha.get(b.id) || 0) - (cuenta_por_ficha.get(a.id) || 0)
  )[0];

  const { error } = await sb.from("seller").update({ user_id: cuenta.userId }).eq("id", elegida.id);
  if (error) throw new Error(`vincular la cuenta de vendedor: ${error.message}`);
  return { ...elegida, email: cuenta.email, nueva: true, ventas: cuenta_por_ficha.get(elegida.id) || 0 };
}

/** Un identificador de URL estable a partir del nombre de la empresa real. */
function slugify(text) {
  return String(text || "empresa")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    .slice(0, 40) || "empresa";
}

/**
 * La empresa hermana de demostración.
 *
 * Se busca por `slug`, que es determinista a partir del nombre de la real:
 * volver a ejecutar el sembrador encuentra la misma y no crea una segunda.
 *
 * `parent_org_id` la cuelga de la real —así se sabe de quién es—, pero
 * `tenant_org_id` apunta a SÍ MISMA: es la raíz de su propio inquilino, y eso es
 * lo que mantiene su información separada de la operación de verdad. Si apuntara
 * a la empresa real, la RLS dejaría ver una dentro de la otra, que es
 * exactamente lo que esta separación viene a evitar.
 */
async function ensureDemoOrg(realOrg) {
  const slug = `${slugify(realOrg.name)}-demo`;
  const { data: existing, error } = await sb.from("organizations").select("id").eq("slug", slug).maybeSingle();
  if (error) throw new Error(`organizations: ${error.message}`);
  if (existing?.id) return existing.id;

  const orgId = await insert("organizations", {
    kind: "tenant",
    name: `${realOrg.name} (Demostración)`,
    slug,
    legal_name: `${realOrg.name} (Demostración)`,
    company_type: "mixed_operator",
    parent_org_id: realOrg.id,
    email: OWNER_EMAIL,
    phone: "+1 809 555 2026",
    country: "República Dominicana",
    timezone: "America/Santo_Domingo",
    currency: "usd",
    subscription_status: "active",
    modules_enabled: ["bookings", "crm", "commissions", "settlements", "payments", "cash_pos", "transport", "pickups", "operations", "b2b_portal", "accounting", "reports", "audit"],
    status: "active",
    metadata: { demo: true, purpose: "client_presentations" },
  });
  const { error: updateError } = await sb.from("organizations").update({ tenant_org_id: orgId }).eq("id", orgId);
  if (updateError) throw new Error(`organizations tenant_org_id: ${updateError.message}`);
  return orgId;
}

/**
 * Vacía la empresa de demostración.
 *
 * El orden sale de `scripts/demo/tables.mjs` al revés: los hijos antes que los
 * padres. Antes era una lista escrita a mano AQUÍ, que es como se desincroniza —
 * se siembra una tabla nueva, nadie se acuerda de apuntarla en el borrado, y sus
 * filas sobreviven. Con `organization_id ... on delete restrict`, eso además
 * impide borrar la organización: la base lo rechaza mientras quede una fila.
 */
async function resetDemoData(orgId) {
  await sb.from("organization_relationships").delete().eq("from_org_id", orgId);
  await sb.from("organization_relationships").delete().eq("to_org_id", orgId);

  for (const table of TEARDOWN_TABLES) {
    const { error } = await sb.from(table).delete().eq("organization_id", orgId);
    // Una tabla que aún no existe en esta base no es un fallo del borrado.
    if (error && !/relation .* does not exist|Could not find the table|column .* does not exist/i.test(error.message)) {
      throw new Error(`reset ${table}: ${error.message}`);
    }
  }

  const { error: partnerError } = await sb.from("organizations").delete().eq("parent_org_id", orgId).eq("metadata->>demo", "true");
  if (partnerError) throw new Error(`reset demo partners: ${partnerError.message}`);
}

/** Borra la empresa de demostración entera, incluida la organización. */
async function removeDemoOrg(orgId, slug) {
  await resetDemoData(orgId);
  const { error: memErr } = await sb.from("organization_memberships").delete().eq("organization_id", orgId);
  if (memErr) throw new Error(`borrar membresías: ${memErr.message}`);
  const { error } = await sb.from("organizations").delete().eq("id", orgId);
  if (error) throw new Error(`borrar la empresa demo: ${error.message}`);

  /**
   * Y las cuentas de demostración con ella.
   *
   * Si se quedaran, quedarían tres usuarios con contraseña conocida y sin
   * ninguna empresa: hoy no ven nada, pero son credenciales válidas contra tu
   * proyecto de Supabase esperando a que alguien les dé una membresía por
   * error. Se borran por su correo, que es determinista a partir del slug.
   */
  let borradas = 0;
  for (const perfil of DEMO_USERS) {
    const email = demoEmail(perfil.suffix, slug);
    const user = await findUserByEmail(email);
    if (!user) continue;
    const { error: delErr } = await sb.auth.admin.deleteUser(user.id);
    if (delErr) {
      console.warn(`  No se pudo borrar ${email}: ${delErr.message}`);
      continue;
    }
    borradas++;
  }
  if (borradas > 0) console.log(`  ${borradas} cuenta(s) de demostración eliminada(s).`);
}

/** Lo que hay que enseñar al final, una sola vez. */
const CREDENCIALES = { cuentas: [], password: null };

const ROL_DEMO = {
  owner: "propietario — lo ve todo",
  seller: "vendedor — sin márgenes ni costes",
  operations: "operación — manifiestos y despacho",
};

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  }
  await ensureRuntimeColumns();

  const user = await findUserByEmail(OWNER_EMAIL);
  if (!user) throw new Error(`No existe el usuario ${OWNER_EMAIL} en Supabase Auth. Créalo primero.`);

  const realOrg = await realOrgOf(user.id);
  if (!realOrg) throw new Error(`${OWNER_EMAIL} no pertenece a ninguna empresa activa: no hay de qué derivar la demostración.`);

  const demoOrgId = await ensureDemoOrg(realOrg);

  if (ONLY_REMOVE) {
    await removeDemoOrg(demoOrgId, `${slugify(realOrg.name)}-demo`);
    console.log(`Empresa de demostración eliminada. «${realOrg.name}» queda como estaba.`);
    return;
  }

  const members = await membersOf(realOrg.id);
  await ensureMemberships(demoOrgId, members);
  console.log(`Empresa real: «${realOrg.name}» — ${members.length} persona(s) con acceso a la demostración.`);

  // Y las cuentas propias, para poder entregar una sin dar la tuya.
  const slug = `${slugify(realOrg.name)}-demo`;
  const clave = demoPassword();
  const cuentas = await ensureDemoUsers(demoOrgId, slug, clave.value);
  CREDENCIALES.cuentas = cuentas;
  CREDENCIALES.password = clave;

  const orgId = demoOrgId;
  if (RESET) await resetDemoData(orgId);

  const existingProducts = await maybeCount("product", { organization_id: orgId });
  if (existingProducts > 0 && !RESET) {
    // Ya hay catálogo: no se repite el cuerpo antiguo. Pero los módulos SÍ se
    // ejecutan, porque cada uno mira su propia tabla y siembra solo si está
    // vacía. Antes se salía aquí con un `return`, y eso hacía que una segunda
    // ejecución no llenara ninguno de los módulos nuevos — en silencio.
    console.log(`La empresa demo de «${realOrg.name}» ya tiene catálogo; se completan los módulos que falten.`);
    console.log("Para regenerarla entera: npm run seed:demo-presentation -- --reset\n");
    await correrModulos(sb, orgId, realOrg);
    await reportarVinculoVendedor(await linkDemoSeller(orgId, cuentas));
    await resumen(sb, orgId, realOrg);
    return;
  }

  /*
   * AQUÍ HABÍA DOS COSAS QUE NO DEBÍAN ESTAR, Y LAS DOS TOCABAN LA OPERACIÓN REAL.
   *
   * 1. `update({ is_primary: false }).eq("user_id", user.id)` sin más filtro:
   *    quitaba la marca de principal a TODAS las membresías de esa persona —su
   *    empresa de verdad incluida— y acto seguido se la ponía a la de
   *    demostración. Al entrar, se aterrizaba en la demo en vez de en la
   *    operación, y eso se descubre con un cliente delante.
   *
   * 2. `updateUserById(user.id, { app_metadata: { app_role: "owner", demo: true } })`
   *    marcaba la CUENTA REAL como de demostración y le reescribía el rol. Una
   *    cuenta no es de la empresa demo: es de la persona.
   *
   * Las membresías ya las resuelve `ensureMemberships` más arriba, para TODAS las
   * personas de la empresa y con `is_primary: false` siempre. Aquí no hace falta
   * nada más.
   */

  // El margen de la zona es el que heredan los hoteles que no tienen el suyo, y
  // de ahí sale la hora a la que pasa el transporte. La Romana está más lejos de
  // Punta Cana, así que se recoge antes.
  const zoneBavaro = await insert("zone", { organization_id: orgId, name: "Bávaro", color: "#0E7C86", pickup_offset_min: 75, status: "active" });
  const zoneRomana = await insert("zone", { organization_id: orgId, name: "La Romana", color: "#F97316", pickup_offset_min: 110, status: "active" });
  const branchId = await insert("branch", { organization_id: orgId, name: "Oficina Punta Cana", code: "PUJ", branch_type: "office", city: "Punta Cana", status: "active" });
  const cashRegisterId = await insert("cash_register", { organization_id: orgId, name: "Caja Recepción", code: "CJ-01", currency: "usd", status: "active" });
  const cashSessionId = await insert("cash_session", { organization_id: orgId, cash_register_id: cashRegisterId, user_id: user.id, opening_amount: 250, expected_cash: 1840, sales_total: 1590, status: "open" });

  const partnerId = await insert("organizations", { kind: "partner", parent_org_id: orgId, tenant_org_id: orgId, name: "Caribe Tour Center Demo", slug: "caribe-tour-center-demo", legal_name: "Caribe Tour Center Demo SRL", email: "reservas@caribedemo.test", phone: "+1 809 555 3000", country: "República Dominicana", currency: "usd", status: "active", metadata: { demo: true } });
  await insert("organization_relationships", { from_org_id: orgId, to_org_id: partnerId, relationship_type: "tour_center", default_commission_pct: 18, credit_limit: 15000, credit_days: 15, currency: "usd", status: "active" });

  const sellerA = await insert("seller", { organization_id: orgId, code: "V-101", first_name: "Marisol", last_name: "Peña", commission_pct: 5, max_discount_pct: 10, status: "active" });
  const sellerB = await insert("seller", { organization_id: orgId, code: "V-102", first_name: "Junior", last_name: "Castillo", commission_pct: 6, max_discount_pct: 7, status: "active" });
  const supplierId = await insert("supplier", { organization_id: orgId, name: "Transporte Turístico Demo", supplier_type: "transport", contact_name: "Operaciones", email: "ops@transportedemo.test", phone: "+1 809 555 4040", currency: "usd", payment_terms_days: 15, status: "active" });
  const guideId = await insert("staff", { organization_id: orgId, full_name: "Pedro Jiménez", staff_type: "guide", languages: ["es", "en"], daily_rate: 45, currency: "usd", status: "active" });
  await insert("staff", { organization_id: orgId, full_name: "Nathalie Duval", staff_type: "coordinator", languages: ["es", "en", "fr"], daily_rate: 60, currency: "usd", status: "active" });

  const hotelIds = [];
  for (const [i, h] of ["Barceló Bávaro Palace", "Meliá Punta Cana Beach", "Casa de Campo Resort", "Dreams Macao Beach"].entries()) {
    hotelIds.push(await insert("hotel", {
      organization_id: orgId, zone_id: i === 2 ? zoneRomana : zoneBavaro, name: h,
      address: "República Dominicana", category: "5_star", pickup_point: "Lobby principal",
      // El último se queda A PROPÓSITO sin margen propio: es el caso que enseña
      // que hereda el de su zona, que es lo que hace el campo utilizable cuando
      // hay doscientos hoteles cargados.
      pickup_offset_min: i === 3 ? null : 60 + i * 15,
      status: "active",
    }));
  }

  const policyId = await insert("cancellation_policy", { organization_id: orgId, name: "Flexible demo", description: "Cancelación gratis hasta 24 horas antes.", tiers: [{ hours_before: 24, refund_pct: 100 }, { hours_before: 6, refund_pct: 50 }], no_show_refund_pct: 0, status: "active" });
  const categoryId = await insert("product_category", { organization_id: orgId, name: "Excursiones", description: "Tours principales para demo", color: "#0E7C86", icon: "Palmtree", sort_order: 1, status: "active" });

  const productDefs = [
    ["SAONA", "Isla Saona Premium", 89, 42, "excursion"],
    ["BUGGY", "Buggies Macao", 54, 24, "excursion"],
    ["SUNSET", "Catamarán Sunset", 95, 38, "excursion"],
    ["TRF-PUJ", "Traslado privado PUJ", 45, 22, "transfer"],
  ];
  const products = [];
  for (const [i, [codeValue, name, price, cost, type]] of productDefs.entries()) {
    const productId = await insert("product", { organization_id: orgId, cancellation_policy_id: policyId, code: codeValue, name, description: `Producto demo: ${name}`, product_type: type, base_price: price, currency: "usd", sort_order: i + 1, status: "active" });
    const adultId = await insert("product_modality", { organization_id: orgId, product_id: productId, code: `${codeValue}-AD`, name: "Adulto", modality_type: "adult", price, currency: "usd", min_pax: 1, sort_order: 1, status: "active" });
    await insert("product_modality", { organization_id: orgId, product_id: productId, code: `${codeValue}-CH`, name: "Niño", modality_type: "child", price: Math.round(price * 0.55), currency: "usd", min_pax: 1, sort_order: 2, status: "active" });
    await insert("product_cost", { organization_id: orgId, product_id: productId, concept: "Costo operativo", cost_type: "per_person", amount: cost, currency: "usd", status: "active" });
    products.push({ productId, adultId, codeValue, price, cost, name });
  }

  const departures = [];
  for (const [i, p] of products.entries()) {
    for (const day of [-2, 0, 1, 3, 7]) {
      departures.push({ productId: p.productId, modalityId: p.adultId, price: p.price, cost: p.cost, id: await insert("departure", { organization_id: orgId, product_id: p.productId, departure_at: at(day, 8 + i, 0), capacity: i === 3 ? 8 : 45, booked_pax: 0, pending_pax: 0, cutoff_hours: 12, status: day < 0 ? "completed" : "available" }) });
    }
  }

  const customerIds = [];
  const customers = [
    ["Laura", "Gutiérrez", "España"], ["Michael", "Brennan", "Estados Unidos"], ["Sophie", "Laurent", "Francia"], ["Carlos", "Mendoza", "México"], ["Giulia", "Ferrari", "Italia"], ["Emma", "Thompson", "Reino Unido"],
  ];
  for (const [i, [first, last, country]] of customers.entries()) {
    customerIds.push(await insert("customer", { organization_id: orgId, first_name: first, last_name: last, email: `cliente${i + 1}@demo.havelgo.com`, phone: `+1 809 555 ${4100 + i}`, country, nationality: country, tags: ["demo"], source: i % 2 ? "web" : "walk_in", status: "active", notes: "Cliente de demostración." }));
  }

  const ruleId = await insert("commission_rule", { organization_id: orgId, name: "Comisión vendedores demo", beneficiary_type: "seller", calc_type: "percentage", value: 6, priority: 1, currency: "usd", status: "active" });

  let totalRevenue = 0;
  let totalCommission = 0;
  for (let i = 0; i < 12; i++) {
    const dep = departures[i % departures.length];
    const customerId = customerIds[i % customerIds.length];
    const pax = 1 + (i % 4);
    const total = Math.round(dep.price * pax * 100) / 100;
    const cost = Math.round(dep.cost * pax * 100) / 100;
    const paid = i % 5 === 0 ? Math.round(total * 0.5 * 100) / 100 : total;
    const sellerId = i % 2 ? sellerB : sellerA;
    const orderId = await insert("sales_order", { organization_id: orgId, order_number: code("ORD", i + 1), customer_id: customerId, seller_id: sellerId, partner_id: i % 3 === 0 ? partnerId : null, created_by: user.id, channel: i % 3 === 0 ? "b2b_portal" : "direct", status: paid >= total ? "paid" : "partially_paid", currency: "usd", subtotal: total, discount_total: 0, tax_total: 0, total, paid_total: paid, balance: total - paid, order_date: at(-i, 11, 0), notes: "Orden demo." });
    const bookingId = await insert("booking", { organization_id: orgId, booking_number: code("RSV", i + 1), order_id: orderId, customer_id: customerId, product_id: dep.productId, departure_id: dep.id, modality_id: dep.modalityId, seller_id: sellerId, partner_id: i % 3 === 0 ? partnerId : null, created_by: user.id, travel_date: at(i - 3, 8, 0), booking_date: at(-i, 10, 0), adults: pax, children: 0, infants: 0, pax_total: pax, gross_amount: total, discount_amount: 0, tax_amount: 0, total_amount: total, paid_amount: paid, balance_amount: total - paid, cost_amount: cost, margin_amount: total - cost, currency: "usd", channel: i % 3 === 0 ? "b2b_portal" : "direct", status: paid >= total ? "paid" : "partially_paid", checkin_status: i < 3 ? "done" : "pending", hotel_id: hotelIds[i % hotelIds.length] });
    await insert("participant", { organization_id: orgId, booking_id: bookingId, first_name: customers[i % customers.length][0], last_name: customers[i % customers.length][1], category: "adult", checkin_status: i < 3 ? "done" : "pending" });

    // La recogida, con su hotel. Sin esto el despacho no tiene nada que agrupar
    // y «Armar rutas del día» no enseña nada.
    //
    // `pickup_time` es lo PROMETIDO al cliente y va vacío casi siempre a
    // propósito: así el motor lo calcula y lo rellena, que es el caso normal.
    // A uno se le pone una hora distinta de la que saldrá, para que en la demo
    // se vea el aviso de desajuste —el cliente con un voucher que dice otra
    // cosa— que es justo lo que el sistema no debe pisar en silencio.
    await insert("pickup", {
      organization_id: orgId,
      booking_id: bookingId,
      hotel_id: hotelIds[i % hotelIds.length],
      pickup_time: i === 4 ? "06:45" : null,
      location: "Lobby principal",
      room: `${2 + (i % 6)}${String(10 + i).padStart(2, "0")}`,
      pax,
      status: i < 3 ? "confirmed" : "pending",
    });
    await insert("voucher", { organization_id: orgId, booking_id: bookingId, order_id: orderId, code: code("VCH", i + 1), qr_data: code("VCH", i + 1), status: "valid", expires_at: at(30) });
    await insert("payment", { organization_id: orgId, order_id: orderId, booking_id: bookingId, customer_id: customerId, partner_id: i % 3 === 0 ? partnerId : null, cash_session_id: cashSessionId, user_id: user.id, reference: code("PAY", i + 1), payment_type: "payment", method: i % 4 === 0 ? "card" : "cash", status: "completed", amount: paid, currency: "usd", exchange_rate: 1, base_amount: paid, paid_at: at(-i, 12, 0), notes: "Pago demo." });
    const commissionAmount = Math.round(total * 0.06 * 100) / 100;
    await insert("commission", { organization_id: orgId, booking_id: bookingId, order_id: orderId, rule_id: ruleId, seller_id: sellerId, partner_id: i % 3 === 0 ? partnerId : null, beneficiary_type: "seller", calc_type: "percentage", base_amount: total, percentage: 6, amount: commissionAmount, currency: "usd", status: i < 6 ? "approved" : "pending", snapshot: { demo: true } });
    totalRevenue += total;
    totalCommission += commissionAmount;
  }

  /**
   * LA LISTA DE ESPERA (0066).
   *
   * Sin esto la ola 11 no tendría nada que enseñar. Se siembra la historia
   * entera, que es lo que hace entendible el módulo de un vistazo: alguien
   * esperando, alguien con la plaza ya apartada y a quien hay que llamar, y
   * alguien que acabó comprando —que es el número que dice si la lista sirve—.
   */
  // Las salidas se crean por producto y día en el orden [-2, 0, 1, 3, 7], así
  // que la tercera del primer producto cae DENTRO DE DOS DÍAS: una cola tiene
  // que colgar de una salida que todavía puede ocurrir.
  const salidaLlena = departures[3];
  if (salidaLlena) {
    // Y llena de verdad, que es lo que explica por qué hay gente esperando.
    await sb.from("departure")
      .update({ capacity: 12, booked_pax: 12, pending_pax: 0, available_pax: 0, status: "full" })
      .eq("id", salidaLlena.id);
    const esperas = [
      { name: "Familia Rodríguez", phone: "+1 809 555 0111", pax: 5, status: "waiting",
        notes: "Se alojan en el Barceló, llegan el jueves." },
      { name: "Anke Weber", phone: "+49 170 555 0122", pax: 2, status: "waiting",
        notes: "Habla alemán, prefiere guía en inglés." },
      { name: "Tom Sullivan", phone: "+1 617 555 0133", pax: 2, status: "offered",
        notes: "Aceptó por teléfono, pendiente de cobrar." },
      { name: "Chiara Bruno", phone: "+39 340 555 0144", pax: 3, status: "converted",
        notes: "Entró por lista de espera y pagó el mismo día." },
    ];
    for (const [i, e] of esperas.entries()) {
      await insert("waitlist_entry", {
        organization_id: orgId,
        departure_id: salidaLlena.id,
        contact_name: e.name,
        contact_phone: e.phone,
        seller_id: i % 2 ? sellerB : sellerA,
        pax: e.pax,
        status: e.status,
        // La que tiene plaza apartada lleva su plazo: es lo que el mostrador
        // mira para saber a quién llamar primero.
        offered_at: e.status === "offered" ? at(0, 9, 0) : null,
        offer_expires_at: e.status === "offered" ? at(1, 9, 0) : null,
        notes: e.notes,
      });
    }
  }

  await insert("settlement", { organization_id: orgId, code: "LIQ-DEMO-001", beneficiary_type: "seller", seller_id: sellerA, period_from: dateOnly(-15), period_to: dateOnly(0), base_total: Math.round(totalRevenue / 2), commission_total: Math.round(totalCommission / 2), paid_total: 0, pending_total: Math.round(totalCommission / 2), currency: "usd", status: "approved", approved_by: user.id });
  await insert("receivable", { organization_id: orgId, document_number: "CXC-DEMO-001", amount: 980, paid_amount: 250, balance: 730, currency: "usd", issue_date: dateOnly(-8), due_date: dateOnly(7), status: "partially_paid" });
  await insert("payable", { organization_id: orgId, reference: "FACT-DEMO-001", category: "transport", amount: 1450, paid_amount: 0, balance: 1450, currency: "usd", issue_date: dateOnly(-10), due_date: dateOnly(5), status: "pending" });

  for (const [i, title] of ["Confirmar pickup de Saona", "Revisar caja del turno", "Preparar liquidación de vendedores", "Actualizar disponibilidad del fin de semana", "Llamar cliente VIP"].entries()) {
    await insert("task", { organization_id: orgId, title, description: "Tarea de demostración para presentación comercial.", status: i === 1 ? "in_progress" : "todo", priority: i < 2 ? "high" : "medium", due_at: at(i, 15, 0), task_type: i === 2 ? "finance" : "operational", source: "manual", assigned_to_id: user.id, created_by: user.id });
  }
  // Tarea ya vencida y tarea sin fecha: los dos casos límite de "Mi día".
  await insert("task", { organization_id: orgId, title: "Reponer inventario de la tienda", description: "Quedó pendiente del cierre anterior.", status: "todo", priority: "urgent", due_at: at(-2, 10, 0), task_type: "operational", source: "manual", assigned_to_id: user.id, created_by: user.id });
  await insert("task", { organization_id: orgId, title: "Revisar plan de mantenimiento anual", description: "Sin fecha de vencimiento definida.", status: "todo", priority: "medium", due_at: null, task_type: "maintenance", source: "manual", assigned_to_id: user.id, created_by: user.id });

  // `requires_two` es un booleano real (columna boolean en 0009), nunca "yes"/"no".
  await insert("approval_request", { organization_id: orgId, code: "AP-DEMO-001", action_type: "discount_over_limit", status: "pending", requested_at: at(-1, 9, 30), expires_at: at(2), amount: 120, currency: "usd", reason: "Cliente corporativo solicita descuento especial para grupo.", payload: { discount_pct: 18 }, requires_two: false, requested_by: null });
  // Doble firma pendiente de la segunda persona.
  await insert("approval_request", { organization_id: orgId, code: "AP-DEMO-002", action_type: "payout", status: "pending", requested_at: at(-2, 11, 0), expires_at: at(5), amount: 1800, currency: "usd", reason: "Pago mensual a la red de vendedores.", payload: {}, requires_two: true, requested_by: null });
  // Expirada: no debe contarse como pendiente ni aparecer como aprobable.
  await insert("approval_request", { organization_id: orgId, code: "AP-DEMO-003", action_type: "refund", status: "pending", requested_at: at(-10, 9, 0), expires_at: at(-3), amount: 340, currency: "usd", reason: "Reembolso solicitado fuera de plazo.", payload: {}, requires_two: false, requested_by: null });
  await insert("notification", { organization_id: orgId, user_id: user.id, title: "Bienvenido a la demo", message: "Este tenant contiene datos preparados para presentar Havelgo a clientes.", notification_type: "info", link: "/dashboard", read_status: false });

  await correrModulos(sb, orgId, realOrg);

  // Después de sembrar las ventas: la ficha que se vincula es la que más tiene.
  await reportarVinculoVendedor(await linkDemoSeller(orgId, cuentas));

  await resumen(sb, orgId, realOrg);
}

/** Deja dicho en pantalla con qué vendedor entra la cuenta de demostración. */
async function reportarVinculoVendedor(vinculo) {
  if (!vinculo) {
    console.log("⚠ No se pudo vincular la cuenta de vendedor a ninguna ficha: esa cuenta verá solo las ventas sin vendedor asignado.");
    return;
  }
  const nombre = [vinculo.first_name, vinculo.last_name].filter(Boolean).join(" ");
  console.log(`Cuenta de vendedor (${vinculo.email}) → ficha «${nombre}»${vinculo.nueva ? "" : " (ya estaba vinculada)"}.`);
}

/**
 * Ejecuta los módulos de siembra.
 *
 * Vive fuera de `main` porque se usa en los DOS caminos: la primera siembra y la
 * de una empresa que ya tenía catálogo. Antes solo estaba en el primero, y
 * volver a ejecutar el sembrador dejaba los módulos nuevos sin tocar, sin decir
 * nada.
 */
async function correrModulos(sb, orgId, realOrg) {
  const h = helpers(sb, orgId);
  for (const [nombre, seed] of MODULOS) {
    try {
      const hecho = await seed(h);
      const puestas = Object.entries(hecho).filter(([, n]) => n > 0);
      console.log(`  · ${nombre}: ${puestas.map(([t, n]) => `${t} ${n}`).join(", ") || "ya tenía datos"}`);
    } catch (err) {
      // Un módulo que falla no puede llevarse por delante a los demás: vale más
      // una demostración con cinco módulos llenos y uno vacío que una que se cae
      // a mitad y deja la empresa en un estado que nadie sabe interpretar.
      console.error(`  ✗ ${nombre}: ${err.message}`);
    }
  }
}

/**
 * El resumen se CUENTA, no se recita.
 *
 * Antes decía «Productos: 4, Reservas: 12» escrito a mano. En cuanto el
 * sembrador cambia, ese resumen miente — y lo peor de un resumen que miente es
 * que se usa para decidir que la demostración está lista.
 */
async function resumen(sb, orgId, realOrg) {
  console.log(`\n✅ Demostración lista para «${realOrg.name}»\n`);
  const filas = [];
  for (const table of SEED_TABLES) {
    const { count, error } = await sb
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId);
    if (!error && (count ?? 0) > 0) filas.push([table, count]);
  }
  const ancho = Math.max(...filas.map(([t]) => t.length), 10);
  for (const [table, n] of filas) console.log(`  ${table.padEnd(ancho)}  ${n}`);
  console.log(`\n  ${filas.length} de ${SEED_TABLES.length} tablas con datos.`);
  console.log(`\n  Entra con ${OWNER_EMAIL} y cambia a «${realOrg.name} (Demostración)» en el selector de empresa,`);
  console.log("  arriba a la izquierda. Mientras estés dentro, una banda azul te lo recuerda en cada pantalla.");

  if (CREDENCIALES.cuentas.length > 0) {
    console.log("\n  ── Cuentas de demostración ───────────────────────────────────────");
    console.log("  Para entregar. Solo ven la empresa de demostración; tu operación");
    console.log("  real no existe para ellas.\n");
    const ancho = Math.max(...CREDENCIALES.cuentas.map((c) => c.email.length));
    for (const c of CREDENCIALES.cuentas) {
      console.log(`    ${c.email.padEnd(ancho)}   ${ROL_DEMO[c.role] ?? c.role}${c.nuevo ? "" : "  (ya existía)"}`);
    }
    if (CREDENCIALES.password?.generated) {
      /**
       * Se imprime UNA vez y no se guarda en ningún sitio.
       *
       * Quien la necesite después vuelve a ejecutar el sembrador, que repone la
       * contraseña de las tres. Guardarla en un archivo sería dejar una
       * credencial válida contra una base real esperando a que alguien la
       * encuentre.
       */
      console.log(`\n    Contraseña (se enseña AHORA y no se guarda): ${CREDENCIALES.password.value}`);
      console.log("    Para fijar una tuya: DEMO_USER_PASSWORD=… npm run seed:demo-presentation");
    } else {
      console.log("\n    Contraseña: la de DEMO_USER_PASSWORD.");
    }
  }

  console.log("\n  Tu empresa real no se ha tocado. Para borrar la demo: npm run seed:demo-presentation -- --remove\n");
}

main().catch((error) => {
  console.error("❌ Seed demo failed:", error.message);
  process.exit(1);
});
