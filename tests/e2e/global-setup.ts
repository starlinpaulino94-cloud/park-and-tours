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

/**
 * Y LOS DOS ACTORES DE LAS FASES 4-8, QUE NO TENÍAN NINGUNA PRUEBA DE EXTREMO
 * A EXTREMO.
 *
 * El aislamiento del socio y el del proveedor están comprobados regla a regla en
 * pruebas unitarias —cientos—, y ninguna pasa por la sesión real: el rol sale de
 * un `mock` y el identificador de la ficha nunca se resuelve. Es exactamente lo
 * que pasaba con el vendedor antes de que existiera su spec.
 *
 * Y con el proveedor importa más que con nadie: lo que hay al otro lado de esa
 * puerta son datos personales de TERCEROS. Un manifiesto es una lista de
 * clientes con su hotel, su habitación, su teléfono y lo que deben.
 */
export const E2E_PARTNER_SUFFIX = "socio";
export const E2E_SUPPLIER_SUFFIX = "proveedor";

/** La venta que el socio SÍ tiene que ver, porque es suya. */
export const ORDEN_DEL_SOCIO = "E2E-SOCIO-003";

/**
 * El cliente que el proveedor NO puede ver por ninguna parte.
 *
 * Un nombre reconocible y de una pieza para poder afirmar que no aparece en la
 * pantalla ni en la respuesta de la API. «Pérez» habría casado con cualquier
 * cosa; esto no casa con nada más.
 */
export const CLIENTE_DEL_MANIFIESTO = "Zoraida Manifiestotest";
export const TELEFONO_DEL_CLIENTE = "8095550777";
export const HABITACION_DEL_CLIENTE = "H-9412";

/** Las dos fichas de proveedor: la de la cuenta, y la del de enfrente. */
export const PROVEEDOR_PROPIO = "E2E-P1";
export const PROVEEDOR_AJENO = "E2E-P2";

/** Sus liquidaciones, para probar que no se abre la del otro. */
export const LIQUIDACION_PROPIA = "E2E-LIQ-P1";
export const LIQUIDACION_AJENA = "E2E-LIQ-P2";

const E2E_ORG_SLUG = "e2e-tenant";
const E2E_PARTNER_SLUG = "e2e-partner";

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
  /**
   * Los cuatro papeles que el E2E necesita. La lista es cerrada a propósito: un
   * rol mal escrito lo rechazaría la restricción de la base a mitad del arranque,
   * y el mensaje no diría dónde estaba el error.
   */
  role: "owner" | "seller" | "partner" | "supplier" = "owner"
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


/**
 * LA EMPRESA DEL SOCIO.
 *
 * Un tour center NO es una fila de una tabla: es una `organizations` de tipo
 * `partner` colgada del inquilino por `tenant_org_id`. Y de ahí sale su
 * identidad: el enganche del token pone `partner_id` con el `org_id` de la
 * membresía cuando esa organización es de tipo socio. Sembrar una fila en otro
 * sitio no habría producido ninguna sesión de socio.
 */
async function ensurePartnerOrg(sb: SupabaseClient, tenantOrgId: string): Promise<string> {
  const { data: existing, error } = await sb
    .from("organizations").select("id").eq("slug", E2E_PARTNER_SLUG).maybeSingle();
  if (error) throw new Error(`load partner org: ${error.message}`);
  if (existing?.id) return existing.id as string;

  const { data: created, error: createErr } = await sb
    .from("organizations")
    .insert({
      kind: "partner",
      name: "E2E Tour Center",
      slug: E2E_PARTNER_SLUG,
      legal_name: "E2E Tour Center",
      company_type: "other",
      status: "active",
      // Colgada del inquilino: es lo que hace que el token del socio lleve el
      // `org_id` del tenant y el `partner_id` del suyo.
      tenant_org_id: tenantOrgId,
      metadata: { system: true, purpose: "e2e" },
    })
    .select("id").single();
  if (createErr || !created) throw new Error(`create partner org: ${createErr?.message ?? "sin org"}`);
  return created.id as string;
}

/**
 * Una venta del socio, y la de la operadora ya sembrada.
 *
 * El aislamiento consiste en NO ver lo del otro, así que hace falta un otro:
 * `ORDEN_PROPIA` es del vendedor de la casa y NO lleva socio, así que el socio no
 * puede verla. Con una sola venta no se probaría nada.
 */
