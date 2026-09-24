import "server-only";
import { supabaseService } from "@/lib/supabase/service";
import { mustRead, mustWrite, tryWrite } from "@/lib/supabase/io";
import { writeAudit } from "@/lib/audit";
import { notify } from "@/lib/notify-service";
import { newSupplierConfirmation } from "@/lib/codes";
import { hashDeEnlace, nuevoEnlaceDeRespuesta, urlDeRespuesta } from "@/lib/enlace-proveedor";
import {
  alVencer, haVencido, plazoDeRespuesta, puedeResponder,
  type EstadoDeAceptacion,
} from "@/lib/aceptacion-proveedor";

/**
 * QUE EL PROVEEDOR CONTESTE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS CAMINOS PARA LA MISMA RESPUESTA
 *
 *  · EL PORTAL, con sesión. Es el bueno y el que deja mejor rastro.
 *  · EL ENLACE DE UN CLIC, sin sesión. Existe porque un transportista con
 *    cuatro guaguas no va a mantener una cuenta abierta en el móvil, y la
 *    alternativa real no es «que entre al portal»: es que conteste por WhatsApp
 *    y alguien de la casa lo escriba a mano, que es donde se pierden.
 *
 * Los dos escriben las MISMAS columnas, y `responded_via` guarda por cuál
 * entró. El día que se discuta si el proveedor aceptó de verdad, esa palabra es
 * toda la prueba que hay.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TODO ESTO PASA POR EL CLIENTE DE SERVICIO, Y NO ES PEREZA
 *
 * La página del enlace no tiene sesión: no hay JWT, así que no hay empresa
 * actual y la RLS no deja leer nada. El ámbito lo pone el propio enlace —que
 * dice de qué empresa, de qué proveedor y de qué fila es— y se comprueba a mano
 * en cada consulta.
 */

export type TipoDeRecurso = "departure_resource" | "pickup_route";

const TIPOS: TipoDeRecurso[] = ["departure_resource", "pickup_route"];

/**
 * Lo que se lee de la fila. Lista corta a propósito: por aquí NO pasa ni un
 * dato de pasajero, y la forma de garantizarlo es no pedirlo.
 */
const COLUMNAS =
  "id,organization_id,supplier_id,service_date,status,acceptance,acceptance_deadline," +
  "responded_at,responded_via,confirmation_number,response_note";

interface FilaDeServicio {
  id: string;
  organization_id: string;
  supplier_id: string | null;
  service_date: string | null;
  status: string | null;
  acceptance: EstadoDeAceptacion;
  acceptance_deadline: string | null;
  responded_at: string | null;
  responded_via: string | null;
  confirmation_number: string | null;
  response_note: string | null;
}

export type Respuesta = "accepted" | "rejected";

function esTipo(valor: unknown): valor is TipoDeRecurso {
  return TIPOS.includes(valor as TipoDeRecurso);
}

async function filaDe(
  tipo: TipoDeRecurso,
  companyId: string,
  resourceId: string
): Promise<FilaDeServicio | null> {
  return mustRead<FilaDeServicio>(
    "leer el servicio del proveedor",
    supabaseService().from(tipo).select(COLUMNAS)
      .eq("id", resourceId).eq("organization_id", companyId).limit(1).maybeSingle()
  );
}

/* ═══════════════════════════════════════════ emitir el enlace */

export interface EnlaceEmitido {
  /** La dirección completa. Solo existe aquí y en el mensaje que se manda. */
  url: string;
  expiresAt: string;
}

/**
 * Emite el enlace de un clic para un servicio que está esperando respuesta.
 *
 * REVOCA LOS ANTERIORES. Un servicio tiene UN enlace vivo: si se le manda otro
 * por WhatsApp porque el correo no llegó, el primero deja de valer en ese
 * momento. Con dos vivos, «de un solo uso» dejaría de ser verdad por la vía de
 * tener dos usos.
 *
 * Y CADUCA CON LA SALIDA, no con el plazo a secas: el plazo ya viene acotado
 * por la hora del servicio desde 0087, y si por lo que sea no viniera, aquí se
 * vuelve a acotar. Un enlace que sobrevive al viaje es un enlace con el que
 * alguien acepta el martes lo que pasó el lunes.
 */
