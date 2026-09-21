import "server-only";
import { supabaseService } from "@/lib/supabase/service";
import { mustRead, mustWrite, tryWrite } from "@/lib/supabase/io";
import { notify } from "@/lib/notify-service";
import { enqueuePostTourSurvey } from "@/lib/messaging/events";
import { newDocumentNumber } from "@/lib/codes";
import { APP_URL } from "@/lib/stripe";
import { tenantQuery } from "@/lib/tenant";
import {
  askVerdict, askAt, expiresAt, canAnswer, nextStep, bandOf, summarize, groupNps,
  SURVEY_FATIGUE_DAYS,
  type NpsResult, type SurveyRow, type VoiceSummary,
} from "@/lib/voice";
import { refId, type Company } from "@/lib/types";

/**
 * LA VOZ DEL CLIENTE, CONECTADA CON LA OPERACIÓN.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ TODO ESTE MÓDULO HABLA CON LA LLAVE DE SERVICIO
 *
 * Los tres caminos que importan aquí NO tienen sesión:
 *
 *  · el barrido que pregunta corre desde un cron, de madrugada;
 *  · el pasajero que contesta no tiene cuenta y nunca la va a tener;
 *  · el que se da de baja, menos todavía.
 *
 * Así que el filtro por empresa lo pone el código a mano en cada consulta, como
 * en el conector de OTAs. Cada `eq("organization_id", …)` de aquí es la única
 * frontera que hay entre dos operadoras, y por eso hay pruebas que la empujan.
 *
 * El panel sí tiene sesión y va por las ayudas de inquilino, donde la RLS
 * trabaja por nosotros.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL TOKEN ES LA LLAVE, Y ES TODO LO QUE HAY
 *
 * Quien tiene el enlace contesta. No hay contraseña ni segundo factor, porque
 * exigírselos a alguien que acaba de bajarse de una guagua es garantizar que no
 * conteste nadie. Lo que lo hace aceptable es lo que ese enlace PUEDE hacer:
 * poner una nota, escribir un comentario y darse de baja. Nada que mueva
 * dinero, nada que enseñe datos de otro, y caduca.
 */

/* ════════════════════════════════════════════════════════ 1 · preguntar ══ */

interface BookingRow {
  id: string;
  status: string | null;
  checkin_status: string | null;
  octo_uuid: string | null;
  customer_id: string | null;
  product_id: string | null;
  departure_id: string | null;
}

interface CustomerRow {
  id: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  language: string | null;
  first_name: string | null;
  last_name: string | null;
  survey_opt_out: boolean | null;
}

export interface AskResult {
  /** Encuestas creadas y mandadas. */
  asked: number;
  /** Filas creadas SIN mandar, con su motivo. */
  skipped: Record<string, number>;
  /** Reservas que ya tenían su encuesta de antes. */
  already: number;
}

/** El enlace que le llega al pasajero. */
export function surveyUrl(token: string): string {
  return `${APP_URL.replace(/\/+$/, "")}/opinar/${encodeURIComponent(token)}`;
}

/** Un token que no se adivina. Es la única llave de la encuesta. */
function newSurveyToken(): string {
  return newDocumentNumber("OPI").toLowerCase();
}

/**
 * Preguntar por una salida que YA terminó.
 *
 * Es idempotente por construcción: la tabla tiene una única por
 * `(organization_id, booking_id)`, y antes de escribir se leen las que ya hay.
 * Correrlo dos veces no le escribe dos veces a nadie — que es exactamente lo
 * que un barrido diario tiene que garantizar cuando alguien lo dispara a mano.
 */
