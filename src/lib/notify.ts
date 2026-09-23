/**
 * EL CATÁLOGO DE AVISOS INTERNOS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO NO EXISTÍA Y HACÍA FALTA
 *
 * La tabla `notification`, su API y su pantalla están desde 0009, y ningún
 * módulo escribía una sola fila: la campana del menú llevaba un contador que
 * siempre decía cero. Eso es peor que no tener campana —quien la ve vacía
 * concluye que no ha pasado nada—, y deja al equipo enterándose de un descuadre
 * de caja o de una factura anulada solo si entra a mirar esa pantalla.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS COSAS QUE SE PARECEN Y NO SON LA MISMA
 *
 * `messaging/` le escribe AL CLIENTE (correo y WhatsApp, con plantillas y
 * cola). Esto le avisa AL EQUIPO, dentro del sistema. Comparten la forma —el
 * texto atado al hecho, la clave que evita repetirlo— y no comparten nada más:
 * un aviso interno no se envía a ninguna parte, no cuesta dinero y no se puede
 * perder.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LAS REGLAS QUE MANTIENEN LA CAMPANA CREÍBLE
 *
 *  1. SOLO LO QUE ALGUIEN TIENE QUE HACER O SABER. Un aviso por cada pago
 *     rutinario convierte la bandeja en ruido y, a la semana, nadie la abre.
 *     Por eso avisa el REEMBOLSO y no el cobro normal.
 *  2. CADA AVISO LLEVA A SU SITIO. Un aviso que no se puede abrir obliga a
 *     buscar a mano lo que acaba de pasar. Hay una guarda que comprueba que
 *     todos los enlaces existen como pantalla.
 *  3. A QUIÉN LE IMPORTA. El descuadre de caja es del gerente, no del
 *     vendedor. `audience` es el rol MÍNIMO que lo ve.
 */

export type NotificationType = "info" | "booking" | "payment" | "operation" | "alert" | "settlement";

/** Rol mínimo que ve un aviso de empresa. Coincide con el orden de `atLeast`. */
export type AudienceRole = "owner" | "admin" | "manager" | "operations" | "cashier" | "seller";

/**
 * A quién va dirigido un aviso.
 *
 * `partner` NO es un rol interno y por eso no está en `AudienceRole`: los
 * avisos del tour center no se reparten por rango —dentro de un tour center
 * todos los accesos son iguales por construcción (0073)— sino por
 * IDENTIFICADOR, en la columna `notification.partner_id`. Declararlo aquí sirve
 * para que el catálogo diga la verdad sobre cada evento; la columna
 * `audience_role` se queda nula para ellos, que es lo que exige el `check` de
 * 0044 y lo que impide que un interno los vea por rango.
 */
export type Audience = AudienceRole | "partner";

export interface NotifyVars {
  [key: string]: string | number | null | undefined;
}

export interface NotifyEventDef {
  type: NotificationType;
  audience: Audience;
  title: (v: NotifyVars) => string;
  message: (v: NotifyVars) => string;
  link: (v: NotifyVars) => string;
}

