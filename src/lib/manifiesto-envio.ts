import { createHash } from "node:crypto";
import type { ManifestRow, PickupStop, PaxSummary } from "@/lib/manifest";

/**
 * EL MANIFIESTO SALE SOLO — Y NO SALE ENTERO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE PASABA
 *
 * El manifiesto existía en dos sitios: una pantalla y un PDF, los dos detrás de
 * una sesión. El chofer que arranca a las seis de la mañana no tiene sesión, y
 * el proveedor de transporte tampoco. En la práctica eso significa que alguien
 * de la oficina abría la pantalla, bajaba el PDF y lo reenviaba a mano por
 * WhatsApp la noche antes — cuando se acordaba—. Cuando no se acordaba, el
 * chofer salía con la lista de la semana pasada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO ES DISTINTO DE MANDAR UN CORREO MÁS
 *
 * El manifiesto es el documento con MÁS datos personales de terceros de todo el
 * sistema: nombre, teléfono, correo, número de habitación, idioma, nacionalidad
 * y lo que cada uno debe. Mandarlo entero a una empresa de transporte es
 * entregarle la cartera de clientes de la operadora con el saldo de cada uno
 * dentro — y además es exactamente lo que necesita para llamarlos el año que
 * viene por su cuenta.
 *
 * Así que lo que decide este módulo no es «a quién se le manda» sino QUÉ DICE
 * EL PAPEL SEGÚN QUIÉN LO ABRE. Cada público tiene su lista blanca de campos, y
 * el recorte se aplica a la fila CRUDA: el PDF dibuja sus columnas desde la
 * misma lista, así que una columna que no está permitida ni siquiera se dibuja.
 * Recortar «al pintar» habría dejado la columna vacía en el papel y el dato
 * entero en la respuesta.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOS CUATRO PÚBLICOS, Y POR QUÉ NO SON TRES
 *
 *  · `interno` — la operadora. Lo ve todo; es su dato.
 *  · `guia` — su propio guía. Viaja con el grupo y COBRA A BORDO, así que el
 *    saldo le hace falta de verdad. No le hace falta el correo del cliente ni
 *    quién se lo vendió.
 *  · `chofer` — el conductor, que llama a la puerta de la habitación 412. Le
 *    hacen falta nombre, hotel, habitación, teléfono y hora. NO le hace falta
 *    el dinero: un chofer ajeno cobrando en la puerta es dinero que no vuelve.
 *  · `proveedor` — la OFICINA de la empresa de transporte. Planifica vehículos
 *    y turnos: le hacen falta las paradas, las horas y cuánta gente sube. No le
 *    hace falta saber que la señora de la 412 se llama García. La distinción
 *    entre `chofer` y `proveedor` es justo esa, y es la que evita que la lista
 *    de clientes acabe archivada en el ordenador de otra empresa.
 */

export type PublicoDelManifiesto = "interno" | "guia" | "chofer" | "proveedor";

export const PUBLICOS_DEL_MANIFIESTO: PublicoDelManifiesto[] = [
  "interno", "guia", "chofer", "proveedor",
];

export const ETIQUETA_DEL_PUBLICO: Record<PublicoDelManifiesto, string> = {
  interno: "Operación",
  guia: "Guía",
  chofer: "Chofer",
  proveedor: "Proveedor",
};

/** Todo lo que una fila del manifiesto sabe decir. */
const TODOS_LOS_CAMPOS = [
  "booking_id", "booking_number", "voucher_code", "lead_name", "phone", "email",
  "language", "nationality", "adults", "children", "infants", "seats",
  "pickup_hotel", "pickup_zone", "pickup_time", "pickup_sort", "room",
  "pickup_location", "balance", "currency", "paid", "checkin_status",
  "checked_in_pax", "sold_by", "requirements", "notes", "participants",
  "unnamed_pax",
] as const;

export type CampoDelManifiesto = (typeof TODOS_LOS_CAMPOS)[number];

/**
 * LA LISTA BLANCA, QUE FALLA POR OMISIÓN.
 *
 * Es una lista de lo PERMITIDO y no de lo prohibido a propósito: el día que
 * `manifestRow` gane un campo nuevo —el documento de identidad, la alergia, el
 * número de vuelo— ese campo NO sale hacia fuera hasta que alguien lo escriba
 * aquí a mano. Con una lista de prohibidos, el campo nuevo habría salido solo,
 * que es exactamente como se filtran los datos que nadie decidió filtrar.
 */