async function ensurePartnerFixtures(
  sb: SupabaseClient,
  orgId: string,
  partnerOrgId: string
): Promise<void> {
  const { data: existente } = await sb
    .from("sales_order").select("id")
    .eq("organization_id", orgId).eq("order_number", ORDEN_DEL_SOCIO).maybeSingle();
  if (existente?.id) {
    await sb.from("sales_order").update({ partner_id: partnerOrgId }).eq("id", existente.id);
    return;
  }
  const { error } = await sb.from("sales_order").insert({
    organization_id: orgId, order_number: ORDEN_DEL_SOCIO, partner_id: partnerOrgId,
    status: "confirmed", currency: "usd", subtotal: 200, total: 200, balance: 200,
  });
  if (error) throw new Error(`seed orden del socio: ${error.message}`);
}

/**
 * LAS PIEZAS DEL PROVEEDOR, Y POR QUÉ SON TANTAS.
 *
 * Cada una existe para poder afirmar UNA cosa que las fases 8.x cerraron:
 *
 *  · dos fichas de proveedor → que no ve el servicio del de enfrente;
 *  · una salida con un cliente de nombre reconocible → que ni la pantalla ni la
 *    API le entregan el nombre, el teléfono ni la habitación de nadie;
 *  · dos liquidaciones → que no abre la del otro (8.7);
 *  · un recurso de cada proveedor sobre la MISMA salida → que el manifiesto de
 *    esa salida le está cerrado aunque la opere (8.8/8.9).
 *
 * La salida se siembra para MAÑANA y no para una fecha fija: el portal del
 * proveedor separa «próximos» de «ya prestados» comparando contra el reloj, así
 * que una fecha fija dejaría de ser «próximo» el día siguiente y la prueba
 * empezaría a fallar sin que nadie hubiera tocado nada.
 */
