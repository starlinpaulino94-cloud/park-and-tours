import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Playwright global setup — deja el proyecto Supabase en un estado en el que la
 * prueba real de login puede pasar, sin depender de datos sembrados a mano.
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
 * ──────────────────────────────────────────────────────────────────────────────
 * Y UNA CUENTA DE PERSONA NO SE TOCA. NUNCA.
 *
 * Esto se aprendió caro. `E2E_EMAIL` apuntaba a una cuenta de demostración que
 * alguien usaba, y este arranque hacía dos cosas en cada ejecución de CI:
 *
 *   · le REESCRIBÍA la contraseña con `E2E_PASSWORD`, así que la persona
 *     tecleaba la suya —correcta— y el formulario la rechazaba;
 *   · le movía la membresía primaria a la organización del E2E, así que aunque
 *     entrara aterrizaba en un inquilino de pruebas vacío.
 *
 * Las dos en silencio, cada vez que alguien abría un PR. Desde fuera parecía una
 * contraseña mal tecleada y no había forma de verlo: el efecto lo causaba algo
 * que ni siquiera estaba pasando en ese momento.
 *
 * Así que ahora esto sólo opera sobre una cuenta que sea EXCLUSIVAMENTE del
 * E2E. Si la cuenta pertenece a alguna otra empresa, el arranque falla y dice
 * qué hacer, en vez de apropiársela. Un E2E en rojo cuesta una ejecución de CI;
 * apropiarse de una cuenta cuesta que alguien no pueda trabajar sin entender
 * por qué.
 *
 * Sin las variables necesarias no siembra nada (el propio spec hace skip cuando
 * faltan E2E_EMAIL/E2E_PASSWORD), así que en local sigue siendo inofensivo.
 */


/**
 * ────────────────────────────────────────────────────────────────────────────
 * Y NO ESCRIBE EN UNA BASE QUE NO SEA DESECHABLE. NUNCA.
 *
 * Lo de arriba impide apropiarse de la cuenta de una PERSONA. Esto impide algo
 * más gordo: escribir en el proyecto de Supabase DE VERDAD.
 *
 * Durante meses este arranque corrió contra producción. Creaba y mantenía la
 * empresa `e2e-tenant` en la base real, con una llave de servicio, en cada pull
 * request. Acotarlo con cuidado no arregla la categoría del problema: mientras
 * el CI tenga una llave de servicio sobre la operación de verdad, cualquier
 * fallo —un filtro mal escrito, una prueba nueva que limpia más de la cuenta—
 * escribe en los datos del negocio, y de ahí no se vuelve con un `git revert`.
 *
 * Ahora el CI levanta su propia pila local (ver `supabase/config.toml`), y esto
 * comprueba que el destino es una base desechable antes de tocar nada. La
 * comprobación vive aquí y no solo en el fichero del CI a propósito: un día
 * alguien cambiará el CI, y esto seguirá puesto.
 */

/** Anfitriones que solo pueden ser una pila local y efímera. */
const ANFITRIONES_DESECHABLES = new Set([
  "localhost", "127.0.0.1", "0.0.0.0", "::1",
  // El nombre del contenedor cuando el E2E corre dentro de la red de Docker.
  "host.docker.internal", "kong", "supabase_kong_park-and-tours",
]);

export type DestinoE2E = "desechable" | "remoto_permitido" | "remoto_prohibido" | "ilegible";

/**
 * ¿Se puede escribir en este destino?
 *
 * Denegar por defecto: lo que no se reconozca como local se trata como la base
 * de alguien. Una URL ilegible tampoco pasa — si no se sabe a dónde apunta, no
 * se escribe.
 *
 * `E2E_ALLOW_REMOTE` es la salida deliberada para quien de verdad quiera correr
 * contra un proyecto de pruebas remoto. Tiene que escribirla una persona a
 * propósito; nada la pone sola.
 */
export function clasificarDestino(url: string | undefined, permitirRemoto?: string): DestinoE2E {
  let anfitrion: string;
  try {
    anfitrion = new URL(String(url)).hostname.toLowerCase();
  } catch {
    return "ilegible";
  }
  if (!anfitrion) return "ilegible";
  if (ANFITRIONES_DESECHABLES.has(anfitrion)) return "desechable";
  return String(permitirRemoto).toLowerCase() === "true" ? "remoto_permitido" : "remoto_prohibido";
}

export function mensajeDestinoProhibido(url: string | undefined, destino: DestinoE2E): string {
  const que = destino === "ilegible"
    ? `NEXT_PUBLIC_SUPABASE_URL no es una URL legible (${url ?? "vacía"})`
    : `NEXT_PUBLIC_SUPABASE_URL apunta a un proyecto remoto (${url})`;
  return (
    `${que}.\n\n` +
    "El arranque del E2E CREA empresas, CREA usuarios y REESCRIBE contraseñas con " +
    "la llave de servicio. Contra el proyecto de verdad, eso escribe en los datos " +
    "del negocio en cada pull request — que es exactamente de donde viene esta " +
    "comprobación.\n\n" +
    "El CI levanta su propia pila con `supabase start` (ver supabase/config.toml) " +
    "y apunta aquí a http://127.0.0.1:54321.\n\n" +
    "Si de verdad quieres correr contra un proyecto remoto DESECHABLE —nunca el " +
    "de producción—, ponle E2E_ALLOW_REMOTE=true a propósito."
  );
}