export const CAMPOS_DEL_MANIFIESTO: Record<PublicoDelManifiesto, readonly CampoDelManifiesto[]> = {
  interno: TODOS_LOS_CAMPOS,

  // El guía cobra a bordo: el saldo y la divisa son su trabajo. El correo del
  // cliente y quién se lo vendió no lo son.
  guia: [
    "booking_id", "booking_number", "voucher_code", "lead_name", "phone",
    "language", "nationality", "adults", "children", "infants", "seats",
    "pickup_hotel", "pickup_zone", "pickup_time", "pickup_sort", "room",
    "pickup_location", "balance", "currency", "paid", "checkin_status",
    "checked_in_pax", "requirements", "participants", "unnamed_pax",
  ],

  // El chofer llama a la puerta: nombre, hotel, habitación, teléfono y hora.
  // Ni un número de dinero.
  chofer: [
    "booking_id", "booking_number", "lead_name", "phone",
    "adults", "children", "infants", "seats",
    "pickup_hotel", "pickup_zone", "pickup_time", "pickup_sort", "room",
    "pickup_location", "requirements", "checkin_status",
  ],

  // La oficina del proveedor planifica vehículos. Le hace falta CUÁNTA gente
  // sube dónde y a qué hora, y qué cambia el vehículo (una silla de ruedas).
  // No le hace falta ningún nombre.
  proveedor: [
    "adults", "children", "infants", "seats",
    "pickup_hotel", "pickup_zone", "pickup_time", "pickup_sort",
    "requirements",
  ],
};

/** ¿Este público puede ver este campo? */
export function incluye(publico: PublicoDelManifiesto, campo: CampoDelManifiesto): boolean {
  return CAMPOS_DEL_MANIFIESTO[publico].includes(campo);
}

/**
 * La fila recortada.
 *
 * Se construye a partir de la lista blanca y NO copiando la fila y borrando:
 * borrar deja dentro lo que nadie se acordó de borrar.
 */
export function recortarFila(
  publico: PublicoDelManifiesto,
  fila: ManifestRow
): Partial<ManifestRow> {
  const salida: Record<string, unknown> = {};
  for (const campo of CAMPOS_DEL_MANIFIESTO[publico]) {
    const crudo = fila as unknown as Record<string, unknown>;
    if (campo in crudo) salida[campo] = crudo[campo];
  }
  return salida as Partial<ManifestRow>;
}

export function recortarManifiesto(
  publico: PublicoDelManifiesto,
  filas: ManifestRow[]
): Partial<ManifestRow>[] {
  return filas.map((f) => recortarFila(publico, f));
}

/**
 * Las paradas, recortadas.
 *
 * Una parada lleva DENTRO las reservas que la componen (`bookings`), así que
 * mandar las paradas «tal cual» a un proveedor le habría entregado por la
 * puerta de atrás justo lo que la lista blanca le quita por la de delante. Es
 * el mismo fallo que el de un recorte que solo mira el primer nivel.
 */
export function recortarParadas(
  publico: PublicoDelManifiesto,
  paradas: PickupStop[]
): (Omit<PickupStop, "bookings"> & { bookings: Partial<ManifestRow>[] })[] {
  return paradas.map((p) => ({ ...p, bookings: recortarManifiesto(publico, p.bookings) }));
}

/**
 * El resumen, recortado.
 *
 * El dinero por cobrar es una cifra del resumen, no de la fila: quitar `balance`
 * de las filas y dejar `to_collect` en la cabecera habría publicado la misma
 * información sumada. Va atado al MISMO permiso.
 */
export function recortarResumen(
  publico: PublicoDelManifiesto,
  resumen: PaxSummary
): PaxSummary {
  if (incluye(publico, "balance")) return resumen;
  return { ...resumen, to_collect: 0, to_collect_by_currency: {} };
}

/* --------------------------------------------------------------- la huella */

/**
 * LA HUELLA DE LO QUE SE MANDÓ.
 *
 * Un manifiesto no es un aviso: es una lista que CAMBIA. Se manda a las seis de
 * la mañana, entra una reserva a las dos de la tarde y el chofer sale con una
 * lista a la que le falta gente — que es peor que no haberla mandado, porque el
 * chofer cree que la tiene.
 *
 * La clave de deduplicación lleva esta huella dentro. Mientras la lista sea la
 * misma, barrer cien veces deja UN mensaje; en cuanto cambia lo que el chofer
 * tiene que hacer, la clave cambia y sale una versión nueva sola.
 *
 * Entra solo lo que cambia el trabajo: quién viaja, cuántos son, dónde y cuándo
 * se les recoge. NO entra el estado de embarque —se marca durante la propia
 * salida y haría salir un manifiesto nuevo por cada pasajero que sube— ni el
 * saldo, que se cobra a bordo y no cambia la ruta.
 */
