#!/usr/bin/env node
/**
 * ¿POR QUÉ NO ENTRA ESTA CUENTA?
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PARA QUÉ EXISTE
 *
 * La pantalla de acceso contesta lo mismo a tres cosas distintas —la cuenta no
 * existe, la contraseña no es esa, la cuenta quedó en otro proyecto— y hace bien
 * en no distinguirlas: si lo hiciera, el formulario serviría para averiguar qué
 * correos existen.
 *
 * Pero quien administra SÍ necesita saberlo, y hasta ahora la única forma era
 * abrir el panel de Supabase y mirar tabla por tabla. Este comprobador lo hace
 * de una vez, con credenciales, desde la línea de comandos: dice si la cuenta
 * está en ESTE proyecto, si su email está confirmado, si está bloqueada, y a qué
 * empresas pertenece con qué rol — que es lo que decide dónde aterriza.
 *
 * SOLO LEE. Nada de lo que hace cambia una fila. Un comprobador que además
 * escribe es un comprobador que nadie se atreve a ejecutar cuando hace falta.
 * Para arreglar lo que encuentre está `scripts/migrate/onboard-user.mjs`, que
 * dice en su salida cuál es la orden exacta.
 *
 * Uso:
 *   npm run check:account -- --email=persona@empresa.com
 *
 * Requiere NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.
 * Salida segura: no imprime contraseñas, tokens ni identificadores de sesión.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

for (const envFile of [".env", `.env.${process.env.NODE_ENV || "development"}`, ".env.local"]) {
  const envPath = path.resolve(process.cwd(), envFile);
  if (!fs.existsSync(envPath)) continue;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([a-z-]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] ?? true;
}

function fail(msg) { console.error(`✗ ${msg}`); process.exit(1); }

const email = typeof args.email === "string" ? args.email.trim().toLowerCase() : "";
if (!email || !email.includes("@")) {
  fail("Falta --email. Uso: npm run check:account -- --email=persona@empresa.com");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) fail("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.");

/**
 * La referencia del proyecto (el `abcdefgh` de `abcdefgh.supabase.co`) no es un
 * secreto —viaja en cada petición del navegador— y es justo el dato que
 * distingue «la cuenta no existe» de «la cuenta está en el otro proyecto».
 */
const projectRef = (() => {
  try { return new URL(url).hostname.split(".")[0]; } catch { return "(url ilegible)"; }
})();

const sb = createClient(url, key, { auth: { persistSession: false } });

async function findUser(target) {
  for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const users = data?.users ?? [];
    const found = users.find((u) => u.email?.toLowerCase() === target);
    if (found) return found;
    if (users.length < 200) return null;
  }
}

const fecha = (v) => (v ? new Date(v).toISOString().replace("T", " ").slice(0, 16) : "—");