/**
 * Los números de venta que el spec busca en pantalla.
 *
 * Viven aquí y se exportan para que la prueba no pueda buscar una cadena
 * distinta de la que se sembró: dos literales iguales en dos ficheros acaban
 * divergiendo, y una prueba que busca algo que no existe pasa siempre.
 */
export const ORDEN_PROPIA = "E2E-MIA-001";
export const ORDEN_AJENA = "E2E-AJENA-002";
export const E2E_SELLER_SUFFIX = "vendedor";

const E2E_ORG_SLUG = "e2e-tenant";

// El tipo del Admin API de Supabase resuelve `data.users` de forma inestable
// según skipLibCheck (el type-check del build de Next lo ve como `never`), así
// que se usa una forma mínima y explícita en vez de la inferida.
type AuthUserLite = { id: string; email?: string | null };

/** Busca sin escribir. Lo que se escriba se decide después de comprobar. */
async function findUser(sb: SupabaseClient, email: string): Promise<string | null> {
  // El Admin API no tiene getByEmail, así que se pagina la lista.
  for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const users = (data?.users ?? []) as AuthUserLite[];
    const found = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return found.id;
    if (users.length < 200) return null;
  }
}

async function createUser(sb: SupabaseClient, email: string, password: string): Promise<string> {
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

/**
 * La comprobación que impide apropiarse de la cuenta de alguien.
 *
 * Va ANTES de cualquier escritura sobre el usuario: comprobar después de
 * reescribir la contraseña no comprueba nada.
 */
async function assertExclusivoDelE2E(sb: SupabaseClient, userId: string, orgId: string, email: string) {
  const { data, error } = await sb
    .from("organization_memberships")
    .select("organization_id")
    .eq("user_id", userId)
    .neq("organization_id", orgId);
  if (error) throw new Error(`load memberships: ${error.message}`);
  if (!data?.length) return;

  const ids = data.map((m) => m.organization_id as string);
  const { data: orgs, error: orgErr } = await sb
    .from("organizations").select("name, slug").in("id", ids);
  if (orgErr) throw new Error(`load orgs: ${orgErr.message}`);
  const nombres = (orgs ?? []).map((o) => `${o.name}${o.slug ? ` (${o.slug})` : ""}`);

  throw new Error(
    `E2E_EMAIL (${email}) pertenece a ${data.length} empresa(s) además de '${E2E_ORG_SLUG}': ` +
    `${nombres.join(", ")}.\n\n` +
    "Este arranque REESCRIBE la contraseña de esa cuenta y le mueve la empresa de " +
    "aterrizaje en cada ejecución. Sobre una cuenta que usa una persona, eso hace " +
    "que su contraseña correcta deje de funcionar sin que nada lo explique.\n\n" +
    "Usa una dirección dedicada al E2E, que no pertenezca a ninguna empresa real " +
    "—por ejemplo e2e@e2e.invalid— y ponla en el secreto E2E_EMAIL. Este arranque " +
    "la crea sola la primera vez."
  );
}

async function ensureMembership(
  sb: SupabaseClient,
  userId: string,
  orgId: string,
  role: "owner" | "seller" = "owner"
): Promise<void> {
  // El hook elige la membresía primaria. Tras la comprobación de arriba, la
  // cuenta no tiene otras empresas, así que esto ya no le quita la marca a
  // nadie: queda por si una ejecución anterior dejó algo a medias.
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
      .update({ role, status: "active", is_primary: true })
      .eq("id", existing.id);
    if (upErr) throw new Error(`update membership: ${upErr.message}`);
  } else {
    const { error: insErr } = await sb
      .from("organization_memberships")
      .insert({ user_id: userId, organization_id: orgId, role, status: "active", is_primary: true });
    if (insErr) throw new Error(`insert membership: ${insErr.message}`);
  }
}

/**
 * LAS PIEZAS QUE NECESITA LA PRUEBA DE AISLAMIENTO DEL VENDEDOR.
 *
 * Dos fichas de vendedor y una venta de cada una. Con una sola no se prueba
 * nada: el aislamiento consiste en NO ver lo del otro, y para eso tiene que
 * existir un otro. La venta ajena lleva un número reconocible para que el spec
 * pueda afirmar que no aparece por ninguna parte de la pantalla.
 *
 * Es idempotente: busca antes de insertar, porque el CI corre esto en cada
 * ejecución sobre la misma base local.
 */
