import "server-only";
import { headers } from "next/headers";
import { supabaseService } from "@/lib/supabase/service";
import { tryWrite } from "@/lib/supabase/io";
import {
  mapMembegoRole, canLinkCompanies, clienteFromPayload, membresiaFromPayload, splitNombre,
  type MembegoSsoPayload, type MembegoEvent,
} from "@/lib/membego";

/**
 * El satélite contra la base: vínculos, identidad y efectos de los eventos.
 *
 * TODO este módulo trabaja con el cliente de SERVICIO y filtro explícito de
 * `organization_id`, por la misma razón que los crons: aquí no hay sesión.
 * El SSO llega ANTES de que exista una sesión —abrirla es justamente su
 * trabajo— y el webhook lo firma una máquina. Las ayudas de inquilino
 * resolverían el cliente desde cookies que no existen y leerían cero filas
 * diciendo que no pasa nada, que en una integración es el peor fallo posible:
 * silencio.
 *
 * El ámbito no se pierde: el `organization_id` sale siempre del VÍNCULO
 * (`membego_link`), que a su vez solo se crea desde un token firmado con rol
 * de administración. La empresa de MembeGo es quien delimita, exactamente como
 * manda su contrato («persiste TODO con el companyId del evento»).
 */

export function membegoSecret(): string {
  return process.env.MEMBEGO_SECRETO || "";
}

export interface MembegoLink {
  id: string;
  organization_id: string;
  membego_company_id: string;
  status: string;
  linked_at: string;
  last_event_at: string | null;
  events_received: number;
}

export async function linkByCompany(membegoCompanyId: string): Promise<MembegoLink | null> {
  const { data, error } = await supabaseService()
    .from("membego_link")
    .select("id, organization_id, membego_company_id, status, linked_at, last_event_at, events_received")
    .eq("membego_company_id", membegoCompanyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MembegoLink | null) ?? null;
}

export async function linkByOrganization(organizationId: string): Promise<MembegoLink | null> {
  const { data, error } = await supabaseService()
    .from("membego_link")
    .select("id, organization_id, membego_company_id, status, linked_at, last_event_at, events_received")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MembegoLink | null) ?? null;
}

/** Bitácora sin sesión: inserta con servicio y organización explícita. */
export async function auditMembego(
  organizationId: string,
  action: string,
  description: string,
  opts: { userId?: string | null; severity?: string; metadata?: Record<string, unknown> } = {}
): Promise<void> {
  try {
    const h = await headers().catch(() => null);
    // La bitácora nunca tumba la operación que describe, pero un fallo suyo
    // tampoco puede desaparecer: sin esto, la auditoría tiene huecos que nadie
    // sabe que existen.
    await tryWrite("anotar en la bitácora", supabaseService().from("audit_log").insert({
      organization_id: organizationId,
      user_id: opts.userId ?? null,
      action,
      entity_type: "membego",
      description,
      severity: opts.severity || "info",
      metadata_json: opts.metadata || {},
      ip_address: h?.get("x-forwarded-for") || undefined,
      user_agent: h?.get("user-agent") || undefined,
      occurred_at: new Date().toISOString(),
    }));
  } catch (err) {
    console.error("[membego] no se pudo escribir la bitácora:", err);
  }
}

async function findAuthUserByEmail(email: string) {
  const sb = supabaseService();
  const target = email.trim().toLowerCase();
  for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const users = data?.users ?? [];
    const found = users.find((u) => u.email?.toLowerCase() === target);
    if (found) return found;
    if (users.length < 200) return null;
  }
}

export type LinkResolution =
  | { ok: true; link: MembegoLink; created: boolean }
  | { ok: false; reason: "sin_vinculo" | "sin_permiso" | "sin_organizacion" | "ambiguo" | "suspendido" };