export async function askDeparture(
  company: Company | null,
  companyId: string,
  departureId: string,
  now: Date = new Date()
): Promise<AskResult> {
  const sb = supabaseService();
  const out: AskResult = { asked: 0, skipped: {}, already: 0 };

  const departure = await mustRead<{ id: string; departure_at: string | null; product_id: string | null }>(
    "leer la salida para preguntar",
    sb.from("departure").select("id,departure_at,product_id")
      .eq("organization_id", companyId).eq("id", departureId).maybeSingle()
  );
  if (!departure) return out;

  const product = departure.product_id
    ? await mustRead<{ id: string; name: string | null; duration_hours: number | null }>(
        "leer el producto de la salida",
        sb.from("product").select("id,name,duration_hours")
          .eq("organization_id", companyId).eq("id", departure.product_id).maybeSingle()
      )
    : null;

  // Todavía no toca: el tour no ha terminado o no han pasado las horas.
  const cuando = askAt(departure.departure_at, product?.duration_hours ?? null);
  if (!cuando || cuando.getTime() > now.getTime()) return out;

  const bookings = (await mustRead<BookingRow[]>(
    "leer las reservas de la salida",
    sb.from("booking")
      .select("id,status,checkin_status,octo_uuid,customer_id,product_id,departure_id")
      .eq("organization_id", companyId).eq("departure_id", departureId).limit(200)
  )) ?? [];
  if (bookings.length === 0) return out;

  // Las que ya tienen encuesta: correr dos veces no puede escribir dos veces.
  const yaHay = new Set(((await mustRead<{ booking_id: string }[]>(
    "leer las encuestas que ya existen",
    sb.from("guest_survey").select("booking_id")
      .eq("organization_id", companyId)
      .in("booking_id", bookings.map((b) => b.id)).limit(500)
  )) ?? []).map((r) => String(r.booking_id)));

  const customerIds = [...new Set(bookings.map((b) => b.customer_id).filter(Boolean).map(String))];
  const customers = new Map<string, CustomerRow>();
  if (customerIds.length > 0) {
    for (const row of (await mustRead<CustomerRow[]>(
      "leer los clientes de la salida",
      sb.from("customer")
        .select("id,email,phone,whatsapp,language,first_name,last_name,survey_opt_out")
        .eq("organization_id", companyId).in("id", customerIds).limit(200)
    )) ?? []) customers.set(String(row.id), row);
  }

  // La fatiga: cuándo se le preguntó por última vez a cada uno de estos.
  const ultima = new Map<string, string>();
  if (customerIds.length > 0) {
    const desde = new Date(now.getTime() - SURVEY_FATIGUE_DAYS * 86_400_000).toISOString();
    for (const row of (await mustRead<{ customer_id: string; asked_at: string }[]>(
      "leer cuándo se preguntó por última vez",
      sb.from("guest_survey").select("customer_id,asked_at")
        .eq("organization_id", companyId).in("customer_id", customerIds)
        .gte("asked_at", desde).limit(500)
    )) ?? []) {
      const key = String(row.customer_id);
      const previa = ultima.get(key);
      if (!previa || String(row.asked_at) > previa) ultima.set(key, String(row.asked_at));
    }
  }

  const guideId = await guideOf(companyId, departureId);

  for (const booking of bookings) {
    if (yaHay.has(String(booking.id))) { out.already++; continue; }

    const customer = booking.customer_id ? customers.get(String(booking.customer_id)) ?? null : null;
    const verdict = askVerdict({
      status: booking.status,
      checkin_status: booking.checkin_status,
      octo_uuid: booking.octo_uuid,
      email: customer?.email,
      phone: customer?.phone,
      whatsapp: customer?.whatsapp,
      optOut: customer?.survey_opt_out === true,
      lastAskedAt: booking.customer_id ? ultima.get(String(booking.customer_id)) ?? null : null,
    }, now);

    // Sin `organization_id`: va escrito EN CADA alta, y no aquí. Un campo de
    // empresa que viaja escondido en un objeto compartido es un campo que nadie
    // ve al leer la escritura — y es justo el que decide de quién es la fila.
    const base = {
      booking_id: booking.id,
      departure_id: departureId,
      product_id: booking.product_id ?? departure.product_id ?? null,
      customer_id: booking.customer_id ?? null,
      guide_staff_id: guideId,
      token: newSurveyToken(),
      language: customer?.language ?? null,
    };

    if (!verdict.ask) {
      // La fila se escribe IGUAL, con el motivo. Sin ella, el panel no podría
      // distinguir «no contestaron» de «no se les preguntó».
      await mustWrite(`anotar la encuesta omitida de ${booking.id}`,
        sb.from("guest_survey").insert({
          organization_id: companyId, ...base, status: "skipped", skip_reason: verdict.reason,
        }));
      out.skipped[verdict.reason] = (out.skipped[verdict.reason] ?? 0) + 1;
      continue;
    }

    const askedAt = now.toISOString();
    await mustWrite(`crear la encuesta de ${booking.id}`, sb.from("guest_survey").insert({
      organization_id: companyId,
      ...base,
      status: "pending",
      asked_at: askedAt,
      expires_at: expiresAt(askedAt)?.toISOString() ?? null,
    }));

    /**
     * El mensaje va DESPUÉS de la fila y fuera de su comprobación.
     *
     * Si se mandara primero y la fila fallara, el pasajero recibiría un enlace
     * que no abre nada. Al revés —fila escrita y mensaje caído— queda una
     * encuesta sin mandar, que el barrido de mañana no reintenta (ya existe la
     * fila) pero que al menos no le miente a nadie. La cola de mensajería tiene
     * su propio reintento para lo que sí llegó a encolarse.
     */
    try {
      await enqueuePostTourSurvey(company, companyId, {
        customer: customer
          ? {
              id: customer.id, email: customer.email, phone: customer.phone,
              whatsapp: customer.whatsapp, language: customer.language,
              first_name: customer.first_name, last_name: customer.last_name,
            }
          : null,
        bookingId: booking.id,
        departureId,
        productName: product?.name ?? "",
        travelDate: departure.departure_at,
        url: surveyUrl(base.token),
      });
    } catch (err) {
      console.error(`[voz] no se pudo encolar la encuesta de ${booking.id}:`, err);
    }
    out.asked++;
  }

  return out;
}