export async function emitirEnlaceDeRespuesta(
  companyId: string,
  tipo: TipoDeRecurso,
  resourceId: string,
  ahora: Date = new Date()
): Promise<EnlaceEmitido> {
  if (!esTipo(tipo)) throw Object.assign(new Error("Tipo de servicio desconocido"), { status: 400 });

  const fila = await filaDe(tipo, companyId, resourceId);
  if (!fila) throw Object.assign(new Error("Ese servicio no existe"), { status: 404 });
  if (!fila.supplier_id) {
    throw Object.assign(new Error("Ese servicio no es de ningún proveedor"), { status: 409 });
  }
  const estado = puedeResponder(fila, ahora);
  if (estado.ok === false) {
    throw Object.assign(new Error(MOTIVO_HUMANO[estado.motivo]), { status: 409 });
  }

  await mustWrite(
    "revocar los enlaces anteriores",
    supabaseService().from("supplier_response_token")
      .update({ revoked_at: ahora.toISOString(), revoked_reason: "reemplazado" })
      .eq("organization_id", companyId).eq("resource_kind", tipo).eq("resource_id", resourceId)
      .is("used_at", null).is("revoked_at", null)
  );

  const plazo = fila.acceptance_deadline
    ? new Date(fila.acceptance_deadline)
    : plazoDeRespuesta({ ahora, fechaDelServicio: fila.service_date });
  const servicio = fila.service_date ? new Date(fila.service_date) : null;
  const vence = servicio && servicio.getTime() < plazo.getTime() ? servicio : plazo;

  const { token, hash } = nuevoEnlaceDeRespuesta();
  await mustWrite(
    "emitir el enlace del proveedor",
    supabaseService().from("supplier_response_token").insert({
      organization_id: companyId,
      supplier_id: fila.supplier_id,
      resource_kind: tipo,
      resource_id: resourceId,
      token_hash: hash,
      expires_at: vence.toISOString(),
    })
  );

  await writeAudit({
    companyId,
    action: "supplier.link.issued",
    entityType: tipo,
    entityId: resourceId,
    description: "Se emitió un enlace de respuesta para el proveedor",
    metadata: { supplier_id: fila.supplier_id, expires_at: vence.toISOString() },
  });

  return { url: urlDeRespuesta(token), expiresAt: vence.toISOString() };
}

/* ═══════════════════════════════════════════ abrir el enlace */

export type MotivoDelEnlace =
  | "not_found" | "revoked" | "already_used" | "expired" | "already_answered" | "reassigned";

export interface VistaDelEnlace {
  ok: boolean;
  motivo?: MotivoDelEnlace;
  servicio?: {
    tipo: TipoDeRecurso;
    service_date: string | null;
    proveedor: string | null;
    producto: string | null;
    punto_de_encuentro: string | null;
    pax: number | null;
    detalle: string | null;
    acceptance: EstadoDeAceptacion;
    acceptance_deadline: string | null;
    confirmation_number: string | null;
  };
}

interface TokenFila {
  id: string;
  organization_id: string;
  supplier_id: string;
  resource_kind: TipoDeRecurso;
  resource_id: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  opened_count: number;
}

async function tokenPorHash(hash: string): Promise<TokenFila | null> {
  return mustRead<TokenFila>(
    "buscar el enlace del proveedor",
    supabaseService().from("supplier_response_token")
      .select("id,organization_id,supplier_id,resource_kind,resource_id,expires_at,used_at,revoked_at,opened_count")
      .eq("token_hash", hash).limit(1).maybeSingle()
  );
}

/**
 * Abre el enlace y AUDITA LA APERTURA, salga como salga.
 *
 * La auditoría es de cada apertura y no de cada respuesta: lo que el encargo
 * pide saber es quién tocó el enlace, incluido quien lo abrió veinte veces sin
 * contestar y quien probó uno que no existe. El intento fallido es el que más
 * dice — un enlace que no existe abierto cuarenta veces desde la misma
 * dirección es alguien probando.
 *
 * Por eso la anotación va ANTES de decidir qué se devuelve, y por eso el caso
 * «no existe» también se anota, aunque entonces no haya empresa a la que
 * colgarlo.
 */