/**
 * Resuelve el vínculo empresa MembeGo ↔ organización, creándolo si procede.
 *
 * El vínculo lo establece el PRIMER SSO de un rol de administración cuyo
 * correo sea dueño o admin de EXACTAMENTE una organización local. Las dos
 * pruebas juntas son lo que autoriza: el token firmado demuestra que administra
 * la empresa en MembeGo, y la membresía local demuestra que administra la
 * organización de aquí. Con cero organizaciones no hay nada que vincular, y
 * con dos no se adivina — elegir por él una empresa que ve dinero sería peor
 * que pedirle que lo haga a mano.
 */
export async function resolveLink(payload: MembegoSsoPayload): Promise<LinkResolution> {
  const existing = await linkByCompany(payload.companyId);
  if (existing) {
    if (existing.status !== "active") return { ok: false, reason: "suspendido" };
    return { ok: true, link: existing, created: false };
  }

  if (!canLinkCompanies(payload.rol)) return { ok: false, reason: "sin_vinculo" };
  if (!payload.email) return { ok: false, reason: "sin_permiso" };

  const authUser = await findAuthUserByEmail(payload.email);
  if (!authUser) return { ok: false, reason: "sin_organizacion" };

  const sb = supabaseService();
  const { data: memberships, error } = await sb
    .from("organization_memberships")
    .select("organization_id, role, status")
    .eq("user_id", authUser.id)
    .eq("status", "active")
    .in("role", ["owner", "admin"]);
  if (error) throw new Error(error.message);

  const candidates = [...new Set((memberships ?? []).map((m) => m.organization_id as string))];
  if (candidates.length === 0) return { ok: false, reason: "sin_organizacion" };
  if (candidates.length > 1) return { ok: false, reason: "ambiguo" };

  const organizationId = candidates[0];
  // Una organización solo puede tener un vínculo: si ya está atada a OTRA
  // empresa de MembeGo, esto no puede pisarlo en silencio.
  const already = await linkByOrganization(organizationId);
  if (already) return { ok: false, reason: "ambiguo" };

  const { data: created, error: insertError } = await sb
    .from("membego_link")
    .insert({
      organization_id: organizationId,
      membego_company_id: payload.companyId,
      linked_by: authUser.id,
    })
    .select("id, organization_id, membego_company_id, status, linked_at, last_event_at, events_received")
    .single();
  if (insertError) throw new Error(insertError.message);

  await auditMembego(organizationId, "membego_linked",
    `Organización vinculada a la empresa ${payload.companyId} de MembeGo por ${payload.email}`,
    { userId: authUser.id, severity: "warning", metadata: { membego_company_id: payload.companyId } });

  console.log(`[membego] vínculo creado: ${payload.companyId} → ${organizationId}`);
  return { ok: true, link: created as MembegoLink, created: true };
}

/**
 * Canje único de un token SSO. El jti es clave primaria: el primer insert
 * entra y el segundo choca — sin ventana entre comprobar y marcar.
 */
export async function consumeJti(jti: string, exp: number): Promise<boolean> {
  const { error } = await supabaseService().from("membego_sso_jti").insert({
    jti,
    expires_at: new Date(exp * 1000).toISOString(),
  });
  if (!error) return true;
  if (error.code === "23505") return false; // ya canjeado
  throw new Error(error.message);
}

export interface ProvisionedUser {
  userId: string;
  email: string;
  role: string;
  created: boolean;
}

/**
 * Garantiza la cuenta local del usuario del token y su membresía en la
 * organización vinculada.
 *
 * El mapa es por `sub` (estable), como manda el contrato: un cambio de correo
 * en MembeGo no crea una segunda cuenta. El rol solo lo gobierna el SSO en las
 * membresías que el propio SSO creó (`role_managed`): una cuenta que ya
 * existía con un rol puesto a mano no se toca.
 */
