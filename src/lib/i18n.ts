/**
 * EL IDIOMA DEL HUÉSPED.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ SE TRADUCE Y QUÉ NO, Y POR QUÉ
 *
 * Se traduce **lo que ve el huésped**: la página pública de reservas, el
 * voucher que enseña en la puerta y los mensajes automáticos que recibe.
 *
 * NO se traduce el panel de la operadora. Es una decisión, no una tarea
 * pendiente: el equipo de una operadora dominicana trabaja en español, y
 * traducir cuarenta pantallas de gestión para nadie es exactamente la clase de
 * trabajo que parece internacionalización y no sirve a ningún usuario. El
 * cliente que no habla español es el TURISTA, y el turista solo ve tres cosas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DE DÓNDE SALE EL IDIOMA
 *
 * Por orden de autoridad, y el orden importa:
 *
 *  1. Lo que el huésped eligió a mano (`?lang=en`). Nada lo discute.
 *  2. Lo que su navegador dice (`Accept-Language`). Es lo que acierta el 95 %
 *     de las veces sin que nadie toque nada.
 *  3. El español.
 *
 * Y una vez que reserva, su idioma queda en su ficha: los avisos de la víspera
 * y el recordatorio de saldo salen en el idioma en el que compró, aunque para
 * entonces ya no haya navegador de por medio.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SIN CADENA, EL ESPAÑOL
 *
 * Nunca se enseña la clave del diccionario. Una pantalla que dice
 * `booking.submit` es peor que una que dice «Pedir mi lugar» a un inglés: la
 * segunda se entiende con el contexto, la primera parece rota.
 *
 * Todo lo de aquí es puro.
 */