async function ensureSellerFixtures(
  sb: SupabaseClient,
  orgId: string,
  sellerUserId: string
): Promise<void> {
  async function ficha(code: string, firstName: string, userId: string | null): Promise<string> {
    const { data: existente } = await sb
      .from("seller").select("id").eq("organization_id", orgId).eq("code", code).maybeSingle();
    if (existente?.id) {
      // El vínculo puede haberse perdido si se re-corrieron las migraciones.
      await sb.from("seller").update({ user_id: userId }).eq("id", existente.id);
      return existente.id as string;
    }
    const { data, error } = await sb
      .from("seller")
      .insert({
        organization_id: orgId, code, first_name: firstName, last_name: "E2E",
        user_id: userId, status: "active", commission_pct: 5, monthly_goal: 1000, currency: "usd",
      })
      .select("id").single();
    if (error || !data) throw new Error(`seed seller ${code}: ${error?.message ?? "sin ficha"}`);
    return data.id as string;
  }

  async function venta(numero: string, sellerId: string): Promise<void> {
    const { data: existente } = await sb
      .from("sales_order").select("id").eq("organization_id", orgId).eq("order_number", numero).maybeSingle();
    if (existente?.id) {
      await sb.from("sales_order").update({ seller_id: sellerId }).eq("id", existente.id);
      return;
    }
    const { error } = await sb.from("sales_order").insert({
      organization_id: orgId, order_number: numero, seller_id: sellerId,
      status: "confirmed", currency: "usd", subtotal: 100, total: 100, balance: 100,
    });
    if (error) throw new Error(`seed order ${numero}: ${error.message}`);
  }

  const mia = await ficha("E2E-V1", "Vendedor", sellerUserId);
  const ajena = await ficha("E2E-V2", "Companero", null);
  await venta(ORDEN_PROPIA, mia);
  await venta(ORDEN_AJENA, ajena);
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

  // Antes de crear el cliente: comprobar después de tener la llave en la mano y
  // el primer `await` hecho es comprobar tarde.
  const destino = clasificarDestino(url, process.env.E2E_ALLOW_REMOTE);
  if (destino === "remoto_prohibido" || destino === "ilegible") {
    throw new Error(mensajeDestinoProhibido(url, destino));
  }
  if (destino === "remoto_permitido") {
    console.warn(`[e2e setup] AVISO: escribiendo en un proyecto REMOTO (${url}) por E2E_ALLOW_REMOTE=true.`);
  }

  const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

  const orgId = await ensureOrg(sb);
  const existente = await findUser(sb, email);

  let userId: string;
  if (existente) {
    // Primero mirar, luego escribir. Nunca al revés.
    await assertExclusivoDelE2E(sb, existente, orgId, email);
    const { error } = await sb.auth.admin.updateUserById(existente, { password, email_confirm: true });
    if (error) throw new Error(`updateUser: ${error.message}`);
    userId = existente;
  } else {
    userId = await createUser(sb, email, password);
  }

  await ensureMembership(sb, userId, orgId);
  console.log(`[e2e setup] Cuenta de prueba lista con membresía owner activa (org '${E2E_ORG_SLUG}').`);

  /**
   * Y la segunda cuenta: la del VENDEDOR.
   *
   * El aislamiento no se puede probar con la cuenta de propietario —ve todo por
   * definición—, así que hace falta una cuenta de rango bajo, con su ficha
   * vinculada, y una venta de un compañero que no debe llegar a verse.
   *
   * Su correo se deriva del de la cuenta de pruebas (`algo@dominio` →
   * `algo+vendedor@dominio`) para que herede la misma garantía: si `E2E_EMAIL`
   * es una dirección dedicada, esta también lo es. Comparte contraseña porque
   * las dos son de la misma base desechable.
   */
  const sellerEmail = emailDerivado(email, E2E_SELLER_SUFFIX);
  const sellerExistente = await findUser(sb, sellerEmail);
  let sellerUserId: string;
  if (sellerExistente) {
    await assertExclusivoDelE2E(sb, sellerExistente, orgId, sellerEmail);
    const { error } = await sb.auth.admin.updateUserById(sellerExistente, { password, email_confirm: true });
    if (error) throw new Error(`updateUser vendedor: ${error.message}`);
    sellerUserId = sellerExistente;
  } else {
    sellerUserId = await createUser(sb, sellerEmail, password);
  }
  await ensureMembership(sb, sellerUserId, orgId, "seller");
  await ensureSellerFixtures(sb, orgId, sellerUserId);
  console.log(`[e2e setup] Cuenta de vendedor lista (${sellerEmail}) con ficha vinculada y una venta ajena sembrada.`);
}

/** `algo@dominio` → `algo+sufijo@dominio`, que Supabase trata como otra cuenta. */
export function emailDerivado(email: string, sufijo: string): string {
  const [local, dominio] = email.split("@");
  if (!dominio) return `${email}.${sufijo}`;
  return `${local}+${sufijo}@${dominio}`;
}

export default globalSetup;