export async function provisionSsoUser(
  link: MembegoLink,
  payload: MembegoSsoPayload
): Promise<ProvisionedUser> {
  const sb = supabaseService();
  const mappedRole = mapMembegoRole(payload.rol);

  // 1) ¿Ya conocemos este sub?
  const { data: known, error: knownError } = await sb
    .from("membego_user")
    .select("id, user_id")
    .eq("membego_sub", payload.sub)
    .maybeSingle();
  if (knownError) throw new Error(knownError.message);

  let userId = known?.user_id as string | undefined;
  let email = payload.email?.trim().toLowerCase() || "";
  let createdAccount = false;

  if (!userId) {
    if (!email) throw Object.assign(new Error("El token no trae correo y el usuario no está mapeado"), { status: 400 });
    const existing = await findAuthUserByEmail(email);
    if (existing) {
      userId = existing.id;
    } else {
      const { data: created, error: createError } = await sb.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { name: email.split("@")[0], membego_sub: payload.sub },
      });
      if (createError) throw new Error(createError.message);
      userId = created.user?.id;
      if (!userId) throw new Error("No se pudo crear la cuenta local");
      createdAccount = true;
    }
  } else {
    const { data } = await sb.auth.admin.getUserById(userId);
    email = data.user?.email?.toLowerCase() || email;
  }

  // 2) Membresía en la organización vinculada.
  const { data: membership, error: membershipError } = await sb
    .from("organization_memberships")
    .select("id, role, status")
    .eq("user_id", userId)
    .eq("organization_id", link.organization_id)
    .maybeSingle();
  if (membershipError) throw new Error(membershipError.message);

  let roleManaged = false;
  if (!membership) {
    const { count } = await sb
      .from("organization_memberships")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    const { error: insertError } = await sb.from("organization_memberships").insert({
      user_id: userId,
      organization_id: link.organization_id,
      role: mappedRole,
      status: "active",
      is_primary: (count ?? 0) === 0,
    });
    if (insertError) throw new Error(insertError.message);
    roleManaged = true;
  } else if (membership.status !== "active") {
    // Suspendida o inactiva: el SSO NO la revive. Suspender aquí tiene que
    // cerrar la puerta de verdad, venga por donde venga el intento de entrar.
    throw Object.assign(new Error("La cuenta está desactivada en esta organización"), { status: 403 });
  }

  // 3) El mapa sub → usuario, y el rol si lo gobierna el SSO.
  const { data: mapRow, error: upsertError } = await sb
    .from("membego_user")
    .upsert(
      {
        organization_id: link.organization_id,
        membego_sub: payload.sub,
        user_id: userId,
        membego_role: payload.rol || null,
        ...(known ? {} : { role_managed: roleManaged }),
        last_login_at: new Date().toISOString(),
      },
      { onConflict: "membego_sub" }
    )
    .select("role_managed")
    .single();
  if (upsertError) throw new Error(upsertError.message);

  if (membership && mapRow?.role_managed && membership.role !== mappedRole) {
    // El contrato: «si el rol de MembeGo cambia, el siguiente SSO trae el rol
    // nuevo — actualiza». Solo en membresías creadas por el propio SSO.
    const { error: roleError } = await sb
      .from("organization_memberships")
      .update({ role: mappedRole })
      .eq("id", membership.id);
    if (roleError) throw new Error(roleError.message);
    await auditMembego(link.organization_id, "membego_role_updated",
      `Rol actualizado por SSO de MembeGo: ${membership.role} → ${mappedRole}`,
      { userId, metadata: { membego_role: payload.rol } });
  }

  return { userId, email, role: mappedRole, created: createdAccount };
}

/* ----------------------------------------------------------- los eventos */

export interface EventOutcome {
  status: "processed" | "ignored" | "duplicate";
  detail?: string;
}

/** Tipos que producen un efecto local. El resto se registra y se ignora. */
const KNOWN_EVENTS = new Set([
  "cliente.registrado", "cliente.primera_visita", "cliente.visita",
  "cliente.compro_servicio", "cliente.primera_compra",
  "membresia.activada", "referido.convirtio",
]);

/**
 * Aplica un evento del webhook. Idempotente por diseño: la fila de
 * `membego_event` (clave primaria = id del sobre) se inserta ANTES de tocar
 * nada, así que un reintento choca ahí y responde 200 sin repetir el efecto.
 */