export const SUPPORTED_LOCALES = ["es", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "es";

export const LOCALE_LABEL: Record<Locale, string> = {
  es: "Español",
  en: "English",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Normaliza lo que llegue a un idioma que existe.
 *
 * `en-US`, `EN`, `en_GB` son todos inglés. No normalizar dejaría que un
 * navegador estadounidense, que manda `en-US`, se quedara en español.
 */
export function normalizeLocale(value: string | null | undefined): Locale | null {
  if (!value) return null;
  const base = value.trim().toLowerCase().replace("_", "-").split("-")[0];
  return isLocale(base) ? base : null;
}

interface AcceptEntry {
  locale: Locale;
  quality: number;
}

/**
 * Lee la cabecera `Accept-Language` respetando el peso (`q`).
 *
 * Un navegador manda «fr-CA,fr;q=0.9,en;q=0.8,es;q=0.5»: el orden de aparición
 * no basta, porque el primero que soportamos puede tener menos peso que otro
 * que viene después. Ignorar la `q` haría que a un francófono con inglés
 * preferente se le hablara en español.
 */
export function parseAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const entries: AcceptEntry[] = [];

  for (const part of header.split(",")) {
    const [tag, ...params] = part.trim().split(";");
    const locale = normalizeLocale(tag);
    if (!locale) continue;
    const q = params
      .map((p) => /^q=([\d.]+)$/i.exec(p.trim())?.[1])
      .find((v): v is string => Boolean(v));
    const quality = q === undefined ? 1 : Number(q);
    entries.push({ locale, quality: Number.isFinite(quality) ? quality : 0 });
  }

  if (entries.length === 0) return null;
  entries.sort((a, b) => b.quality - a.quality);
  return entries[0].quality > 0 ? entries[0].locale : null;
}

/**
 * El idioma que toca, por orden de autoridad.
 *
 * Lo elegido a mano gana siempre: si alguien pulsó «English», seguir hablándole
 * en español porque su navegador lo dice sería ignorar lo único que dijo de
 * forma explícita.
 */
export function pickLocale(input: {
  chosen?: string | null;
  stored?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  return (
    normalizeLocale(input.chosen) ??
    normalizeLocale(input.stored) ??
    parseAcceptLanguage(input.acceptLanguage) ??
    DEFAULT_LOCALE
  );
}

/* ═══════════════════════════════════════════════════════ diccionarios ══ */

export type Dictionary = Record<string, string>;

/**
 * La página pública de reservas.
 *
 * Las claves describen el SITIO, no el texto («engine.submit» y no
 * «pedirMiLugar»): cuando alguien reescriba el botón, la clave sigue valiendo.
 */
const PUBLIC_ES: Dictionary = {
  "engine.included": "Incluye",
  "engine.cta": "Pide tu lugar",
  "engine.loadingDates": "Buscando fechas…",
  "engine.product": "Excursión",
  "engine.date": "Fecha",
  "engine.people": "Personas",
  "engine.estimatedTotal": "Total estimado",
  "engine.adults": "Adultos",
  "engine.children": "Niños",
  "engine.name": "Tu nombre",
  "engine.email": "Correo",
  "engine.phone": "Teléfono o WhatsApp",
  "engine.hotel": "Hotel donde te hospedas",
  "engine.room": "Habitación (opcional)",
  "engine.notes": "Algo que debamos saber",
  "engine.sending": "Enviando…",
  "engine.submit": "Pedir mi lugar",
  "engine.quote": "Consultar precio",
  "engine.seatsLeft": "Quedan {seats} plazas",
  "engine.noDates": "Sin fechas disponibles ahora mismo",
  "engine.errorSend": "No pudimos enviar tu solicitud. Inténtalo de nuevo.",
  "engine.errorNetwork": "No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.",
  "engine.received": "Solicitud recibida",
  "engine.yourReference": "Tu referencia es",
  "engine.keepReference": "Guarda tu referencia. Si necesitas cambiar algo, escríbenos",
  "engine.keepReferenceEnd": "con ese número delante.",
  "engine.minAge": "Edad mínima",
  "engine.thanksTitle": "¡Listo! Ya tenemos tu solicitud",
  "engine.thanksBody": "Te escribimos enseguida para confirmarte el lugar y la hora de recogida.",
  "engine.reference": "Referencia",
  "page.notFound": "Página no encontrada",
  "page.closed": "Esta operadora no está aceptando reservas por aquí ahora mismo.",
  "page.noProducts": "Todavía no hay excursiones publicadas. Escríbenos y te contamos qué tenemos.",
  "engine.priceFrom": "Desde {price}",
  "lang.switch": "Idioma",
};

const PUBLIC_EN: Dictionary = {
  "engine.included": "What's included",
  "engine.cta": "Request your spot",
  "engine.loadingDates": "Looking for dates…",
  "engine.product": "Tour",
  "engine.date": "Date",
  "engine.people": "Travellers",
  "engine.estimatedTotal": "Estimated total",
  "engine.adults": "Adults",
  "engine.children": "Children",
  "engine.name": "Your name",
  "engine.email": "Email",
  "engine.phone": "Phone or WhatsApp",
  "engine.hotel": "Hotel you're staying at",
  "engine.room": "Room (optional)",
  "engine.notes": "Anything we should know",
  "engine.sending": "Sending…",
  "engine.submit": "Request my spot",
  "engine.quote": "Check price",
  "engine.seatsLeft": "{seats} spots left",
  "engine.noDates": "No dates available right now",
  "engine.errorSend": "We couldn't send your request. Please try again.",
  "engine.errorNetwork": "We couldn't connect. Check your connection and try again.",
  "engine.received": "Request received",
  "engine.yourReference": "Your reference is",
  "engine.keepReference": "Keep your reference. If you need to change anything, write to us",
  "engine.keepReferenceEnd": "quoting that number.",
  "engine.minAge": "Minimum age",
  "engine.thanksTitle": "Done! We have your request",
  "engine.thanksBody": "We'll write to you shortly to confirm your spot and the pickup time.",
  "engine.reference": "Reference",
  "page.notFound": "Page not found",
  "page.closed": "This operator isn't taking bookings here at the moment.",
  "page.noProducts": "No tours published yet. Write to us and we'll tell you what we have.",
  "engine.priceFrom": "From {price}",
  "lang.switch": "Language",
};

export const PUBLIC_DICTIONARY: Record<Locale, Dictionary> = { es: PUBLIC_ES, en: PUBLIC_EN };

/**
 * La encuesta de después del viaje.
 *
 * Tiene su propio diccionario y no va en el de la página pública por una razón
 * práctica: el idioma NO lo elige el navegador, lo elige la ficha del cliente.
 * Quien reservó en inglés recibió el correo en inglés y abre este enlace desde
 * ese correo, muchas veces ya en su casa y con el móvil en otro idioma. La
 * encuesta tiene que seguir al cliente, no al dispositivo.
 */
const SURVEY_ES: Dictionary = {
  "survey.title": "¿Cómo te fue?",
  "survey.intro": "{product} · {date}",
  "survey.question": "¿Qué probabilidad hay de que nos recomiendes a un amigo?",
  "survey.scaleLow": "Nada probable",
  "survey.scaleHigh": "Muy probable",
  "survey.detailsTitle": "¿Y qué tal estuvo…?",
  "survey.guide": "El guía",
  "survey.transport": "El transporte",
  "survey.value": "Lo que pagaste",
  "survey.comment": "Cuéntanos lo que quieras (opcional)",
  "survey.commentPlaceholder": "Lo que más te gustó, o lo que habría que mejorar",
  "survey.send": "Enviar",
  "survey.sending": "Enviando…",
  "survey.skipDetails": "Prefiero no decir más",
  "survey.thanksTitle": "¡Gracias!",
  "survey.thanksBody": "Nos ayuda más de lo que parece.",
  "survey.reviewTitle": "¡Gracias! ¿Nos echas una mano?",
  "survey.reviewBody": "Si tienes un minuto, contárselo a otros viajeros es lo que más nos ayuda.",
  "survey.reviewCta": "Escribir una reseña",
  "survey.recoverTitle": "Gracias por contárnoslo",
  "survey.recoverBody": "Sentimos que no saliera como esperabas. Alguien del equipo te va a contactar hoy.",
  "survey.doneTitle": "Ya nos diste tu opinión",
  "survey.doneBody": "Gracias otra vez.",
  "survey.expiredTitle": "Este enlace ya caducó",
  "survey.expiredBody": "Si quieres contarnos algo, escríbenos y te atendemos.",
  "survey.missingTitle": "No encontramos esta encuesta",
  "survey.missingBody": "Puede que el enlace esté incompleto. Prueba a abrirlo otra vez desde el correo.",
  "survey.optOut": "No quiero recibir más encuestas",
  "survey.optOutDone": "Listo, no te escribiremos más encuestas.",
  "survey.optOutNote": "Los avisos de tus reservas —como la hora de recogida— te seguirán llegando.",
  "survey.error": "No pudimos guardar tu respuesta. Inténtalo otra vez.",
};

const SURVEY_EN: Dictionary = {
  "survey.title": "How was it?",
  "survey.intro": "{product} · {date}",
  "survey.question": "How likely are you to recommend us to a friend?",
  "survey.scaleLow": "Not at all likely",
  "survey.scaleHigh": "Extremely likely",
  "survey.detailsTitle": "And how about…?",
  "survey.guide": "The guide",
  "survey.transport": "The transport",
  "survey.value": "Value for money",
  "survey.comment": "Tell us anything you like (optional)",
  "survey.commentPlaceholder": "What you enjoyed most, or what we should improve",
  "survey.send": "Send",
  "survey.sending": "Sending…",
  "survey.skipDetails": "I'd rather not say more",
  "survey.thanksTitle": "Thank you!",
  "survey.thanksBody": "It helps more than you'd think.",
  "survey.reviewTitle": "Thank you! Could you help us out?",
  "survey.reviewBody": "If you have a minute, telling other travellers is what helps us most.",
  "survey.reviewCta": "Write a review",
  "survey.recoverTitle": "Thank you for telling us",
  "survey.recoverBody": "We're sorry it didn't go as expected. Someone from the team will contact you today.",
  "survey.doneTitle": "You already shared your thoughts",
  "survey.doneBody": "Thanks again.",
  "survey.expiredTitle": "This link has expired",
  "survey.expiredBody": "If you'd like to tell us something, just write to us.",
  "survey.missingTitle": "We couldn't find this survey",
  "survey.missingBody": "The link may be incomplete. Try opening it again from the email.",
  "survey.optOut": "I don't want to receive more surveys",
  "survey.optOutDone": "Done, we won't send you more surveys.",
  "survey.optOutNote": "You'll still get the messages about your bookings, like your pickup time.",
  "survey.error": "We couldn't save your answer. Please try again.",
};

export const SURVEY_DICTIONARY: Record<Locale, Dictionary> = { es: SURVEY_ES, en: SURVEY_EN };

/**
 * Los documentos que el huésped enseña o guarda.
 *
 * El voucher es el caso claro: lo enseña en la puerta, a veces a alguien que no
 * lo emitió. Un voucher con las etiquetas en español y el contenido en inglés
 * no es bilingüe, es confuso.
 */
const DOC_ES: Dictionary = {
  "doc.booking": "Reserva",
  "doc.voucherCode": "Código del voucher",
  "doc.customer": "Cliente",
  "doc.date": "Fecha",
  "doc.pax": "Pasajeros",
  "doc.adult": "adulto",
  "doc.adults": "adultos",
  "doc.child": "niño",
  "doc.children": "niños",
  "doc.infant": "bebé",
  "doc.infants": "bebés",
  "doc.pickup": "Recogida",
  "doc.time": "Hora",
  "doc.place": "Lugar",
  "doc.room": "hab.",
  "doc.tbc": "Por confirmar",
  "doc.meetingPointFallback": "Presentarse en el punto de encuentro indicado por la empresa.",
  "doc.extras": "Extras contratados",
  "doc.concept": "Concepto",
  "doc.qty": "Cant.",
  "doc.amount": "Importe",
  "doc.total": "Total",
  "doc.paid": "Pagado",
  "doc.balance": "Saldo pendiente",
  "doc.balanceNotice": "Queda un saldo de {amount} por pagar. Puedes liquidarlo antes de la excursión o el mismo día al guía.",
  "doc.showNotice": "Presenta este voucher —impreso o en el móvil— el día de la excursión. Te recomendamos estar en el punto de recogida 10 minutos antes.",
  "doc.includes": "Qué incluye",
  "doc.excludes": "Qué no incluye",
  "doc.bring": "Qué llevar",
  "doc.restrictions": "Restricciones",
  "doc.instructions": "Instrucciones",
  "doc.terms": "Condiciones",
  "doc.cancellationPolicy": "Política de cancelación",
  "doc.notes": "Notas",
  "doc.soldBy": "Vendido por",
};

const DOC_EN: Dictionary = {
  "doc.booking": "Booking",
  "doc.voucherCode": "Voucher code",
  "doc.customer": "Guest",
  "doc.date": "Date",
  "doc.pax": "Travellers",
  "doc.adult": "adult",
  "doc.adults": "adults",
  "doc.child": "child",
  "doc.children": "children",
  "doc.infant": "infant",
  "doc.infants": "infants",
  "doc.pickup": "Pickup",
  "doc.time": "Time",
  "doc.place": "Place",
  "doc.room": "room",
  "doc.tbc": "To be confirmed",
  "doc.meetingPointFallback": "Please go to the meeting point indicated by the operator.",
  "doc.extras": "Add-ons booked",
  "doc.concept": "Item",
  "doc.qty": "Qty",
  "doc.amount": "Amount",
  "doc.total": "Total",
  "doc.paid": "Paid",
  "doc.balance": "Balance due",
  "doc.balanceNotice": "There is a balance of {amount} left to pay. You can settle it before the tour or on the day with your guide.",
  "doc.showNotice": "Show this voucher —printed or on your phone— on the day of the tour. We recommend being at the pickup point 10 minutes early.",
  "doc.includes": "What's included",
  "doc.excludes": "What's not included",
  "doc.bring": "What to bring",
  "doc.restrictions": "Restrictions",
  "doc.instructions": "Instructions",
  "doc.terms": "Terms",
  "doc.cancellationPolicy": "Cancellation policy",
  "doc.notes": "Notes",
  "doc.soldBy": "Sold by",
};

export const DOC_DICTIONARY: Record<Locale, Dictionary> = { es: DOC_ES, en: DOC_EN };

/**
 * Traduce, con respaldo al español y sustitución de variables.
 *
 * Nunca devuelve la clave: una pantalla que dice `engine.submit` parece rota,
 * y el español se entiende con el contexto mucho mejor que eso.
 */
export function translate(
  dictionaries: Record<Locale, Dictionary>,
  locale: Locale,
  key: string,
  vars: Record<string, string | number> = {}
): string {
  const text = dictionaries[locale]?.[key] ?? dictionaries[DEFAULT_LOCALE]?.[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  );
}

/** El traductor ya atado a un idioma, que es como se usa en una pantalla. */
export function translator(dictionaries: Record<Locale, Dictionary>, locale: Locale) {
  return (key: string, vars?: Record<string, string | number>) =>
    translate(dictionaries, locale, key, vars);
}

/**
 * Qué claves le faltan a un idioma.
 *
 * Existe para la guarda de contrato: un diccionario al que le falta una clave no
 * se rompe —cae al español— y por eso nadie se entera nunca. La prueba sí.
 */
export function missingKeys(dictionaries: Record<Locale, Dictionary>): Record<string, string[]> {
  const reference = Object.keys(dictionaries[DEFAULT_LOCALE] ?? {});
  const out: Record<string, string[]> = {};
  for (const locale of SUPPORTED_LOCALES) {
    if (locale === DEFAULT_LOCALE) continue;
    const dict = dictionaries[locale] ?? {};
    const missing = reference.filter((key) => !(key in dict));
    if (missing.length > 0) out[locale] = missing;
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════ formatos ══ */

const INTL_LOCALE: Record<Locale, string> = { es: "es-DO", en: "en-US" };

/**
 * La fecha en el idioma del huésped.
 *
 * No es cosmético: «mié 17 sep» y «Wed, Sep 17» son la misma fecha, pero un
 * voucher que mezcla formatos se lee dos veces, y en la puerta de un autobús a
 * las siete de la mañana eso importa.
 */
export function formatDateFor(locale: Locale, iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(INTL_LOCALE[locale], {
    weekday: "short", day: "2-digit", month: "short", year: "numeric",
  });
}

export function formatTimeFor(locale: Locale, iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(INTL_LOCALE[locale], { hour: "2-digit", minute: "2-digit" });
}