export async function abrirEnlace(token: string, ahora: Date = new Date()): Promise<VistaDelEnlace> {
  const limpio = (token || "").trim();
  const fila = limpio ? await tokenPorHash(hashDeEnlace(limpio)) : null;

  if (!fila) {
    await writeAudit({
      action: "supplier.link.open",
      entityType: "supplier_response_token",
      description: "Alguien abrió un enlace de proveedor que no existe",
      severity: "warning",
      metadata: { resultado: "not_found" },
    });
    return { ok: false, motivo: "not_found" };
  }

  // El recuento sube SIEMPRE, incluso cuando el enlace ya no sirve: si solo
  // contara las aperturas válidas, un enlace revocado abierto cien veces se
  // vería igual que uno que nadie tocó.
  await tryWrite(
    "apuntar la apertura del enlace",
    supabaseService().from("supplier_response_token")
      .update({ opened_count: (fila.opened_count ?? 0) + 1, last_opened_at: ahora.toISOString() })
      .eq("id", fila.id)
  );

  const motivo = motivoDelToken(fila, ahora);
  await writeAudit({
    companyId: fila.organization_id,
    action: "supplier.link.open",
    entityType: fila.resource_kind,
    entityId: fila.resource_id,
    description: motivo ? `Enlace de proveedor abierto sin poder usarse (${motivo})` : "Enlace de proveedor abierto",
    severity: motivo ? "warning" : "info",
    metadata: { supplier_id: fila.supplier_id, resultado: motivo ?? "ok", apertura: (fila.opened_count ?? 0) + 1 },
  });
  if (motivo) return { ok: false, motivo };

  const servicio = await resumenDelServicio(fila, ahora);
  if (!servicio.ok) return servicio;
  return servicio;
}

function motivoDelToken(fila: TokenFila, ahora: Date): MotivoDelEnlace | null {
  if (fila.revoked_at) return "revoked";
  if (fila.used_at) return "already_used";
  if (new Date(fila.expires_at).getTime() <= ahora.getTime()) return "expired";
  return null;
}

/**
 * Lo que la página del enlace enseña.
 *
 * Ni un nombre de cliente, ni un teléfono, ni una habitación: esta página se
 * abre SIN CONTRASEÑA, así que enseña estrictamente lo que hace falta para
 * decidir si se acepta —qué excursión, cuándo, dónde y cuánta gente— y nada
 * más. Los datos de cada parada están en la hoja de ruta, que sí exige entrar.
 */
async function resumenDelServicio(fila: TokenFila, ahora: Date): Promise<VistaDelEnlace> {
  const esRecurso = fila.resource_kind === "departure_resource";
  const seleccion = esRecurso
    ? "id,organization_id,supplier_id,acceptance,acceptance_deadline,confirmation_number,service_date,resource_role,pax_assigned,departure_id"
    : "id,organization_id,supplier_id,acceptance,acceptance_deadline,confirmation_number,service_date,name,pax_total,departure_id";

  const row = await mustRead<Record<string, unknown>>(
    "leer el servicio del enlace",
    supabaseService().from(fila.resource_kind).select(seleccion)
      .eq("id", fila.resource_id).eq("organization_id", fila.organization_id).limit(1).maybeSingle()
  );
  if (!row) return { ok: false, motivo: "not_found" };
  // Sigue siendo suyo. El disparador de 0087 revoca al reasignar; esto no
  // depende de que aquel haya corrido.
  if (row.supplier_id !== fila.supplier_id) return { ok: false, motivo: "reassigned" };

  const estado = puedeResponder(row as { acceptance?: string; acceptance_deadline?: string }, ahora);
  const proveedor = await mustRead<{ name: string | null }>(
    "leer el nombre del proveedor",
    supabaseService().from("supplier").select("name")
      .eq("id", fila.supplier_id).eq("organization_id", fila.organization_id).limit(1).maybeSingle()
  );

  const salida = row.departure_id
    ? await mustRead<{ meeting_point: string | null; product_id: string | null }>(
        "leer la salida del servicio",
        supabaseService().from("departure").select("meeting_point,product_id")
          .eq("id", row.departure_id).eq("organization_id", fila.organization_id).limit(1).maybeSingle()
      )
    : null;
  const producto = salida?.product_id
    ? await mustRead<{ name: string | null }>(
        "leer la excursión del servicio",
        supabaseService().from("product").select("name")
          .eq("id", salida.product_id).eq("organization_id", fila.organization_id).limit(1).maybeSingle()
      )
    : null;

  const servicio = {
    tipo: fila.resource_kind,
    service_date: (row.service_date as string) ?? null,
    proveedor: proveedor?.name ?? null,
    producto: producto?.name ?? null,
    punto_de_encuentro: salida?.meeting_point ?? null,
    pax: Number(esRecurso ? row.pax_assigned ?? 0 : row.pax_total ?? 0) || null,
    detalle: (esRecurso ? (row.resource_role as string) : (row.name as string)) ?? null,
    acceptance: (row.acceptance as EstadoDeAceptacion) ?? "not_required",
    acceptance_deadline: (row.acceptance_deadline as string) ?? null,
    confirmation_number: (row.confirmation_number as string) ?? null,
  };

  // El servicio se ENSEÑA igual aunque ya no admita respuesta: quien abre el
  // enlace después de contestar tiene derecho a ver qué contestó y con qué
  // número, en vez de una pantalla que solo dice que no.
  if (estado.ok === false) {
    return {
      ok: false,
      motivo: estado.motivo === "vencido" ? "expired" : "already_answered",
      servicio,
    };
  }
  return { ok: true, servicio };
}