export async function applyMembegoEvent(link: MembegoLink, event: MembegoEvent): Promise<EventOutcome> {
  const sb = supabaseService();
  const known = KNOWN_EVENTS.has(event.tipo);

  const { error: insertError } = await sb.from("membego_event").insert({
    event_id: event.id,
    organization_id: link.organization_id,
    tipo: event.tipo,
    payload: event.payload,
    status: known ? "processed" : "ignored",
  });
  if (insertError) {
    if (insertError.code === "23505") return { status: "duplicate" };
    throw new Error(insertError.message);
  }

  try {
    if (known) await applyEffects(link, event);
  } catch (err) {
    // El efecto falló DESPUÉS de reclamar la idempotencia: se deja constancia
    // en la fila para poder repararlo, y se responde error para que MembeGo
    // reintente — el reintento verá el duplicado, así que la reparación real
    // es manual, con el payload íntegro guardado aquí.
    const message = err instanceof Error ? err.message : String(err);
    await tryWrite(`marcar como fallido el evento ${event.id}`, sb.from("membego_event")
      .update({ status: "failed", error: message.slice(0, 400) })
      .eq("event_id", event.id));
    throw err;
  }

  // Contadores de la conexión: informativos. El evento ya se procesó.
  await tryWrite("actualizar los contadores del enlace con MembeGo", sb.from("membego_link")
    .update({
      last_event_at: new Date().toISOString(),
      events_received: (link.events_received ?? 0) + 1,
    })
    .eq("id", link.id));

  return { status: known ? "processed" : "ignored" };
}

async function applyEffects(link: MembegoLink, event: MembegoEvent): Promise<void> {
  const sb = supabaseService();
  const cliente = clienteFromPayload(event.payload);
  if (!cliente.clienteId) return;

  // 1) El espejo del cliente.
  const { data: mirror, error: mirrorError } = await sb
    .from("membego_customer")
    .select("id, customer_id, visits, purchases")
    .eq("organization_id", link.organization_id)
    .eq("membego_cliente_id", cliente.clienteId)
    .maybeSingle();
  if (mirrorError) throw new Error(mirrorError.message);

  // 2) La ficha local: se busca por correo y después por teléfono, y solo se
  // crea si no existe. La fuente del dato es MembeGo, pero la ficha es de la
  // organización — un cliente que ya compraba aquí no se duplica.
  let customerId = mirror?.customer_id as string | null | undefined;
  if (!customerId) {
    customerId = await matchOrCreateCustomer(link.organization_id, cliente);
  }

  const membresia = membresiaFromPayload(event.payload);
  const bump = (field: "visits" | "purchases") =>
    (mirror?.[field] ?? 0) + 1;

  const patch: Record<string, unknown> = {
    organization_id: link.organization_id,
    membego_cliente_id: cliente.clienteId,
    customer_id: customerId ?? null,
    ...(membresia ? {
      membership_id: membresia.id,
      plan_id: membresia.planId,
      plan_name: membresia.plan,
      membership_paid: membresia.esDePago,
      membership_valid_until: membresia.vigenteHasta,
    } : {}),
    ...(event.tipo === "cliente.visita" || event.tipo === "cliente.primera_visita"
      ? { visits: bump("visits") } : {}),
    ...(event.tipo === "cliente.compro_servicio" || event.tipo === "cliente.primera_compra"
      ? { purchases: bump("purchases") } : {}),
  };

  const { error: upsertError } = await sb
    .from("membego_customer")
    .upsert(patch, { onConflict: "organization_id,membego_cliente_id" });
  if (upsertError) throw new Error(upsertError.message);
}

/**
 * Busca la ficha local por correo y por teléfono; si no hay, la crea con
 * origen 'membego'. El teléfono se compara por dígitos: el mismo número está
 * escrito de cinco maneras, y fallar el cruce duplicaría al cliente.
 */
