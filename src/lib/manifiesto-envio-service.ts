import "server-only";
import { supabaseService } from "@/lib/supabase/service";
import type { Company } from "@/lib/types";
import { loadManifest, fuenteDeInquilino, type FuenteDelManifiesto } from "@/lib/manifest-service";
import { personName } from "@/lib/manifest";
import { enqueueMessage, tenantOutboxStore, type OutboxStore } from "@/lib/messaging/outbox";
import { recipientFor } from "@/lib/messaging/render";
import { formatDate, formatTime } from "@/lib/format";
import {
  vetoDeEnvio, huellaDeLaSalida, claveDeEnvio, paradasParaWhatsapp,
  ETIQUETA_DEL_PUBLICO, VENTANA_DE_ENVIO_HORAS,
  type PublicoDelManifiesto,
} from "@/lib/manifiesto-envio";

/**
 * QUIÉN RECIBE EL MANIFIESTO, Y CON QUÉ RECORTE.
 *
 * El QUÉ dice el papel lo decide `src/lib/manifiesto-envio.ts`, que es puro.
 * Aquí se decide el A QUIÉN, que exige leer de la base: el personal asignado a
 * la salida, los choferes y guías de cada ruta de recogida, y las empresas de
 * transporte detrás de unos y otros.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DE DÓNDE SE LEE ES UN PARÁMETRO, Y NO POR ELEGANCIA
 *
 * Quien barre esto es un cron sin cookies. Con `SUPABASE_USE_RLS=true` —que en
 * producción es obligatorio— las ayudas de inquilino resuelven el cliente a
 * partir de la petición, así que un barrido escrito contra ellas no fallaría:
 * leería CERO salidas y diría que no había nada que mandar. Es la misma trampa
 * que documenta `src/lib/messaging/outbox.ts`, y aquí se evita igual: la fuente
 * se inyecta (`FuenteDelManifiesto`) y el cron pasa la de servicio.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL GUÍA DE LA CASA Y EL GUÍA PRESTADO NO SON EL MISMO PÚBLICO
 *
 * Un guía con `supplier_id` nulo es de la casa: viaja con el grupo y cobra a
 * bordo, así que su copia lleva el saldo. Un guía que viene de una empresa de
 * transporte hace el mismo trabajo pero NO es quien cobra: su copia sale por el
 * corte de chofer. Sin esta distinción, «guía» habría querido decir «alguien
 * autorizado a pedirle dinero al cliente en nombre de la operadora».
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y QUIEN DIJO QUE NO, NO RECIBE LA LISTA
 *
 * Desde 0087 un proveedor acepta o rechaza el encargo. A quien rechazó —o a
 * quien se le venció el plazo sin contestar— no se le manda el manifiesto:
 * seguiría recibiendo la lista de clientes de un servicio que no va a operar.
 * Es la mitad que faltaba de la aceptación: sin esto, decir «no» no quitaba
 * ningún acceso.
 */

/** Aceptaciones que NO dan derecho a recibir la lista. */
const ACEPTACIONES_SIN_DERECHO = new Set(["rejected", "expired"]);

export interface DestinatarioDelManifiesto {
  publico: PublicoDelManifiesto;
  nombre: string;
  email: string | null;
  phone: string | null;
  /** De dónde salió, para la bitácora y para no mandarlo dos veces. */
  fuente: string;
}