/** Quién llevó la salida, para congelarlo en la encuesta. */
async function guideOf(companyId: string, departureId: string): Promise<string | null> {
  const rows = await mustRead<{ staff_id: string | null }[]>(
    "leer el guía de la salida",
    supabaseService().from("departure_resource").select("staff_id")
      .eq("organization_id", companyId)
      .eq("departure_id", departureId)
      .eq("resource_role", "guide")
      .not("staff_id", "is", null)
      .limit(1)
  );
  return rows?.[0]?.staff_id ? String(rows[0].staff_id) : null;
}

/**
 * El barrido: todas las salidas que ya terminaron y todavía no se preguntaron.
 *
 * Mira hacia atrás una ventana corta. Sin ese suelo, el día que alguien active
 * el módulo el sistema le escribiría a TODOS los pasajeros de los últimos dos
 * años preguntándoles por una excursión que hicieron en 2024 — que es la forma
 * más rápida de que una operadora acabe en las listas de spam el mismo día que
 * estrena la funcionalidad.
 */
export const SWEEP_LOOKBACK_DAYS = 3;

export async function sweepDueSurveys(
  company: Company | null,
  companyId: string,
  now: Date = new Date()
): Promise<{ departures: number; asked: number; skipped: number }> {
  const sb = supabaseService();
  const desde = new Date(now.getTime() - SWEEP_LOOKBACK_DAYS * 86_400_000).toISOString();

  const departures = (await mustRead<{ id: string }[]>(
    "leer las salidas que ya terminaron",
    sb.from("departure").select("id")
      .eq("organization_id", companyId)
      .gte("departure_at", desde)
      .lte("departure_at", now.toISOString())
      .limit(200)
  )) ?? [];

  let asked = 0, skipped = 0, tocadas = 0;
  for (const departure of departures) {
    try {
      const r = await askDeparture(company, companyId, String(departure.id), now);
      if (r.asked > 0 || Object.keys(r.skipped).length > 0) tocadas++;
      asked += r.asked;
      skipped += Object.values(r.skipped).reduce((s, n) => s + n, 0);
    } catch (err) {
      // Una salida que falla no puede dejar sin preguntar a las demás.
      console.error(`[voz] no se pudo preguntar por la salida ${departure.id}:`, err);
    }
  }
  return { departures: tocadas, asked, skipped };
}