async function main() {
  console.log("── Comprobación de cuenta ──");
  console.log(`  proyecto Supabase : ${projectRef}`);
  console.log(`  cuenta            : ${email}\n`);

  const user = await findUser(email);

  if (!user) {
    console.log("✗ Esa cuenta NO existe en este proyecto de Supabase.");
    console.log("\n  Es el caso que la pantalla de acceso no puede distinguir de una");
    console.log("  contraseña equivocada. Si la cuenta funcionaba antes, lo más probable");
    console.log("  es que viviera en otro proyecto (una migración, o un entorno distinto).");
    console.log("\n  Para crearla aquí, con su empresa y su rol:");
    console.log(`    node scripts/migrate/onboard-user.mjs --email=${email} \\`);
    console.log("      --org=<slug-de-la-empresa> --role=owner --password='<clave>'");
    console.log("\n  Y para las cuentas de demostración, que se crean solas:");
    console.log("    npm run seed:demo-presentation");
    process.exit(2);
  }

  console.log("✓ La cuenta existe en este proyecto.");
  console.log(`  creada            : ${fecha(user.created_at)}`);
  console.log(`  último acceso     : ${fecha(user.last_sign_in_at)}`);

  const problemas = [];

  if (!user.email_confirmed_at && !user.confirmed_at) {
    console.log("  email confirmado  : NO");
    problemas.push(
      "El email no está confirmado. Mientras lo esté, el acceso se rechaza aunque\n" +
      "  la contraseña sea correcta. Se confirma volviendo a fijar la contraseña:\n" +
      `    node scripts/migrate/onboard-user.mjs --email=${email} --org=<slug> --role=<rol> --password='<clave>'`
    );
  } else {
    console.log(`  email confirmado  : sí (${fecha(user.email_confirmed_at || user.confirmed_at)})`);
  }

  if (user.banned_until && new Date(user.banned_until) > new Date()) {
    console.log(`  bloqueada hasta   : ${fecha(user.banned_until)}`);
    problemas.push("La cuenta está bloqueada. Se levanta desde el panel de Auth de Supabase.");
  }

  const tienePassword = Array.isArray(user.identities)
    ? user.identities.some((i) => i.provider === "email")
    : null;
  if (tienePassword === false) {
    console.log("  acceso por clave  : NO (la cuenta no tiene identidad de email)");
    problemas.push(
      "La cuenta existe pero no tiene contraseña: se creó por invitación o por otro\n" +
      "  proveedor. Hasta que se le fije una, entrar por el formulario es imposible."
    );
  }

  // ── Las empresas ──────────────────────────────────────────────────────────
  const { data: memberships, error: memError } = await sb
    .from("organization_memberships")
    .select("organization_id, role, status, is_primary")
    .eq("user_id", user.id);
  if (memError) throw new Error(`organization_memberships: ${memError.message}`);

  console.log("\n── Empresas ──");
  if (!memberships?.length) {
    console.log("  ninguna.");
    problemas.push(
      "Sin membresía activa, el hook del token no inyecta `org_id` y la sesión se\n" +
      "  abre sin empresa: con RLS activa no se ve absolutamente nada. Se arregla con\n" +
      `    node scripts/migrate/onboard-user.mjs --email=${email} --org=<slug> --role=<rol>`
    );
  } else {
    const ids = memberships.map((m) => m.organization_id);
    const { data: orgs, error: orgError } = await sb
      .from("organizations").select("id, name, slug, status, kind").in("id", ids);
    if (orgError) throw new Error(`organizations: ${orgError.message}`);
    const porId = new Map((orgs ?? []).map((o) => [o.id, o]));

    for (const m of memberships) {
      const o = porId.get(m.organization_id);
      const marca = m.is_primary ? "★" : " ";
      const nombre = o ? `${o.name} (${o.slug})` : `«empresa ausente: ${m.organization_id}»`;
      console.log(`  ${marca} ${nombre}`);
      console.log(`      rol=${m.role} · membresía=${m.status}${o ? ` · empresa=${o.status} · tipo=${o.kind}` : ""}`);
      if (!o) {
        problemas.push("Hay una membresía que apunta a una empresa que ya no existe.");
      } else if (o.status !== "active" && m.status === "active") {
        problemas.push(`La empresa «${o.name}» no está activa (${o.status}).`);
      }
    }

    const activas = memberships.filter((m) => m.status === "active");
    if (!activas.length) {
      problemas.push("Ninguna membresía está activa: entra, pero no ve nada.");
    } else if (!activas.some((m) => m.is_primary)) {
      problemas.push(
        "Ninguna membresía activa es la primaria. El hook elige con\n" +
        "  `order by is_primary desc … limit 1`, así que la empresa de aterrizaje\n" +
        "  queda al azar del orden de la base."
      );
    }
    console.log("\n  ★ = empresa de aterrizaje. Las demás se alcanzan con el selector de empresa.");
  }

  // ── Veredicto ─────────────────────────────────────────────────────────────
  console.log("\n── Veredicto ──");
  if (!problemas.length) {
    console.log("  Nada impide el acceso desde este lado.");
    console.log("  Si aun así el formulario lo rechaza, lo que falla es la CONTRASEÑA.");
    console.log("  Se repone sin tocar nada más:");
    console.log(`    node scripts/migrate/onboard-user.mjs --email=${email} --org=<slug> --role=<rol> --password='<clave>'`);
    console.log("\n  Ojo: ese script pone esa empresa como primaria y quita la marca a las");
    console.log("  demás. Pasa el slug de la empresa donde quieres que aterrice.");
    return;
  }
  for (const p of problemas) console.log(`  ✗ ${p}`);
  process.exit(2);
}

main().catch((e) => { console.error(`\n✗ La comprobación falló: ${e.message}`); process.exit(1); });