const money = (v: NotifyVars, amount = "monto", currency = "moneda") => {
  const value = Number(v[amount] ?? 0);
  const code = String(v[currency] || "USD").toUpperCase();
  return `${code} ${value.toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const who = (v: NotifyVars) => (v.persona ? ` por ${v.persona}` : "");

/**
 * Los hechos que avisan.
 *
 * Cada uno salió de una pregunta concreta: «¿de qué me tengo que enterar sin
 * entrar a buscarlo?». Lo que no pasa esa prueba no está aquí.
 */
export const NOTIFY_EVENTS = {
  /** Entra una reserva. Lo que la operación necesita para prever el día. */
  booking_created: {
    type: "booking",
    audience: "operations",
    title: (v) => `Nueva reserva ${v.referencia ?? ""}`.trim(),
    message: (v) =>
      [v.producto, v.fecha ? `para el ${v.fecha}` : null, v.pax ? `· ${v.pax} pax` : null, v.cliente ? `· ${v.cliente}` : null]
        .filter(Boolean).join(" "),
    link: () => "/dashboard/reservas",
  },

  /** Una reserva se cae. Libera cupo y casi siempre toca devolver dinero. */
  booking_cancelled: {
    type: "alert",
    audience: "manager",
    title: (v) => `Reserva cancelada ${v.referencia ?? ""}`.trim(),
    message: (v) =>
      [v.producto, v.fecha ? `del ${v.fecha}` : null, v.motivo ? `· ${v.motivo}` : null].filter(Boolean).join(" "),
    link: () => "/dashboard/reservas",
  },

  /**
   * A alguien de la lista de espera le tocó una plaza.
   *
   * Va al mostrador y no al cliente: la plaza YA está apartada a su nombre con
   * una reserva de verdad, y lo que falta es que alguien lo llame antes de que
   * se le pase el plazo. Un aviso automático al cliente llegaría sin contexto
   * —«tienes una reserva que no hiciste»— y sin nadie que le cobre.
   */
  waitlist_offer: {
    // `booking` y no `alert`: no es que algo vaya mal, es que hay una venta
    // esperando a que alguien la cierre.
    type: "booking",
    audience: "seller",
    title: (v) => `Plaza libre para ${v.name ?? "un cliente en espera"}`,
    message: (v) =>
      [
        v.pax ? `${v.pax} pax` : null,
        v.channel ? `· avisar a ${v.channel}` : null,
        v.booking ? `· reserva ${v.booking}` : null,
        v.expires ? `· vence ${String(v.expires).slice(0, 16).replace("T", " ")}` : null,
      ].filter(Boolean).join(" "),
    link: () => "/dashboard/reservas",
  },

  /** Una reserva cambia de día: el manifiesto de dos días deja de ser el mismo. */
  booking_rescheduled: {
    type: "booking",
    audience: "operations",
    title: (v) => `Reserva movida ${v.referencia ?? ""}`.trim(),
    message: (v) =>
      [v.fecha ? `Nueva fecha: ${v.fecha}` : null, v.motivo ? `· ${v.motivo}` : null]
        .filter(Boolean).join(" ") || "Cambió de fecha.",
    link: () => "/dashboard/reservas",
  },

  /** Sale dinero. Un reembolso siempre se revisa; un cobro normal, no. */
  payment_refunded: {
    type: "payment",
    audience: "manager",
    title: (v) => `Reembolso de ${money(v)}`,
    message: (v) => `${v.referencia ? `Sobre ${v.referencia}. ` : ""}Registrado${who(v)}.`,
    link: () => "/dashboard/pagos",
  },

  /** La caja no cuadró. Es la alerta más cara de descubrir tarde. */
  cash_close_mismatch: {
    type: "alert",
    audience: "manager",
    title: (v) => `Descuadre de caja: ${money(v, "diferencia")}`,
    message: (v) => `${v.caja ?? "Una caja"} cerró con diferencia${who(v)}. Requiere revisión.`,
    link: () => "/dashboard/caja",
  },

  /** Un incidente en el parque. Cuanto antes se vea, menos crece. */
  incident_opened: {
    type: "alert",
    audience: "operations",
    title: (v) => `Incidente${v.gravedad ? ` (${v.gravedad})` : ""}: ${v.titulo ?? "sin título"}`,
    message: (v) => [v.lugar, v.detalle].filter(Boolean).join(" · ") || "Abierto ahora mismo.",
    link: () => "/dashboard/parque/incidentes",
  },

  /** Liquidación confirmada: alguien tiene que pagarla o cobrarla. */
  /**
   * LOS CUATRO AVISOS DEL VENDEDOR, Y POR QUÉ VAN CON NOMBRE Y APELLIDO.
   *
   * El resto del catálogo se reparte por AUDIENCIA: quien tenga ese rol lo ve.
   * Para estos cuatro eso sería exactamente lo contrario de lo que hacen falta:
   * «te han aprobado la comisión» mandado a la audiencia `seller` se lo manda a
   * TODOS los vendedores de la empresa, así que cada uno recibe el aviso de las
   * ventas de sus compañeros y ninguno se entera de las suyas entre el ruido.
   * Y de paso les cuenta cuánto cobran los demás.
   *
   * Por eso se emiten con `userId` y `notify` pone entonces `audience_role` en
   * null: un aviso personal ya tiene nombre y apellido. La audiencia declarada
   * aquí es la red que queda si algún día se emiten sin usuario, y por eso es
   * `manager` y no `seller`.
   */
  sale_attributed: {
    type: "booking",
    audience: "manager",
    title: (v) => `Venta a tu nombre ${v.referencia ?? ""}`.trim(),
    message: (v) => `${money(v)}${who(v)}. Tu comisión se calcula al confirmarse el servicio.`,
    link: () => "/dashboard/mi-espacio/ventas",
  },

  /**
   * LA DISPUTA LLEGA A UNA PERSONA, NO A UN ROL.
   *
   * Es el mismo razonamiento de los avisos de venta, y aquí pesa más: un aviso
   * a «los administradores» que todos ven y ninguno coge es exactamente el
   * final que tiene hoy una llamada de un tour center quejándose de su corte
   * del mes. La audiencia declarada es la red de seguridad para cuando la
   * liquidación no tiene a nadie asignado.
   */
  settlement_disputed: {
    type: "settlement",
    audience: "manager",
    title: (v) => `Disputa de liquidación ${v.referencia ?? ""}`.trim(),
    message: (v) => `${v.socio ?? "Un tour center"} no está de acuerdo con ${money(v)}: ${v.motivo ?? "sin motivo"}`,
    link: () => "/dashboard/liquidaciones",
  },

  commission_approved: {
    type: "settlement",
    audience: "manager",
    title: () => "Te aprobaron comisión",
    message: (v) => `${money(v)} aprobado${v.referencia ? ` · ${v.referencia}` : ""}. Entra en la próxima liquidación.`,
    link: () => "/dashboard/mi-espacio/comisiones",
  },

  settlement_paid: {
    type: "settlement",
    audience: "manager",
    title: (v) => `Te pagaron la liquidación ${v.referencia ?? ""}`.trim(),
    message: (v) => `${money(v)}. El detalle está en tu estado de cuenta.`,
    link: () => "/dashboard/mi-espacio/comisiones",
  },

  /**
   * Cancelar anula la comisión de quien vendió. Sin este aviso, el vendedor lo
   * descubre el día de la liquidación, cuando ya es una discusión.
   */
  booking_cancelled_for_seller: {
    type: "alert",
    audience: "manager",
    title: (v) => `Se canceló una venta tuya ${v.referencia ?? ""}`.trim(),
    message: (v) => `${money(v)}${who(v)}. La comisión de esa reserva queda anulada.`,
    link: () => "/dashboard/mi-espacio/ventas",
  },

  settlement_confirmed: {
    type: "settlement",
    audience: "manager",
    title: (v) => `Liquidación ${v.referencia ?? ""} confirmada`.trim(),
    message: (v) => `${v.contraparte ?? "Contraparte"} · ${money(v)}`,
    link: () => "/dashboard/liquidaciones",
  },

  /* ═══════════════════════════════ lo que se le cuenta al tour center */

  /**
   * LOS AVISOS DEL SOCIO, Y POR QUÉ NO EXISTÍAN.
   *
   * `notification.partner_id` está en la tabla desde 0009 y NADIE la escribía
   * ni la leía — la tercera columna de esta fase que promete un vínculo con el
   * socio y no lo cumple, después de `authorized_products` y de
   * `api_key.partner_id`.
   *
   * La consecuencia: al tour center no se le contaba nada. Ni que su reserva
   * quedó confirmada, ni que le movieron la recogida, ni que se la cancelaron,
   * ni que le emitieron la liquidación. Se enteraba llamando, que es lo que el
   * portal vino a sustituir.
   *
   * Van por IDENTIFICADOR y no por rango: dentro de un tour center todos los
   * accesos son iguales por construcción (0073), así que un aviso para «el
   * socio» es para su empresa entera, y un miembro nuevo ve lo de antes de
   * entrar — que es justo lo que un buzón por persona no da.
   */
  partner_booking_confirmed: {
    type: "booking",
    audience: "partner",
    title: (v) => `Reserva confirmada ${v.referencia ?? ""}`.trim(),
    message: (v) =>
      [v.producto, v.fecha ? `para el ${v.fecha}` : null, v.pax ? `· ${v.pax} pax` : null,
       v.cliente ? `· ${v.cliente}` : null].filter(Boolean).join(" "),
    link: () => "/portal/reservas",
  },

  /**
   * La reserva se mueve, y con ella la recogida. Es el aviso más urgente de los
   * cuatro: el tour center tiene que localizar al turista antes de la hora
   * vieja, y una hora es lo que hay entre enterarse y que alguien se quede
   * esperando en el lobby.
   *
   * Al cliente ya se le avisaba desde que existe la reprogramación. Al tour
   * center que hizo la venta —y que es quien tiene el teléfono del turista en
   * la mano— no.
   */
  partner_booking_rescheduled: {
    type: "operation",
    audience: "partner",
    title: (v) => `Cambio de fecha y recogida ${v.referencia ?? ""}`.trim(),
    message: (v) =>
      [v.producto, v.antes ? `· antes ${v.antes}` : null, v.ahora ? `· ahora ${v.ahora}` : null,
       v.lugar ? `· punto de encuentro: ${v.lugar}` : null,
       v.motivo ? `· ${v.motivo}` : null].filter(Boolean).join(" "),
    link: () => "/portal/reservas",
  },

  partner_booking_cancelled: {
    type: "alert",
    audience: "partner",
    title: (v) => `Reserva cancelada ${v.referencia ?? ""}`.trim(),
    message: (v) =>
      [v.producto, v.fecha ? `del ${v.fecha}` : null, v.motivo ? `· ${v.motivo}` : null]
        .filter(Boolean).join(" "),
    link: () => "/portal/reservas",
  },

  /**
   * La liquidación EMITIDA, que hasta ahora no avisaba a nadie —ni al socio ni
   * dentro de la operadora—. Es el aviso que abre el plazo para revisarla: sin
   * él, el socio descubre el corte cuando le llega el pago, y discutirlo
   * entonces es discutir sobre dinero que ya se movió.
   */
  partner_settlement_issued: {
    type: "settlement",
    audience: "partner",
    title: (v) => `Liquidación emitida ${v.referencia ?? ""}`.trim(),
    message: (v) =>
      `${money(v)}${v.periodo ? ` · ${v.periodo}` : ""}. Revísala y, si no cuadra, ábrele una disputa.`,
    link: () => "/portal/liquidaciones",
  },

  partner_settlement_paid: {
    type: "settlement",
    audience: "partner",
    title: (v) => `Te pagamos la liquidación ${v.referencia ?? ""}`.trim(),
    message: (v) => `${money(v)}. El detalle está en tu estado de cuenta.`,
    link: () => "/portal/liquidaciones",
  },

  /** Un comprobante fiscal anulado. Se justifica ante la DGII, no se esconde. */
  invoice_voided: {
    type: "alert",
    audience: "admin",
    title: (v) => `Factura anulada ${v.referencia ?? ""}`.trim(),
    message: (v) => `${money(v)}${who(v)}. Se emitió su nota de crédito.`,
    link: () => "/dashboard/finanzas/facturas",
  },

  /** Existencias bajo el mínimo: se compra ahora o se rompe la operación. */
  stock_low: {
    type: "operation",
    audience: "manager",
    title: (v) => `Existencias bajas: ${v.articulo ?? "un artículo"}`,
    message: (v) => `Quedan ${v.cantidad ?? 0} y el mínimo es ${v.minimo ?? 0}${v.almacen ? ` en ${v.almacen}` : ""}.`,
    link: () => "/dashboard/comercio/existencias",
  },

  /** Una deuda pasó su fecha. El cron lo ve cada día; el aviso, una vez. */
  receivable_overdue: {
    type: "payment",
    audience: "manager",
    title: (v) => `Cobro vencido: ${money(v)}`,
    message: (v) =>
      [v.cliente, v.dias ? `${v.dias} día(s) de atraso` : null, v.referencia].filter(Boolean).join(" · "),
    link: () => "/dashboard/cobros",
  },

  /** El cliente aceptó la cotización. Es una venta esperando que la cierren. */
  quote_accepted: {
    type: "booking",
    audience: "seller",
    title: (v) => `Cotización aceptada ${v.referencia ?? ""}`.trim(),
    message: (v) => `${v.cliente ?? "El cliente"} aceptó por ${money(v)}. Falta convertirla en venta.`,
    link: () => "/dashboard/ventas/cotizaciones",
  },

  /**
   * Una certificación del equipo vence o ya venció.
   *
   * Avisa el barrido diario, una vez por certificación: la licencia del
   * conductor caducada no se descubre el día que la pide un inspector.
   */
  certification_expiring: {
    type: "alert",
    audience: "manager",
    title: (v) =>
      v.estado === "expired"
        ? `Certificación vencida: ${v.certificacion ?? "sin nombre"}`
        : `Certificación por vencer: ${v.certificacion ?? "sin nombre"}`,
    message: (v) =>
      [
        v.persona ? String(v.persona) : "Alguien del equipo",
        v.estado === "expired"
          ? `la tiene vencida desde el ${v.vence ?? "?"}`
          : `la tiene hasta el ${v.vence ?? "?"}`,
        v.bloquea ? "· bloquea la asignación a turnos y salidas" : null,
      ].filter(Boolean).join(" "),
    link: () => "/dashboard/equipo/certificaciones",
  },

  /**
   * Un cupo garantizado se liberó: esas plazas vuelven a la venta libre.
   *
   * Es una oportunidad con fecha de caducidad —la salida es en días— y quien la
   * puede aprovechar es el equipo comercial, hoy.
   */
  allotment_released: {
    type: "operation",
    audience: "manager",
    title: (v) => `${v.plazas ?? 0} plazas liberadas de un cupo`,
    message: (v) =>
      `Un socio no las vendió y vuelven a estar disponibles${v.fecha ? ` para la salida del ${v.fecha}` : ""}.`,
    link: () => "/dashboard/distribucion/allotments",
  },

  /** El plan se está acabando. Avisa ANTES de que un límite rechace una venta. */
  plan_limit_near: {
    type: "alert",
    audience: "admin",
    title: (v) => `Tu plan va por el ${v.porcentaje ?? 0}% de ${v.metrica ?? "un límite"}`,
    message: (v) =>
      `Llevas ${v.usado ?? 0} de ${v.limite ?? 0}. Al llegar al tope, el sistema deja de aceptar nuevos registros.`,
    link: () => "/dashboard/administracion/plan",
  },
  /**
   * Un pasajero puso una nota baja.
   *
   * `alert` y no `booking`: lo que hay que hacer con esto es llamar hoy, no
   * apuntarlo. Una queja atendida el mismo día recupera al cliente; la misma
   * queja atendida el jueves ya está escrita en TripAdvisor.
   *
   * Va a operaciones y no a dirección: quien puede arreglar lo que pasó es
   * quien conoce al guía y la ruta de ese día.
   */
  survey_detractor: {
    type: "alert",
    audience: "operations",
    title: (v) => `Un pasajero puntuó ${v.score ?? 0}/10`,
    message: (v) =>
      v.comment ? `«${v.comment}» · hay un caso abierto para llamarlo` : "Sin comentario: hay que llamarlo para saber qué pasó.",
    link: () => "/dashboard/clientes/casos",
  },
} satisfies Record<string, NotifyEventDef>;

export type NotifyEventKey = keyof typeof NOTIFY_EVENTS;

export interface BuiltNotification {
  title: string;
  message: string;
  notification_type: NotificationType;
  link: string;
  audience_role: Audience;
  event_key: NotifyEventKey;
}

/** El aviso, ya escrito. Puro: ni base de datos ni reloj. */
export function buildNotification(key: NotifyEventKey, vars: NotifyVars = {}): BuiltNotification {
  const def = NOTIFY_EVENTS[key] as NotifyEventDef;
  return {
    title: def.title(vars).trim(),
    message: def.message(vars).trim(),
    notification_type: def.type,
    link: def.link(vars),
    audience_role: def.audience,
    event_key: key,
  };
}

/* -------------------------------------- avisos desde el ERP genérico */

export interface RowNotification {
  event: NotifyEventKey;
  entityType: string;
  entityId: string | null;
  vars: NotifyVars;
}

/**
 * El aviso que corresponde a una fila recién creada por el ERP genérico.
 *
 * Los incidentes, los checklists y media operación del parque se registran por
 * las pantallas genéricas, que no tienen ruta propia donde colgar un aviso.
 * Esta tabla lo resuelve en un solo sitio, y es pura: la ruta solo pregunta.
 *
 * Devuelve `null` para todo lo demás, que es la inmensa mayoría: un aviso por
 * cada fila creada en el ERP sería la forma más rápida de que nadie vuelva a
 * abrir la campana.
 */
export function notificationForCreate(table: string, row: Record<string, unknown>): RowNotification | null {
  const id = typeof row._id === "string" ? row._id : typeof row.id === "string" ? row.id : null;

  if (table === "incident") {
    return {
      event: "incident_opened",
      entityType: "incident",
      entityId: id,
      vars: {
        titulo: String(row.title || row.code || "sin título"),
        gravedad: row.severity ? String(row.severity) : null,
        lugar: row.location ? String(row.location) : null,
      },
    };
  }

  return null;
}

/* --------------------------------------------------------- la clave única */

export interface DedupeInput {
  entityId?: string | null;
  userId?: string | null;
  /**
   * Lo que distingue dos avisos del mismo evento cuando no hay una fila que los
   * distinga. El aviso del plan lo usa para repetirse una vez al mes por
   * métrica, en vez de una sola vez en la vida de la empresa.
   */
  seed?: string | null;
}

/**
 * Lo que identifica un aviso para no repetirlo.
 *
 * La compone la aplicación y la hace cumplir un índice único en 0044: es la
 * única forma de que dos instancias escribiendo a la vez no dejen dos copias.
 */
export function dedupeKeyFor(event: NotifyEventKey, input: DedupeInput = {}): string {
  return [event, input.entityId || "-", input.userId || "-", input.seed || "-"].join(":");
}

/* ------------------------------------------------------------- el alcance */

const ROLE_RANK: Record<string, number> = {
  superadmin: 100, owner: 90, admin: 80, manager: 60, operations: 40, cashier: 40, seller: 20, partner: 10,
};

/**
 * Los destinos que alcanza quien tiene este rol.
 *
 * `superadmin` y `partner` no son destinos posibles: el primero no trabaja
 * dentro de una empresa y el segundo es del portal B2B, donde los avisos
 * internos de la operadora no pintan nada.
 */
const AUDIENCES: AudienceRole[] = ["owner", "admin", "manager", "operations", "cashier", "seller"];

export function audienceRolesFor(role: string): AudienceRole[] {
  const rank = ROLE_RANK[role] ?? 0;
  return AUDIENCES.filter((candidate) => ROLE_RANK[candidate] <= rank);
}

/** Quien pregunta por su bandeja. */
export interface ActorDeBandeja {
  userId: string;
  role: string;
  /**
   * Si pertenece a un tour center.
   *
   * Lo decide quien llama con `esDeSocio(ctx)`, que es el ÚNICO sitio del
   * sistema autorizado a mirar el nombre del rol. Repetir aquí la comparación
   * —`role === "partner"`— reabriría la puerta trasera que cerró 4.2: un
   * empleado de un tour center con otro rol pasaría de largo. Este módulo es
   * puro y no puede importar `tenant.ts`, que es `server-only`, así que la
   * decisión entra como dato.
   */
  esDeSocio: boolean;
  /** El tour center al que pertenece. */
  partnerId?: string | null;
}

/**
 * El filtro de la bandeja: lo mío, y lo de la empresa que me toca.
 *
 * Sin la parte del rol, un aviso de empresa lo veía TODO el mundo: el descuadre
 * de caja de anoche le aparecía al vendedor igual que al dueño. Y sin la parte
 * de `audience_role is null`, los avisos escritos antes de 0044 —que no tienen
 * rol— dejarían de verse, que es perder correo por cambiar de buzón.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS BUZONES, NO UNO CON PERMISOS
 *
 * El del socio y el de la operadora son buzones distintos y se arman por
 * caminos distintos, no por rango. Compartirlos con un rango pequeño tenía dos
 * fallos a la vez:
 *
 *  · **Hacia dentro.** El cajón de `audience_role is null` —los avisos
 *    anteriores a 0044, sin rol— lo alcanza cualquiera. Para un miembro de un
 *    tour center eso es la bandeja interna de la operadora, que no es suya.
 *  · **Hacia fuera.** Los avisos dirigidos a un socio llevan `partner_id` y no
 *    llevan rol, así que por rango no los alcanzaría nunca: el socio no vería
 *    los suyos ni con el rango más alto.
 *
 * Por eso el actor decide el camino entero, igual que en `sellerScopeApplies`.
 */
/**
 * ¿Este aviso es de quien lo quiere marcar?
 *
 * Vive al lado de `inboxFilter` y no en la ruta porque son la MISMA regla
 * escrita dos veces si se separan: leer una bandeja y marcar lo que hay en ella
 * tienen que coincidir, o alguien marca como leído algo que no ve —o, peor, algo
 * que no es suyo.
 *
 * La comprobación de la ruta era `user_id` nulo ⇒ es de empresa ⇒ vale. Con los
 * avisos de socio eso se convirtió en un agujero: sus filas TAMBIÉN tienen
 * `user_id` nulo, así que cualquiera de la empresa —y cualquier miembro de otro
 * tour center— podía marcarle los avisos como leídos y hacerlos desaparecer de
 * su campana sin que él los hubiera visto.
 */
export function puedeMarcar(
  aviso: { user_id?: string | null; partner_id?: string | null },
  actor: ActorDeBandeja
): boolean {
  if (aviso.user_id) return aviso.user_id === actor.userId;
  // De un tour center: solo los suyos. Y por identificador — sin ficha, nadie.
  if (aviso.partner_id) return Boolean(actor.partnerId) && aviso.partner_id === actor.partnerId;
  // De empresa: interno. Quien es de un socio ya no lo ve en su bandeja, así
  // que tampoco puede marcarlo.
  return !actor.esDeSocio;
}

export function inboxFilter(actor: ActorDeBandeja): Record<string, unknown> {
  if (actor.esDeSocio) {
    /**
     * Lo de su tour center, y lo suyo personal. Nada más.
     *
     * Y por IDENTIFICADOR: si no lo tiene, no le toca ningún aviso de socio —
     * es el mismo criterio que el resto de su ámbito, y devolver aquí el cajón
     * sin rol sería justamente la bandeja interna de la operadora.
     */
    const suyos: Record<string, unknown>[] = [{ user_id: actor.userId }];
    if (actor.partnerId) suyos.push({ partner_id: actor.partnerId });
    return { _or: suyos };
  }

  return {
    /**
     * Y la operadora NO ve las copias del socio.
     *
     * Cada hecho que le importa a los dos escribe dos avisos —uno para la
     * operación, otro para el tour center—, así que dejar pasar el del socio
     * duplicaría la campana y el contador. Un aviso que empieza por «te
     * pagamos la liquidación» tampoco se lee bien desde el lado que paga.
     */
    partner_id: null,
    _or: [
      { user_id: actor.userId },
      { user_id: null, audience_role: null },
      { user_id: null, audience_role: { in: audienceRolesFor(actor.role) } },
    ],
  };
}