/* ═════════════════════════════════════════════════════════ 2 · contestar ══ */

export interface SurveyView {
  token: string;
  companyId: string;
  companyName: string;
  productName: string;
  travelDate: string | null;
  customerName: string;
  language: string;
  status: string;
  nps: number | null;
  reviewUrl: string | null;
}

interface SurveyRowFull {
  id: string;
  organization_id: string;
  booking_id: string;
  departure_id: string | null;
  product_id: string | null;
  customer_id: string | null;
  guide_staff_id: string | null;
  token: string;
  status: string;
  asked_at: string | null;
  expires_at: string | null;
  nps: number | null;
  language: string | null;
}

const SURVEY_COLUMNS =
  "id,organization_id,booking_id,departure_id,product_id,customer_id,guide_staff_id,token,status,asked_at,expires_at,nps,language";

async function rowByToken(token: string): Promise<SurveyRowFull | null> {
  if (!token || token.length > 64) return null;
  // Por el token a secas: la página pública no sabe de qué empresa es el
  // cliente. Es la razón por la que el token es único en TODA la tabla.
  const rows = await mustRead<SurveyRowFull[]>(
    "buscar la encuesta por su enlace",
    supabaseService().from("guest_survey").select(SURVEY_COLUMNS).eq("token", token).limit(1)
  );
  return rows?.[0] ?? null;
}

/** Lo que ve quien abre el enlace. */
export async function loadSurvey(token: string): Promise<SurveyView | null> {
  const row = await rowByToken(token);
  if (!row) return null;
  const sb = supabaseService();

  const [company, product, customer] = await Promise.all([
    mustRead<{ id: string; name: string | null; review_url: string | null }>(
      "leer la empresa de la encuesta",
      sb.from("organizations").select("id,name,review_url").eq("id", row.organization_id).maybeSingle()
    ),
    row.product_id
      ? mustRead<{ name: string | null }>("leer el producto de la encuesta",
          sb.from("product").select("name")
            .eq("organization_id", row.organization_id).eq("id", row.product_id).maybeSingle())
      : Promise.resolve(null),
    row.customer_id
      ? mustRead<{ first_name: string | null; last_name: string | null }>("leer al cliente de la encuesta",
          sb.from("customer").select("first_name,last_name")
            .eq("organization_id", row.organization_id).eq("id", row.customer_id).maybeSingle())
      : Promise.resolve(null),
  ]);

  const departure = row.departure_id
    ? await mustRead<{ departure_at: string | null }>("leer la fecha del viaje",
        sb.from("departure").select("departure_at")
          .eq("organization_id", row.organization_id).eq("id", row.departure_id).maybeSingle())
    : null;

  return {
    token: row.token,
    companyId: row.organization_id,
    companyName: String(company?.name ?? ""),
    productName: String(product?.name ?? ""),
    travelDate: departure?.departure_at ?? null,
    customerName: [customer?.first_name, customer?.last_name].filter(Boolean).join(" ").trim(),
    language: String(row.language || "es"),
    status: String(row.status),
    nps: row.nps,
    // La dirección de la reseña pública NO se entrega hasta que se sabe la
    // nota: mandarla en la misma página que la pregunta es pedirle al
    // detractor que vaya a contarlo a Google.
    reviewUrl: null,
  };
}

export interface AnswerInput {
  nps: number;
  ratingGuide?: number | null;
  ratingTransport?: number | null;
  ratingValue?: number | null;
  comment?: string | null;
}