/* ═══════════════════════════════════════════ contestar */

export interface RespuestaHecha {
  ok: boolean;
  motivo?: MotivoDelEnlace;
  confirmation_number?: string | null;
  answer?: Respuesta;
}

/**
 * Contesta con el enlace. UNA sola escritura, en Postgres.
 *
 * Hay que gastar el enlace y escribir la respuesta, y las dos cosas tienen que
 * pasar juntas o ninguna. El cliente HTTP no sabe abrir una transacción —misma
 * razón que la comisión retenida en 0083—, así que lo hace
 * `respond_to_supplier_service` (0087) y aquí solo se la llama.
 */
export async function responderConEnlace(
  token: string,
  respuesta: Respuesta,
  nota: string | null = null
): Promise<RespuestaHecha> {
  const limpio = (token || "").trim();
  if (!limpio) return { ok: false, motivo: "not_found" };

  const { data, error } = await supabaseService().rpc("respond_to_supplier_service", {
    p_token_hash: hashDeEnlace(limpio),
    p_answer: respuesta,
    p_note: nota,
    // El número se genera aquí y la función lo escribe SOLO si la respuesta es
    // que sí: un número de confirmación emitido con un rechazo sería un papel
    // que dice que hay conformidad de lo que nadie aceptó.
    p_confirmation: newSupplierConfirmation(),
  });
  if (error) {
    throw Object.assign(new Error(`No se pudo registrar la respuesta: ${error.message}`), { status: 409 });
  }

  const salida = (data ?? {}) as {
    ok?: boolean; reason?: MotivoDelEnlace; confirmation_number?: string | null;
    resource_kind?: TipoDeRecurso; resource_id?: string;
  };
  if (!salida.ok) return { ok: false, motivo: salida.reason ?? "not_found" };

  await despuesDeContestar(salida.resource_kind!, salida.resource_id!, respuesta, nota, "enlace");
  return { ok: true, answer: respuesta, confirmation_number: salida.confirmation_number ?? null };
}

/**
 * Contesta desde el portal, con sesión.
 *
 * UNA sola sentencia condicionada, que es lo que la hace segura sin función de
 * Postgres: el `acceptance = 'pending'` va en el WHERE, no en un `if` de
 * JavaScript. Dos clics seguidos no escriben dos veces porque el segundo no
 * encuentra ninguna fila que cumpla.
 *
 * Y el proveedor va en el WHERE también. Comprobarlo antes en una lectura y
 * escribir después deja una rendija entre las dos; en el WHERE no hay rendija.
 */
export async function responderDesdeElPortal(
  companyId: string,
  supplierId: string,
  tipo: TipoDeRecurso,
  resourceId: string,
  respuesta: Respuesta,
  nota: string | null = null,
  userId: string | null = null,
  ahora: Date = new Date()
): Promise<RespuestaHecha> {
  if (!esTipo(tipo)) throw Object.assign(new Error("Tipo de servicio desconocido"), { status: 400 });
  if (respuesta !== "accepted" && respuesta !== "rejected") {
    throw Object.assign(new Error("La respuesta solo puede ser aceptar o rechazar"), { status: 400 });
  }

  const numero = respuesta === "accepted" ? newSupplierConfirmation() : null;
  const filas = await mustRead<{ id: string }[]>(
    "registrar la respuesta del proveedor",
    supabaseService().from(tipo)
      .update({
        acceptance: respuesta,
        responded_at: ahora.toISOString(),
        responded_by: userId,
        responded_via: "portal",
        response_note: nota,
        confirmation_number: numero,
      })
      .eq("id", resourceId)
      .eq("organization_id", companyId)
      .eq("supplier_id", supplierId)
      .eq("acceptance", "pending")
      .select("id")
  );

  if (!filas || filas.length === 0) {
    // No escribió nada: o no es suyo, o ya contestó, o venció. Se lee para
    // poder decir CUÁL de las tres, que son tres mensajes distintos.
    const fila = await filaDe(tipo, companyId, resourceId);
    if (!fila || fila.supplier_id !== supplierId) return { ok: false, motivo: "reassigned" };
    const estado = puedeResponder(fila, ahora);
    if (estado.ok === false && estado.motivo === "vencido") return { ok: false, motivo: "expired" };
    return { ok: false, motivo: "already_answered" };
  }

  // El enlace que se le hubiera mandado deja de valer: ya contestó por aquí.
  await tryWrite(
    "revocar el enlace tras contestar por el portal",
    supabaseService().from("supplier_response_token")
      .update({ revoked_at: ahora.toISOString(), revoked_reason: "contestado en el portal" })
      .eq("organization_id", companyId).eq("resource_kind", tipo).eq("resource_id", resourceId)
      .is("used_at", null).is("revoked_at", null)
  );

  await despuesDeContestar(tipo, resourceId, respuesta, nota, "portal", userId);
  return { ok: true, answer: respuesta, confirmation_number: numero };
}