async function ensureSupplierFixtures(
  sb: SupabaseClient,
  orgId: string,
  supplierUserId: string
): Promise<void> {
  async function ficha(code: string, userId: string | null): Promise<string> {
    const { data: existente } = await sb
      .from("supplier").select("id").eq("organization_id", orgId).eq("tax_id", code).maybeSingle();
    if (existente?.id) {
      await sb.from("supplier").update({ user_id: userId, status: "active" }).eq("id", existente.id);
      return existente.id as string;
    }
    const { data, error } = await sb
      .from("supplier")
      .insert({
        organization_id: orgId, name: `Transporte ${code}`, tax_id: code,
        supplier_type: "transport", email: `${code.toLowerCase()}@e2e.invalid`,
        user_id: userId, status: "active", currency: "usd",
      })
      .select("id").single();
    if (error || !data) throw new Error(`seed supplier ${code}: ${error?.message ?? "sin ficha"}`);
    return data.id as string;
  }

  const propio = await ficha(PROVEEDOR_PROPIO, supplierUserId);
  const ajeno = await ficha(PROVEEDOR_AJENO, null);

  // El producto y la salida sobre los que cuelga todo.
  const { data: producto } = await sb
    .from("product").select("id").eq("organization_id", orgId).eq("code", "E2E-PROD").maybeSingle();
  let productId = producto?.id as string | undefined;
  if (!productId) {
    const { data, error } = await sb
      .from("product")
      .insert({
        organization_id: orgId, code: "E2E-PROD", name: "Excursión E2E",
        status: "active", currency: "usd", duration_hours: 8,
      })
      .select("id").single();
    if (error || !data) throw new Error(`seed product: ${error?.message ?? "sin producto"}`);
    productId = data.id as string;
  }

  const manana = new Date(Date.now() + 24 * 3_600_000).toISOString();
  const { data: salidaExistente } = await sb
    .from("departure").select("id")
    .eq("organization_id", orgId).eq("product_id", productId).limit(1).maybeSingle();
  let departureId = salidaExistente?.id as string | undefined;
  if (departureId) {
    // La fecha se refresca en cada ejecución: si no, la salida dejaría de ser
    // «próxima» al día siguiente y el portal no la enseñaría.
    await sb.from("departure").update({ departure_at: manana, status: "scheduled" }).eq("id", departureId);
  } else {
    const { data, error } = await sb
      .from("departure")
      .insert({
        organization_id: orgId, product_id: productId, departure_at: manana,
        capacity: 40, status: "scheduled", meeting_point: "Lobby E2E",
      })
      .select("id").single();
    if (error || !data) throw new Error(`seed departure: ${error?.message ?? "sin salida"}`);
    departureId = data.id as string;
  }

  // El cliente cuyo nombre NO puede salir por el portal del proveedor.
  const [nombre, apellido] = CLIENTE_DEL_MANIFIESTO.split(" ");
  const { data: clienteExistente } = await sb
    .from("customer").select("id")
    .eq("organization_id", orgId).eq("last_name", apellido).limit(1).maybeSingle();
  let customerId = clienteExistente?.id as string | undefined;
  if (!customerId) {
    const { data, error } = await sb
      .from("customer")
      .insert({
        organization_id: orgId, first_name: nombre, last_name: apellido,
        phone: TELEFONO_DEL_CLIENTE, status: "active",
      })
      .select("id").single();
    if (error || !data) throw new Error(`seed customer: ${error?.message ?? "sin cliente"}`);
    customerId = data.id as string;
  }

  // Su reserva, con habitación: es el trío —nombre, teléfono, habitación— que
  // una hoja de ruta filtrada entrega de una vez.
  const { data: ordenExistente } = await sb
    .from("sales_order").select("id")
    .eq("organization_id", orgId).eq("order_number", ORDEN_PROPIA).maybeSingle();
  const orderId = ordenExistente?.id as string | undefined;
  if (orderId) {
    const { data: reservaExistente } = await sb
      .from("booking").select("id")
      .eq("organization_id", orgId).eq("booking_number", "E2E-RES-001").maybeSingle();
    /**
     * El objeto va ESCRITO EN CADA LLAMADA, aunque se repita.
     *
     * Una guarda de `schema-contract.test.ts` lee este fichero y comprueba que
     * cada columna que escribe existe de verdad en el esquema — es lo único que
     * protege a un arranque que no se puede ejecutar sin una base delante, y
     * PostgREST rechaza el INSERT ENTERO por una sola columna que no exista. Esa
     * guarda solo ve los objetos literales: pasando una variable, la fila
     * desaparecería de su vista sin que nada avisara. La misma guarda prohíbe
     * `insert(variable)` por eso.
     */
    if (reservaExistente?.id) {
      await sb.from("booking").update({
        organization_id: orgId, booking_number: "E2E-RES-001", order_id: orderId,
        product_id: productId, departure_id: departureId, customer_id: customerId,
        status: "confirmed", adults: 2, children: 0, infants: 0, pax_total: 2,
        room_number: HABITACION_DEL_CLIENTE, pickup_time: "07:30",
        currency: "usd", total_amount: 200, paid_amount: 0, balance_amount: 200,
      }).eq("id", reservaExistente.id);
    } else {
      const { error } = await sb.from("booking").insert({
        organization_id: orgId, booking_number: "E2E-RES-001", order_id: orderId,
        product_id: productId, departure_id: departureId, customer_id: customerId,
        status: "confirmed", adults: 2, children: 0, infants: 0, pax_total: 2,
        room_number: HABITACION_DEL_CLIENTE, pickup_time: "07:30",
        currency: "usd", total_amount: 200, paid_amount: 0, balance_amount: 200,
      });
      if (error) throw new Error(`seed booking: ${error.message}`);
    }
  }

  // Un recurso de CADA proveedor sobre la misma salida: la que opera el de la
  // cuenta, y la que no. `supplier_id` se escribe a mano porque el disparador de
  // 0085 solo lo deduce cuando hay vehículo o personal detrás.
  async function recurso(supplierId: string, role: string): Promise<void> {
    const { data: existente } = await sb
      .from("departure_resource").select("id")
      .eq("organization_id", orgId).eq("departure_id", departureId!)
      .eq("supplier_id", supplierId).maybeSingle();
    if (existente?.id) {
      await sb.from("departure_resource").update({
        organization_id: orgId, departure_id: departureId!, supplier_id: supplierId,
        resource_role: role, pax_assigned: 2, status: "planned",
      }).eq("id", existente.id);
      return;
    }
    const { error } = await sb.from("departure_resource").insert({
      organization_id: orgId, departure_id: departureId!, supplier_id: supplierId,
      resource_role: role, pax_assigned: 2, status: "planned",
    });
    if (error) throw new Error(`seed departure_resource ${role}: ${error.message}`);
  }
  await recurso(propio, "vehicle");
  await recurso(ajeno, "guide");

  // Y una liquidación de cada uno, para probar que no se abre la del vecino.
  async function liquidacion(code: string, supplierId: string): Promise<void> {
    const { data: existente } = await sb
      .from("settlement").select("id").eq("organization_id", orgId).eq("code", code).maybeSingle();
    if (existente?.id) {
      await sb.from("settlement").update({
        organization_id: orgId, code, beneficiary_type: "supplier", supplier_id: supplierId,
        currency: "usd", status: "pending", base_total: 500, pending_total: 500,
      }).eq("id", existente.id);
      return;
    }
    const { error } = await sb.from("settlement").insert({
      organization_id: orgId, code, beneficiary_type: "supplier", supplier_id: supplierId,
      currency: "usd", status: "pending", base_total: 500, pending_total: 500,
    });
    if (error) throw new Error(`seed settlement ${code}: ${error.message}`);
  }
  await liquidacion(LIQUIDACION_PROPIA, propio);
  await liquidacion(LIQUIDACION_AJENA, ajeno);
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
  const userId = await ensureCuentaDelE2E(sb, email, password, orgId);
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
  const sellerUserId = await ensureCuentaDelE2E(sb, sellerEmail, password, orgId);
  await ensureMembership(sb, sellerUserId, orgId, "seller");
  await ensureSellerFixtures(sb, orgId, sellerUserId);
  console.log(`[e2e setup] Cuenta de vendedor lista (${sellerEmail}) con ficha vinculada y una venta ajena sembrada.`);

  /**
   * LA TERCERA CUENTA: EL SOCIO.
   *
   * Su membresía va en la organización DEL SOCIO, no en la del inquilino. Es lo
   * que hace que el enganche ponga `partner_id` en el token: mirándolo al revés
   * —membresía en el inquilino— el socio habría entrado como personal interno.
   */
  const partnerOrgId = await ensurePartnerOrg(sb, orgId);
  const partnerEmail = emailDerivado(email, E2E_PARTNER_SUFFIX);
  const partnerUserId = await ensureCuentaDelE2E(sb, partnerEmail, password, orgId);
  await ensureMembership(sb, partnerUserId, partnerOrgId, "partner");
  await ensurePartnerFixtures(sb, orgId, partnerOrgId);
  console.log(`[e2e setup] Cuenta de socio lista (${partnerEmail}) en la empresa '${E2E_PARTNER_SLUG}'.`);

  /**
   * Y LA CUARTA: EL PROVEEDOR.
   *
   * Su membresía SÍ va en el inquilino —no es una organización aparte— y su
   * identidad sale de `supplier.user_id`, que el enganche busca acotado a la
   * empresa de la membresía. Así que el orden importa: primero la membresía,
   * después la ficha, y la ficha tiene que apuntar a esta cuenta o el token sale
   * sin `supplier_id` y el portal no la deja entrar.
   */
  const supplierEmail = emailDerivado(email, E2E_SUPPLIER_SUFFIX);
  const supplierUserId = await ensureCuentaDelE2E(sb, supplierEmail, password, orgId);
  await ensureMembership(sb, supplierUserId, orgId, "supplier");
  await ensureSupplierFixtures(sb, orgId, supplierUserId);
  console.log(`[e2e setup] Cuenta de proveedor lista (${supplierEmail}) con ficha vinculada y un servicio ajeno sembrado.`);
}