export interface AnswerOutcome {
  ok: boolean;
  /** Presente exactamente cuando `ok` es falso. */
  reason?: "not_found" | "already_answered" | "expired" | "not_asked" | "invalid";
  /** Qué enseñarle después. Solo cuando contestó. */
  step?: ReturnType<typeof nextStep>;
  /** A dónde mandarlo a dejar la reseña, si toca y si está configurada. */
  reviewUrl?: string | null;
}

/**
 * Registrar la respuesta del pasajero.
 *
 * Lo que decide qué pasa después no es la pantalla, es esta función: la
 * pantalla solo enseña lo que se le diga. Si la bifurcación viviera en el
 * navegador, cualquiera podría pedir la dirección de la reseña pública
 * poniéndose un 10 en el inspector — y la operadora acabaría con reseñas de
 * gente que puso un 2.
 */
export async function answerSurvey(token: string, input: AnswerInput): Promise<AnswerOutcome> {
  const row = await rowByToken(token);
  if (!row) return { ok: false, reason: "not_found" };

  const verdict = canAnswer(row);
  if (!verdict.ok) return { ok: false, reason: verdict.reason };

  if (bandOf(input.nps) === null) return { ok: false, reason: "invalid" };
  const nota = Math.round(Number(input.nps));

  const sb = supabaseService();
  await mustWrite("guardar la respuesta de la encuesta", sb.from("guest_survey").update({
    status: "answered",
    answered_at: new Date().toISOString(),
    nps: nota,
    rating_guide: escala5(input.ratingGuide),
    rating_transport: escala5(input.ratingTransport),
    rating_value: escala5(input.ratingValue),
    comment: (input.comment ?? "").trim().slice(0, 4000) || null,
  }).eq("organization_id", row.organization_id).eq("id", row.id));

  const paso = nextStep(nota);

  if (paso === "recover") {
    // Un detractor no es un dato: es una llamada. Que falle abrir el caso no
    // puede borrar la respuesta que el cliente ya dio.
    try {
      await openRecoveryCase(row, nota, input.comment ?? null);
    } catch (err) {
      console.error(`[voz] no se pudo abrir el caso de recuperación de ${row.id}:`, err);
    }
    return { ok: true, step: paso, reviewUrl: null };
  }

  if (paso === "review") {
    const company = await mustRead<{ review_url: string | null }>(
      "leer la dirección de reseñas de la empresa",
      sb.from("organizations").select("review_url").eq("id", row.organization_id).maybeSingle()
    );
    const url = (company?.review_url ?? "").trim();
    if (url) {
      await tryWrite("marcar que se le pidió la reseña",
        sb.from("guest_survey").update({ review_requested: true })
          .eq("organization_id", row.organization_id).eq("id", row.id));
      return { ok: true, step: paso, reviewUrl: url };
    }
    // Sin dirección configurada no hay a dónde mandarlo: se le da las gracias y
    // ya está. Enseñar un botón que no lleva a ningún sitio es peor.
    return { ok: true, step: "thanks", reviewUrl: null };
  }

  return { ok: true, step: paso, reviewUrl: null };
}

function escala5(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const v = Math.round(n);
  return v >= 1 && v <= 5 ? v : null;
}

/** El cliente pinchó en «dejar la reseña»: sirve para saber si el embudo cierra. */
export async function markReviewClicked(token: string): Promise<void> {
  const row = await rowByToken(token);
  if (!row) return;
  await tryWrite("anotar que fue a dejar la reseña",
    supabaseService().from("guest_survey").update({ review_clicked_at: new Date().toISOString() })
      .eq("organization_id", row.organization_id).eq("id", row.id));
}

/**
 * La baja, desde el pie de la propia encuesta.
 *
 * Silencia las encuestas y NO los mensajes de servicio: el recordatorio de la
 * víspera lleva la hora de recogida y es parte de lo que el cliente compró.
 * Darle de baja de eso sería dejarlo tirado en el lobby del hotel.
 */