export function huellaDeLaSalida(filas: ManifestRow[]): string {
  const material = filas
    .map((f) => [
      f.booking_id, f.seats, f.pickup_time, f.pickup_hotel, f.room, f.pickup_location,
    ].join("|"))
    .sort()
    .join("\n");
  return createHash("sha256").update(material).digest("hex").slice(0, 12);
}

/**
 * La identidad del envío.
 *
 * Lleva el público dentro porque al mismo correo pueden llegarle dos cortes
 * distintos —una persona que es guía y a la vez dueña del transporte—, y lleva
 * el destino porque dos choferes de la misma salida son dos mensajes.
 */
export function claveDeEnvio(
  departureId: string,
  publico: PublicoDelManifiesto,
  canal: string,
  destino: string,
  huella: string
): string {
  return `manifest:${departureId}:${publico}:${canal}:${destino.toLowerCase()}:${huella}`;
}

/* ------------------------------------------------------------ cuándo y si */

/** Salidas cuyo manifiesto no tiene sentido mandar. */
const SALIDAS_MUERTAS = new Set(["cancelled", "draft"]);

/**
 * La ventana del envío.
 *
 * 36 horas y no 24 a propósito: el trabajo que lo barre corre UNA VEZ AL DÍA
 * (el plan de Vercel no admite crons sub-diarios, ver `vercel.json`), así que
 * una ventana de 24 h dejaría fuera la salida de pasado mañana a primera hora
 * — el barrido de mañana llegaría tarde para que el proveedor asigne vehículo.
 */
export const VENTANA_DE_ENVIO_HORAS = 36;

export interface SalidaParaEnvio {
  departure_at?: string | null;
  status?: string | null;
}

export type VetoDeEnvio = { motivo: string } | null;

/**
 * ¿Sale este manifiesto?
 *
 * Devuelve el motivo en vez de un booleano porque ese motivo se escribe en la
 * bitácora: «no se mandó» sin decir por qué es la respuesta que obliga a la
 * operadora a abrir la base de datos.
 */
export function vetoDeEnvio(
  salida: SalidaParaEnvio,
  ahora: Date = new Date()
): VetoDeEnvio {
  const estado = String(salida.status ?? "").toLowerCase();
  if (SALIDAS_MUERTAS.has(estado)) return { motivo: `La salida está ${estado}` };

  const cuando = salida.departure_at ? new Date(salida.departure_at).getTime() : NaN;
  // Sin fecha no hay ventana posible. Es el mismo criterio que la hoja de ruta:
  // lo que no se sabe NO se abre.
  if (!Number.isFinite(cuando)) return { motivo: "La salida no tiene fecha" };

  if (cuando < ahora.getTime()) return { motivo: "La salida ya pasó" };
  if (cuando > ahora.getTime() + VENTANA_DE_ENVIO_HORAS * 3_600_000) {
    return { motivo: `Todavía faltan más de ${VENTANA_DE_ENVIO_HORAS} horas` };
  }
  return null;
}

/* ------------------------------------------------------------- el WhatsApp */

/**
 * EL WHATSAPP NO LLEVA LA LISTA.
 *
 * El correo lleva el PDF recortado; el WhatsApp lleva un resumen y NUNCA el
 * nombre de un cliente, ni siquiera para el chofer que sí puede verlo en el
 * papel. Un WhatsApp se reenvía de un grupo a otro sin pensarlo y una captura
 * de pantalla viaja más lejos que un adjunto: el canal decide, no solo el
 * público.
 *
 * Lo que sí lleva son las paradas —hotel, hora y cuánta gente—, que es lo que
 * el chofer mira en el semáforo sin abrir un PDF.
 */
export const MAXIMO_DE_PARADAS_EN_WHATSAPP = 8;

export function paradasParaWhatsapp(
  paradas: PickupStop[],
  maximo: number = MAXIMO_DE_PARADAS_EN_WHATSAPP
): string {
  if (paradas.length === 0) return "Sin recogidas: todos en el punto de encuentro";
  const lineas = paradas.slice(0, maximo).map((p) => `${p.time} · ${p.hotel} (${p.seats})`);
  const resto = paradas.length - lineas.length;
  if (resto > 0) lineas.push(`y ${resto} parada(s) más en el PDF`);
  return lineas.join("\n");
}