/**
 * Una cuenta del E2E: se busca, se comprueba que es SOLO del E2E, y se le fija
 * la contraseña.
 *
 * Escrito una vez y no cuatro. Las tres cuentas derivadas repetían el mismo
 * bloque de diez líneas, y ese bloque contiene la comprobación que impide
 * apropiarse de la cuenta de una persona: cuatro copias son cuatro sitios donde
 * alguien puede olvidarla al añadir la quinta cuenta.
 */
async function ensureCuentaDelE2E(
  sb: SupabaseClient,
  email: string,
  password: string,
  orgId: string
): Promise<string> {
  const existente = await findUser(sb, email);
  if (!existente) return createUser(sb, email, password);
  // Primero mirar, luego escribir. Nunca al revés.
  await assertExclusivoDelE2E(sb, existente, orgId, email);
  const { error } = await sb.auth.admin.updateUserById(existente, { password, email_confirm: true });
  if (error) throw new Error(`updateUser ${email}: ${error.message}`);
  return existente;
}

/** `algo@dominio` → `algo+sufijo@dominio`, que Supabase trata como otra cuenta. */
export function emailDerivado(email: string, sufijo: string): string {
  const [local, dominio] = email.split("@");
  if (!dominio) return `${email}.${sufijo}`;
  return `${local}+${sufijo}@${dominio}`;
}

export default globalSetup;