export async function optOutByToken(token: string): Promise<boolean> {
  const row = await rowByToken(token);
  if (!row?.customer_id) return false;
  await mustWrite("dar de baja al cliente de las encuestas",
    supabaseService().from("customer").update({ survey_opt_out: true })
      .eq("organization_id", row.organization_id).eq("id", row.customer_id));
  return true;
}

/* ═══════════════════════════════════════════════════ 3 · la recuperación ══ */

async function openRecoveryCase(row: SurveyRowFull, nota: number, comentario: string | null): Promise<void> {
  const sb = supabaseService();
  const created = await mustRead<{ id: string }>(
    "abrir el caso de recuperación",
    sb.from("guest_case").insert({
      organization_id: row.organization_id,
      code: newDocumentNumber("CASO"),
      case_type: "complaint",
      status: "open",
      // Alta y no urgente: urgente es alguien tirado en un muelle. Esto es una
      // llamada que hay que hacer hoy, no ahora mismo.
      priority: "high",
      channel: "web",
      subject: `Encuesta con nota ${nota}/10`,
      description: comentario?.trim()
        ? comentario.trim().slice(0, 4000)
        : "El pasajero puso una nota baja y no dejó comentario: hay que llamarlo para saber qué pasó.",
      customer_id: row.customer_id,
      booking_id: row.booking_id,
      satisfaction_score: nota,
    }).select("id").single()
  );

  if (created?.id) {
    await tryWrite("enlazar el caso con la encuesta",
      sb.from("guest_survey").update({ guest_case_id: created.id })
        .eq("organization_id", row.organization_id).eq("id", row.id));
  }

  await notify({
    companyId: row.organization_id,
    event: "survey_detractor",
    vars: {
      score: nota,
      comment: comentario?.trim()?.slice(0, 120) ?? "",
      case: created?.id ?? "",
    },
  });
}

/* ═════════════════════════════════════════════════════════ 4 · caducar ══ */

/**
 * Cerrar las que nadie contestó.
 *
 * No es cosmético: una encuesta `pending` de hace tres meses cuenta como «se
 * preguntó y estamos esperando», y con suficientes de esas la tasa de respuesta
 * del mes pasado sigue cambiando. Un dato cerrado tiene que quedarse quieto.
 */
export async function expireSurveys(companyId: string, now: Date = new Date()): Promise<number> {
  const sb = supabaseService();
  const vencidas = (await mustRead<{ id: string }[]>(
    "leer las encuestas caducadas",
    sb.from("guest_survey").select("id")
      .eq("organization_id", companyId)
      .eq("status", "pending")
      .not("expires_at", "is", null)
      .lt("expires_at", now.toISOString())
      .limit(500)
  )) ?? [];
  if (vencidas.length === 0) return 0;

  await mustWrite("caducar las encuestas sin contestar",
    sb.from("guest_survey").update({ status: "expired" })
      .eq("organization_id", companyId).in("id", vencidas.map((v) => String(v.id))));
  return vencidas.length;
}

/* ═══════════════════════════════════════════════════════════ 5 · el panel ══ */

export interface VoicePanelRow {
  id: string;
  bookingId: string;
  customerName: string;
  productName: string;
  guideName: string;
  nps: number | null;
  comment: string | null;
  answeredAt: string | null;
  askedAt: string | null;
  status: string;
  skipReason: string | null;
  caseId: string | null;
}

export interface VoicePanel {
  summary: VoiceSummary;
  byProduct: { key: string; name: string; nps: NpsResult }[];
  byGuide: { key: string; name: string; nps: NpsResult }[];
  byMonth: { key: string; nps: NpsResult }[];
  /** Los que hay que llamar: detractores con su caso abierto. */
  detractors: VoicePanelRow[];
  latest: VoicePanelRow[];
}

/**
 * Lo que ve la operadora.
 *
 * Va por las ayudas de inquilino y no por la llave de servicio: aquí SÍ hay
 * sesión, y con ella la RLS hace de segunda frontera por debajo del filtro.
 * Es la diferencia con el resto de este módulo, y es deliberada.
 */