interface FilaConProveedor {
  _id: string;
  acceptance?: string | null;
  supplier?: unknown;
  staff?: unknown;
  driver?: unknown;
  guide?: unknown;
  resource_role?: string | null;
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const texto = (v: unknown): string | null => {
  const t = typeof v === "string" ? v.trim() : "";
  return t || null;
};

/**
 * El público que le toca a una persona del equipo.
 *
 * `resource_role` (lo que hace EN ESTA SALIDA) manda sobre `staff_type` (lo que
 * hace normalmente): al fotógrafo que ese día va de guía se le asignó como guía,
 * y es la asignación la que describe el trabajo del día.
 */
export function publicoDePersona(
  persona: Record<string, unknown>,
  rolAsignado?: string | null
): PublicoDelManifiesto {
  const rol = String(rolAsignado || persona.staff_type || "").toLowerCase();
  const esGuia = rol === "guide";
  // Un guía prestado por una empresa de transporte hace el trabajo del guía y
  // no el de cajero: no lleva el saldo encima.
  return esGuia && !persona.supplier_id ? "guia" : "chofer";
}

function agregar(
  destinos: Map<string, DestinatarioDelManifiesto>,
  candidato: DestinatarioDelManifiesto
): void {
  if (!candidato.email && !candidato.phone) return;
  const clave = `${candidato.publico}|${candidato.fuente}`;
  // El mismo chofer puede estar asignado como recurso Y como conductor de una
  // ruta. Es una persona, un mensaje.
  if (!destinos.has(clave)) destinos.set(clave, candidato);
}

/**
 * A quién se le manda el manifiesto de esta salida.
 *
 * Se lee con las ayudas de inquilino y se acota por salida: no hay ninguna
 * consulta que dependa de quién pregunta, porque quien pregunta es el trabajo
 * programado y no tiene sesión.
 */
export async function destinatariosDeLaSalida(
  companyId: string,
  departureId: string,
  fuente: FuenteDelManifiesto = fuenteDeInquilino
): Promise<DestinatarioDelManifiesto[]> {
  const { recursos, rutas } = await fuente.equipo(companyId, departureId);

  const destinos = new Map<string, DestinatarioDelManifiesto>();

  const persona = (valor: unknown, rolAsignado?: string | null) => {
    const p = obj(valor);
    if (!p) return;
    // Una ficha dada de baja no recibe el manifiesto de mañana.
    if (String(p.status ?? "active") !== "active") return;
    agregar(destinos, {
      publico: publicoDePersona(p, rolAsignado),
      nombre: personName(p) || "Equipo",
      email: texto(p.email),
      phone: texto(p.phone),
      fuente: `staff:${String(p.id ?? p._id ?? "")}`,
    });
  };

  const proveedor = (fila: FilaConProveedor) => {
    const p = obj(fila.supplier);
    if (!p) return;
    // Quien rechazó el encargo, o dejó vencer el plazo, no recibe la lista.
    if (ACEPTACIONES_SIN_DERECHO.has(String(fila.acceptance ?? "").toLowerCase())) return;
    if (String(p.status ?? "active") !== "active") return;
    agregar(destinos, {
      publico: "proveedor",
      nombre: texto(p.contact_name) || personName(p) || "Proveedor",
      email: texto(p.email),
      phone: texto(p.phone),
      fuente: `supplier:${String(p.id ?? p._id ?? "")}`,
    });
  };

  for (const fila of recursos as unknown as FilaConProveedor[]) {
    persona(fila.staff, fila.resource_role);
    proveedor(fila);
  }
  for (const fila of rutas as unknown as FilaConProveedor[]) {
    persona(fila.driver, "driver");
    persona(fila.guide, "guide");
    proveedor(fila);
  }

  return [...destinos.values()];
}

export interface EnvioDelManifiesto {
  salida: string;
  huella: string;
  encolados: number;
  duplicados: number;
  sinSalida: string[];
  destinatarios: { nombre: string; publico: PublicoDelManifiesto; canales: string[] }[];
  veto: string | null;
}

/**
 * Encola el manifiesto de una salida hacia todos los que la operan.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL ADJUNTO NO SE GUARDA, Y EL RECORTE SÍ
 *
 * El PDF se compone al ENTREGAR, como el voucher, porque entre encolar y salir
 * puede haber entrado una reserva. Lo que la fila tiene que llevar es PARA QUIÉN
 * se recorta (`attachment_scope`): sin eso, el despachador no sabría qué corte
 * generar y compondría el manifiesto entero.
 *
 * Y la clave de deduplicación lleva la HUELLA de la lista, no solo la salida: un
 * manifiesto es una lista que cambia, y mandar una sola versión «porque ya se
 * mandó» deja al chofer saliendo sin la reserva que entró ayer por la tarde.
 */
export async function enviarManifiesto(
  company: Company | null,
  companyId: string,
  departureId: string,
  ahora: Date = new Date(),
  store: OutboxStore = tenantOutboxStore,
  fuente: FuenteDelManifiesto = fuenteDeInquilino
): Promise<EnvioDelManifiesto> {
  const m = await loadManifest(companyId, departureId, fuente);
  const dep = m.departure;

  const veto = vetoDeEnvio(
    { departure_at: dep.departure_at as string, status: dep.status as string },
    ahora
  );
  const huella = huellaDeLaSalida(m.rows);
  const vacio: EnvioDelManifiesto = {
    salida: departureId, huella, encolados: 0, duplicados: 0,
    sinSalida: [], destinatarios: [], veto: veto?.motivo ?? null,
  };
  if (veto) return vacio;

  const destinatarios = await destinatariosDeLaSalida(companyId, departureId, fuente);
  if (destinatarios.length === 0) return { ...vacio, veto: "Nadie tiene asignada esta salida" };

  const producto = (m.product?.name as string) || "Salida";
  const cuando = dep.departure_at as string | null;
  const vehiculos = m.vehicles
    .map((v) => [v.plate, v.name].map((x) => (typeof x === "string" ? x.trim() : "")).find(Boolean))
    .filter(Boolean)
    .join(" · ");

  const resultado: EnvioDelManifiesto = { ...vacio };

  for (const destino of destinatarios) {
    const canales: string[] = [];
    for (const channel of ["email", "whatsapp"] as const) {
      const contacto = { email: destino.email, phone: destino.phone, whatsapp: destino.phone };
      const direccion = recipientFor(channel, contacto);
      // Sin dirección para este canal no se encola nada: `enqueueMessage`
      // guardaría una fila fallida por cada pasada del barrido, y en una semana
      // la bandeja sería ilegible. Lo que no se puede mandar por aquí se manda
      // por el otro canal, que es justo por lo que hay dos.
      if (!direccion) continue;

      const salida = await enqueueMessage(
        company,
        companyId,
        {
          key: "manifest_dispatch",
          channel,
          contact: contacto,
          toName: destino.nombre,
          vars: {
            destinatario: destino.nombre,
            producto,
            fecha: cuando ? formatDate(cuando) : "sin fecha",
            hora: cuando ? formatTime(cuando) : "sin hora",
            pax: m.summary.seats,
            vehiculos: vehiculos || "sin asignar",
            punto_encuentro:
              (dep.meeting_point as string) || (m.product?.meeting_point as string) || "sin indicar",
            paradas: paradasParaWhatsapp(m.stops),
          },
          refs: { departure: departureId },
          dedupeKey: claveDeEnvio(departureId, destino.publico, channel, destino.fuente, huella),
          anchor: cuando,
          // Solo el correo lleva el papel. El WhatsApp lleva las paradas y
          // NUNCA un nombre de cliente: un mensaje se reenvía de un grupo a
          // otro sin pensarlo y una captura viaja más lejos que un adjunto.
          attachmentKind: channel === "email" ? "manifest" : null,
          attachmentScope: destino.publico,
        },
        store
      );

      if (salida.status === "queued") { resultado.encolados++; canales.push(channel); }
      else if (salida.status === "duplicate") resultado.duplicados++;
      else resultado.sinSalida.push(`${destino.nombre} (${channel}): ${
        salida.status === "undeliverable" ? salida.reason : salida.reason
      }`);
    }
    resultado.destinatarios.push({ nombre: destino.nombre, publico: destino.publico, canales });
  }

  return resultado;
}

/**
 * Las salidas de una empresa que entran en la ventana de envío.
 *
 * La ventana es la del módulo puro (36 h) y se aplica DOS VECES a propósito:
 * aquí para no leer la agenda entera, y dentro de `enviarManifiesto` para que
 * una llamada manual desde la pantalla no pueda saltársela.
 */
export async function barrerManifiestos(
  company: Company | null,
  companyId: string,
  ahora: Date = new Date(),
  store: OutboxStore = tenantOutboxStore,
  fuente: FuenteDelManifiesto = fuenteDeInquilino
): Promise<{ salidas: number; encolados: number; duplicados: number }> {
  // La agenda se lee con la llave de servicio y el filtro por empresa a mano:
  // quien barre es el cron. Es UNA consulta y no merece un método más en la
  // fuente, pero el `eq("organization_id", …)` de aquí es todo el aislamiento
  // que hay, así que no se puede perder de vista.
  const { data, error } = await supabaseService()
    .from("departure")
    .select("id, status")
    .eq("organization_id", companyId)
    .gte("departure_at", ahora.toISOString())
    .lte("departure_at", new Date(ahora.getTime() + VENTANA_DE_ENVIO_HORAS * 3_600_000).toISOString())
    .order("departure_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(error.message);
  const salidas = ((data ?? []) as unknown as { id: string }[]).map((r) => ({ _id: String(r.id) }));

  let encolados = 0;
  let duplicados = 0;
  for (const salida of salidas) {
    try {
      const r = await enviarManifiesto(company, companyId, salida._id, ahora, store, fuente);
      encolados += r.encolados;
      duplicados += r.duplicados;
    } catch (err) {
      // Una salida con un problema no puede dejar sin manifiesto a las demás.
      console.error(`[manifiesto] la salida ${salida._id} no se pudo encolar:`, err);
    }
  }
  return { salidas: salidas.length, encolados, duplicados };
}

export { ETIQUETA_DEL_PUBLICO };
