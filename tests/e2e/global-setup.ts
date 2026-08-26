import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Playwright global setup — deja el proyecto Supabase de CI en un estado en el
 * que la prueba real de login puede pasar, sin depender de datos sembrados a
 * mano.
 *
 * El E2E inicia sesión con E2E_EMAIL/E2E_PASSWORD y navega a Mi día. El layout
 * del dashboard rebota a /login si el usuario no tiene una membresía activa
 * (getTenantContext → null cuando el access-token hook no encuentra org_id).
 * Cuando se re-corren las migraciones, `organization_memberships` se vacía y el
 * usuario de pruebas pierde su membresía → el login "funciona" pero la app lo
 * expulsa. Aquí, con el SERVICE_ROLE que el step de CI ya expone, se garantiza
 * de forma idempotente:
 *   1) el usuario Auth existe, con contraseña conocida y email confirmado,
 *   2) una organización tenant dedicada al E2E,
 *   3) una membresía owner, activa y primaria → el hook inyecta org_id.
 *
 * Sin las variables necesarias no siembra nada (el propio spec hace skip cuando
 * faltan E2E_EMAIL/E2E_PASSWORD), así que en local sigue siendo inofensivo.
 */

const E2E_ORG_SLUG = "e2e-tenant";

// El tipo del Admin API de Supabase resuelve `data.users` de forma inestable
// según skipLibCheck (el type-check del build de Next lo ve como `never`), así
// que se usa una forma mínima y explícita en vez de la inferida.
type AuthUserLite = { id: string; email?: string | null };

async function ensureUser(sb: SupabaseClient, email: string, password: string): Promise<string> {
  // El Admin API no tiene getByEmail, así que se pagina la lista.
  for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const users = (data?.users ?? []) as AuthUserLite[];
    const found = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) {
      const { error: upErr } = await sb.auth.admin.updateUserById(found.id, {
        password,
        email_confirm: true,
      });
      if (upErr) throw new Error(`updateUser: ${upErr.message}`);
      return found.id;
    }
    if (users.length < 200) break;
  }
  const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
  const created = data?.user as AuthUserLite | null | undefined;
  if (error || !created) throw new Error(`createUser: ${error?.message ?? "sin usuario"}`);
  return created.id;
}

async function ensureOrg(sb: SupabaseClient): Promise<string> {
  const { data: existing, error } = await sb
    .from("organizations").select("id").eq("slug", E2E_ORG_SLUG).maybeSingle();
  if (error) throw new Error(`load org: ${error.message}`);
  if (existing?.id) return existing.id as string;

  const { data: created, error: createErr } = await sb
    .from("organizations")
    .insert({
      kind: "tenant",
      name: "E2E Tenant",
      slug: E2E_ORG_SLUG,
      legal_name: "E2E Tenant",
      company_type: "other",
      subscription_status: "active",
      modules_enabled: [],
      status: "active",
      metadata: { system: true, purpose: "e2e" },
    })
    .select("id")
    .single();
  if (createErr || !created) throw new Error(`create org: ${createErr?.message ?? "sin org"}`);

  // tenant_org_id apunta a sí misma: es la raíz del tenant que usa el hook.
  const { error: selfErr } = await sb
    .from("organizations").update({ tenant_org_id: created.id }).eq("id", created.id);
  if (selfErr) throw new Error(`finalize org: ${selfErr.message}`);
  return created.id as string;
}

async function ensureMembership(sb: SupabaseClient, userId: string, orgId: string): Promise<void> {
  // El hook elige la membresía primaria: se limpia cualquier otra para que
  // quede determinista en la org del E2E.
  const { error: clearErr } = await sb
    .from("organization_memberships")
    .update({ is_primary: false })
    .eq("user_id", userId)
    .neq("organization_id", orgId);
  if (clearErr) throw new Error(`clear primaries: ${clearErr.message}`);

  const { data: existing, error } = await sb
    .from("organization_memberships")
    .select("id").eq("user_id", userId).eq("organization_id", orgId).maybeSingle();
  if (error) throw new Error(`load membership: ${error.message}`);

  if (existing?.id) {
    const { error: upErr } = await sb
      .from("organization_memberships")
      .update({ role: "owner", status: "active", is_primary: true })
      .eq("id", existing.id);
    if (upErr) throw new Error(`update membership: ${upErr.message}`);
  } else {
    const { error: insErr } = await sb
      .from("organization_memberships")
      .insert({ user_id: userId, organization_id: orgId, role: "owner", status: "active", is_primary: true });
    if (insErr) throw new Error(`insert membership: ${insErr.message}`);
  }
}

async function globalSetup(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;

  // El spec ya hace skip sin E2E_EMAIL/E2E_PASSWORD; sin el service role no se
  // puede sembrar, así que se deja el entorno intacto en vez de fallar.
  if (!url || !serviceKey || !email || !password) {
    console.log("[e2e setup] Env de Supabase incompleto — se omite el seeding de la cuenta de prueba.");
    return;
  }

  const sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  const userId = await ensureUser(sb, email, password);
  const orgId = await ensureOrg(sb);
  await ensureMembership(sb, userId, orgId);
  console.log(`[e2e setup] Cuenta de prueba lista con membresía owner activa (org '${E2E_ORG_SLUG}').`);
}

export default globalSetup;