export async function loadVoice(companyId: string, days = 90): Promise<VoicePanel> {
  const desde = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = await tenantQuery<Record<string, unknown>>(companyId, "guest_survey", {
    _filter: { created_at: { gte: desde } },
    _limit: 2000,
    _sort: { created_at: "desc" },
  });

  const productIds = [...new Set(rows.map((r) => refId(r.product)).filter(Boolean) as string[])];
  const guideIds = [...new Set(rows.map((r) => refId(r.guide_staff)).filter(Boolean) as string[])];
  const customerIds = [...new Set(rows.map((r) => refId(r.customer)).filter(Boolean) as string[])];

  const [products, guides, customers] = await Promise.all([
    productIds.length
      ? tenantQuery<{ _id: string; name?: string }>(companyId, "product",
          { _filter: { _id: { in: productIds } }, _limit: 300 })
      : Promise.resolve([]),
    guideIds.length
      ? tenantQuery<{ _id: string; full_name?: string }>(companyId, "staff",
          { _filter: { _id: { in: guideIds } }, _limit: 300 })
      : Promise.resolve([]),
    customerIds.length
      ? tenantQuery<{ _id: string; first_name?: string; last_name?: string }>(companyId, "customer",
          { _filter: { _id: { in: customerIds } }, _limit: 500 })
      : Promise.resolve([]),
  ]);

  const nombreProducto = new Map(products.map((p) => [p._id, String(p.name ?? "")]));
  const nombreGuia = new Map(guides.map((g) => [g._id, String(g.full_name ?? "")]));
  const nombreCliente = new Map(customers.map((c) =>
    [c._id, [c.first_name, c.last_name].filter(Boolean).join(" ").trim()]));

  const planas: SurveyRow[] = rows.map((r) => ({
    status: String(r.status ?? ""),
    skip_reason: (r.skip_reason as string | null) ?? null,
    nps: (r.nps as number | null) ?? null,
    answered_at: (r.answered_at as string | null) ?? null,
    product_id: refId(r.product),
    guide_staff_id: refId(r.guide_staff),
  }));

  const vista = (r: Record<string, unknown>): VoicePanelRow => ({
    id: String(r._id ?? r.id ?? ""),
    bookingId: refId(r.booking) ?? "",
    customerName: nombreCliente.get(refId(r.customer) ?? "") || "Cliente",
    productName: nombreProducto.get(refId(r.product) ?? "") || "",
    guideName: nombreGuia.get(refId(r.guide_staff) ?? "") || "",
    nps: (r.nps as number | null) ?? null,
    comment: (r.comment as string | null) ?? null,
    answeredAt: (r.answered_at as string | null) ?? null,
    askedAt: (r.asked_at as string | null) ?? null,
    status: String(r.status ?? ""),
    skipReason: (r.skip_reason as string | null) ?? null,
    caseId: refId(r.guest_case),
  });

  const contestadas = rows.filter((r) => String(r.status ?? "") === "answered");

  return {
    summary: summarize(planas),
    byProduct: groupNps(planas, (f) => f.product_id ?? null)
      .map((g) => ({ ...g, name: nombreProducto.get(g.key) || "Sin producto" })),
    byGuide: groupNps(planas, (f) => f.guide_staff_id ?? null)
      .map((g) => ({ ...g, name: nombreGuia.get(g.key) || "Sin guía asignado" })),
    byMonth: groupNps(planas, (f) => (f.answered_at ?? "").slice(0, 7) || null)
      .sort((a, b) => a.key.localeCompare(b.key)),
    // Primero los que todavía nadie ha llamado.
    detractors: contestadas
      .filter((r) => bandOf(r.nps) === "detractor")
      .map(vista)
      .sort((a, b) => String(b.answeredAt ?? "").localeCompare(String(a.answeredAt ?? ""))),
    latest: contestadas.slice(0, 50).map(vista),
  };
}