/** La bitácora y el aviso, iguales vengan por donde vengan. */
async function despuesDeContestar(
  tipo: TipoDeRecurso,
  resourceId: string,
  respuesta: Respuesta,
  nota: string | null,
  via: "portal" | "enlace",
  userId: string | null = null
): Promise<void> {
  const fila = await mustRead<{ organization_id: string; supplier_id: string | null; service_date: string | null }>(
    "leer el servicio contestado",
    supabaseService().from(tipo).select("organization_id,supplier_id,service_date")
      .eq("id", resourceId).limit(1).maybeSingle()
  );
  if (!fila) return;

  await writeAudit({
    companyId: fila.organization_id,
    userId,
    action: respuesta === "accepted" ? "supplier.service.accepted" : "supplier.service.rejected",
    entityType: tipo,
    entityId: resourceId,
    description: `El proveedor ${respuesta === "accepted" ? "aceptó" : "rechazó"} el servicio (${via})`,
    severity: respuesta === "rejected" ? "warning" : "info",
    metadata: { supplier_id: fila.supplier_id, via, nota },
  });

  // Solo el RECHAZO avisa. Una aceptación por cada servicio asignado
  // convertiría la campana en ruido, y a la semana nadie la abre; el rechazo es
  // lo que deja a alguien sin guagua esta tarde.
  if (respuesta === "rejected") {
    await notify({
      companyId: fila.organization_id,
      event: "supplier_service_rejected",
      entityType: tipo,
      entityId: resourceId,
      vars: {
        proveedor: await nombreDeProveedor(fila.organization_id, fila.supplier_id),
        fecha: fila.service_date,
        motivo: nota,
      },
    });
  }
}

async function nombreDeProveedor(companyId: string, supplierId: string | null): Promise<string | null> {
  if (!supplierId) return null;
  const fila = await mustRead<{ name: string | null }>(
    "leer el nombre del proveedor",
    supabaseService().from("supplier").select("name")
      .eq("id", supplierId).eq("organization_id", companyId).limit(1).maybeSingle()
  );
  return fila?.name ?? null;
}

/* ═══════════════════════════════════════════ el plazo que vence */

export interface Barrido {
  vencidos: number;
  aceptadosPorSilencio: number;
}

/**
 * Lo que pasa cuando nadie contesta.
 *
 * Se decide POR PROVEEDOR, con `alert` por omisión, y eso es la decisión de la
 * ola: la aceptación tácita obliga a un tercero que no hizo nada, y reasignar
 * solo movería un autobús de verdad sin que lo decidiera una persona. Por eso
 * lo único que ocurre sin que nadie lo mande es que se marque vencido y suene
 * un aviso.
 *
 * Y el barrido es idempotente: solo toca filas en `pending` con el plazo ya
 * pasado, y lo primero que hace es sacarlas de ese estado.
 */