async function matchOrCreateCustomer(
  organizationId: string,
  cliente: { clienteId: string | null; nombre: string | null; email: string | null; telefono: string | null }
): Promise<string | null> {
  const sb = supabaseService();

  if (cliente.email) {
    const { data } = await sb
      .from("customer")
      .select("id")
      .eq("organization_id", organizationId)
      .ilike("email", cliente.email)
      .limit(1)
      .maybeSingle();
    if (data?.id) return data.id as string;
  }

  if (cliente.telefono) {
    const digits = cliente.telefono.replace(/\D/g, "");
    if (digits.length >= 7) {
      const { data } = await sb
        .from("customer")
        .select("id, phone")
        .eq("organization_id", organizationId)
        .not("phone", "is", null)
        .limit(500);
      const match = (data ?? []).find(
        (row) => String(row.phone || "").replace(/\D/g, "").endsWith(digits.slice(-10))
      );
      if (match?.id) return match.id as string;
    }
  }

  const { first, last } = splitNombre(cliente.nombre);
  const { data: created, error } = await sb
    .from("customer")
    .insert({
      organization_id: organizationId,
      first_name: first,
      last_name: last,
      email: cliente.email,
      phone: cliente.telefono,
      source: "membego",
      tags: ["membego"],
      status: "active",
    })
    .select("id")
    .single();
  if (error) {
    console.error("[membego] no se pudo crear la ficha del cliente:", error.message);
    return null;
  }
  return created.id as string;
}

/* ------------------------------------------------------------- el panel */

/**
 * Pausa o reactiva el vínculo. Suspendido, el webhook responde 503 (los
 * eventos esperan en la cola de MembeGo) y el SSO rechaza con `suspendido`:
 * pausar cierra la puerta de verdad, sin perder lo ya sincronizado.
 */
export async function setLinkStatus(
  organizationId: string,
  status: "active" | "suspended"
): Promise<MembegoLink> {
  const { data, error } = await supabaseService()
    .from("membego_link")
    .update({ status })
    .eq("organization_id", organizationId)
    .select("id, organization_id, membego_company_id, status, linked_at, last_event_at, events_received")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw Object.assign(new Error("Esta organización no está vinculada a MembeGo"), { status: 404 });
  return data as MembegoLink;
}

/**
 * Rompe el vínculo. Los espejos (`membego_customer`, `membego_user`,
 * `membego_event`) se quedan: son historial de la organización, y borrarlos
 * haría irreversible lo que solo debía ser una desconexión. Volver a vincular
 * la MISMA empresa los reutiliza tal cual.
 */
export async function unlinkOrganization(organizationId: string): Promise<void> {
  const link = await linkByOrganization(organizationId);
  if (!link) throw Object.assign(new Error("Esta organización no está vinculada a MembeGo"), { status: 404 });
  const { error } = await supabaseService()
    .from("membego_link")
    .delete()
    .eq("id", link.id);
  if (error) throw new Error(error.message);
}

export interface MembegoStatus {
  configured: boolean;
  link: MembegoLink | null;
  members: number;
  customers: number;
  recent: { event_id: string; tipo: string; status: string; received_at: string }[];
  failed: number;
}

export async function membegoStatus(organizationId: string): Promise<MembegoStatus> {
  const sb = supabaseService();
  const link = await linkByOrganization(organizationId);

  if (!link) {
    return { configured: Boolean(membegoSecret()), link: null, members: 0, customers: 0, recent: [], failed: 0 };
  }

  const [members, customers, recent, failed] = await Promise.all([
    sb.from("membego_user").select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId),
    sb.from("membego_customer").select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId),
    sb.from("membego_event")
      .select("event_id, tipo, status, received_at")
      .eq("organization_id", organizationId)
      .order("received_at", { ascending: false })
      .limit(10),
    sb.from("membego_event").select("event_id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "failed"),
  ]);

  return {
    configured: Boolean(membegoSecret()),
    link,
    members: members.count ?? 0,
    customers: customers.count ?? 0,
    recent: (recent.data ?? []) as MembegoStatus["recent"],
    failed: failed.count ?? 0,
  };
}