export async function barrerVencimientos(
  companyId: string,
  ahora: Date = new Date()
): Promise<Barrido> {
  let vencidos = 0;
  let aceptadosPorSilencio = 0;

  for (const tipo of TIPOS) {
    const filas = await mustRead<FilaDeServicio[]>(
      "buscar servicios sin respuesta",
      supabaseService().from(tipo).select(COLUMNAS)
        .eq("organization_id", companyId)
        .eq("acceptance", "pending")
        .lte("acceptance_deadline", ahora.toISOString())
        .limit(500)
    ) ?? [];

    for (const fila of filas) {
      // Se vuelve a comprobar con el mismo criterio del dominio en vez de
      // fiarse del filtro: `lte` sobre una columna nula no devuelve la fila,
      // pero un plazo nulo tampoco es un vencimiento y conviene que las dos
      // reglas sean la misma escrita una vez.
      if (!haVencido(fila.acceptance_deadline, ahora)) continue;

      const politica = await politicaDe(companyId, fila.supplier_id);
      const desenlace = alVencer(politica);
      const numero = desenlace.estado === "accepted" ? newSupplierConfirmation() : null;

      const escritas = await mustRead<{ id: string }[]>(
        "cerrar el plazo del servicio",
        supabaseService().from(tipo)
          .update({
            acceptance: desenlace.estado,
            responded_at: ahora.toISOString(),
            responded_via: desenlace.via,
            confirmation_number: numero,
          })
          .eq("id", fila.id)
          .eq("organization_id", companyId)
          .eq("acceptance", "pending")
          .select("id")
      );
      if (!escritas || escritas.length === 0) continue;

      if (desenlace.estado === "accepted") aceptadosPorSilencio += 1; else vencidos += 1;

      await writeAudit({
        companyId,
        action: desenlace.estado === "accepted" ? "supplier.service.tacit" : "supplier.service.expired",
        entityType: tipo,
        entityId: fila.id,
        description: desenlace.estado === "accepted"
          ? "Venció el plazo y su acuerdo lo da por aceptado"
          : "Venció el plazo sin respuesta del proveedor",
        severity: "warning",
        metadata: { supplier_id: fila.supplier_id, politica: politica ?? "alert" },
      });

      const vars = {
        proveedor: await nombreDeProveedor(companyId, fila.supplier_id),
        fecha: fila.service_date,
      };
      if (desenlace.estado === "accepted") {
        await notify({ companyId, event: "supplier_service_tacit", entityType: tipo, entityId: fila.id, vars });
      } else {
        await notify({ companyId, event: "supplier_service_expired", entityType: tipo, entityId: fila.id, vars });
      }
    }
  }

  return { vencidos, aceptadosPorSilencio };
}

/**
 * Las empresas que tienen algo vencido ahora mismo.
 *
 * El barrido es por empresa —la política es de cada proveedor y el aviso es de
 * cada operadora—, así que el trabajo de plataforma necesita saber a cuáles
 * llamar. Preguntarlo es mucho más barato que llamar a todas.
 */
export async function empresasConPlazosVencidos(ahora: Date = new Date()): Promise<string[]> {
  const empresas = new Set<string>();
  for (const tipo of TIPOS) {
    const filas = await mustRead<{ organization_id: string }[]>(
      "buscar empresas con plazos vencidos",
      supabaseService().from(tipo).select("organization_id")
        .eq("acceptance", "pending")
        .lte("acceptance_deadline", ahora.toISOString())
        .limit(2000)
    ) ?? [];
    for (const fila of filas) empresas.add(fila.organization_id);
  }
  return [...empresas];
}

async function politicaDe(companyId: string, supplierId: string | null): Promise<string | null> {
  if (!supplierId) return null;
  const fila = await mustRead<{ on_deadline_expiry: string | null }>(
    "leer la política de vencimiento del proveedor",
    supabaseService().from("supplier").select("on_deadline_expiry")
      .eq("id", supplierId).eq("organization_id", companyId).limit(1).maybeSingle()
  );
  return fila?.on_deadline_expiry ?? null;
}

const MOTIVO_HUMANO: Record<string, string> = {
  sin_peticion: "Ese servicio no está esperando respuesta del proveedor.",
  ya_respondido: "Ese servicio ya se contestó.",
  vencido: "El plazo para contestar ese servicio ya venció.",
};

export const MENSAJE_DEL_ENLACE: Record<MotivoDelEnlace, string> = {
  not_found: "Este enlace no existe.",
  revoked: "Este enlace ya no sirve: el servicio se le asignó a otro proveedor.",
  already_used: "Este enlace ya se usó. Tu respuesta quedó registrada.",
  expired: "El plazo para contestar ya venció. Llámanos y lo vemos.",
  already_answered: "Este servicio ya se contestó.",
  reassigned: "Este servicio se le asignó a otro proveedor.",
};
