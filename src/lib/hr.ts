/**
 * RR. HH. — el turno, la hora y lo que se paga.
 *
 * El módulo de personal llevaba desde el principio pidiendo tres datos que
 * nadie leía: si una certificación bloquea la asignación, si está vigente, y
 * cuántas horas se trabajaron. Este archivo es donde esos tres datos empiezan
 * a significar algo. Es puro a propósito —no toca la base, no lee la sesión—
 * porque son las reglas que hay que poder probar de una en una:
 *
 *  · **La certificación vence sola.** Un estado tecleado a mano miente el día
 *    después. Aquí el estado se DEDUCE de la fecha, y solo lo administrativo
 *    (revocada, pendiente) puede ganarle al calendario.
 *
 *  · **Las horas se calculan.** Teniendo la entrada, la salida y el descanso,
 *    pedirle la resta a una persona es pedirle que se equivoque.
 *
 *  · **El recargo es el que manda la ley.** En la República Dominicana la
 *    jornada es de 8 h al día y 44 a la semana; lo que pasa de ahí se paga con
 *    un 35 % de recargo hasta las 68 horas semanales, y al 100 % por encima
 *    (Código de Trabajo, arts. 147 y 203). Un sistema que multiplique todo por
 *    1,5 «como en las películas» le paga de menos a unos y de más a otros.
 */

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

/** Fecha en `YYYY-MM-DD`, que es como se comparan los días sin husos de por medio. */
export function dayOf(value: unknown): string | null {
  if (!value) return null;
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Días entre dos fechas `YYYY-MM-DD` (positivo si `to` es posterior). */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/* ═══════════════════════════════════════════ certificaciones que sí bloquean */

export type CertState = "valid" | "expiring" | "expired" | "revoked" | "pending";

/**
 * A cuántos días de vencer una certificación ya hay que moverse.
 *
 * Treinta porque renovar un curso de primeros auxilios o una licencia no es
 * trámite de un día: hay que buscar cupo, hacerlo y esperar el papel. Avisar la
 * víspera es avisar tarde.
 */
export const EXPIRING_WINDOW_DAYS = 30;

export interface CertificationLike {
  _id?: string | null;
  id?: string | null;
  name?: string | null;
  cert_type?: string | null;
  expires_at?: string | null;
  status?: string | null;
  blocks_assignment?: boolean | null;
  staff?: unknown;
}

/**
 * El estado REAL de una certificación el día `today`.
 *
 * `revoked` y `pending` son decisiones de una persona y ganan siempre: una
 * certificación revocada no vuelve a ser válida porque su fecha aún no llegó,
 * y una pendiente no es válida porque falte mucho para vencer. Lo demás lo
 * decide el calendario, no lo que alguien tecleó hace un año.
 */
export function certificationState(cert: CertificationLike, today: string): CertState {
  const declared = String(cert.status || "").toLowerCase();
  if (declared === "revoked") return "revoked";
  if (declared === "pending") return "pending";

  const expires = dayOf(cert.expires_at);
  // Sin fecha de vencimiento no hay nada que vencer: un título universitario no
  // caduca. Se respeta lo declarado salvo que sea un estado derivado obsoleto.
  if (!expires) return declared === "expired" ? "expired" : "valid";

  const left = daysBetween(today, expires);
  if (left < 0) return "expired";
  if (left <= EXPIRING_WINDOW_DAYS) return "expiring";
  return "valid";
}

/** ¿Esta certificación impide, hoy, que a esta persona se le asigne trabajo? */
export function certificationBlocks(cert: CertificationLike, today: string): boolean {
  if (!cert.blocks_assignment) return false;
  const state = certificationState(cert, today);
  return state === "expired" || state === "revoked";
}

export interface AssignmentBlock {
  /** Por qué no se puede asignar, en palabras que el operador entiende. */
  reason: string;
  /** Las certificaciones concretas que lo impiden. */
  certifications: { id: string | null; name: string; state: CertState }[];
}

/**
 * El veredicto de asignación para una persona.
 *
 * Devuelve `null` cuando se puede asignar; eso es lo que hace que quien llame
 * no pueda ignorar el bloqueo por accidente: o hay motivo, o no lo hay.
 *
 * Ojo con lo que NO bloquea: una certificación a punto de vencer avisa pero
 * deja trabajar. Bloquear por «vence en tres semanas» dejaría la operación sin
 * guías un lunes cualquiera, y el sistema se volvería el enemigo.
 */
export function assignmentBlock(certs: CertificationLike[], today: string): AssignmentBlock | null {
  const blocking = certs.filter((c) => certificationBlocks(c, today));
  if (blocking.length === 0) return null;
  const items = blocking.map((c) => ({
    id: (c._id ?? c.id ?? null) as string | null,
    name: String(c.name || "Certificación"),
    state: certificationState(c, today),
  }));
  const names = items.map((i) => i.name).join(", ");
  return {
    reason:
      items.length === 1
        ? `No se puede asignar: la certificación «${names}» está ${items[0].state === "revoked" ? "revocada" : "vencida"}.`
        : `No se puede asignar: ${items.length} certificaciones obligatorias están vencidas o revocadas (${names}).`,
    certifications: items,
  };
}

/** Las que hay que renovar ya: vencidas o a punto de vencer. */
export function certificationsToRenew(certs: CertificationLike[], today: string) {
  return certs
    .map((c) => ({ cert: c, state: certificationState(c, today) }))
    .filter((x) => x.state === "expired" || x.state === "expiring");
}

/* ═════════════════════════════════════════════════════ turnos sin solaparse */

export interface ShiftLike {
  _id?: string | null;
  id?: string | null;
  role_label?: string | null;
  shift_date?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  status?: string | null;
  break_min?: number | null;
  hours_planned?: number | null;
  hourly_rate?: number | null;
  staff?: unknown;
}

/** La ventana del turno en milisegundos, o `null` si no tiene horas puestas. */
export function shiftWindow(shift: ShiftLike): { start: number; end: number } | null {
  const start = shift.starts_at ? Date.parse(shift.starts_at) : NaN;
  const end = shift.ends_at ? Date.parse(shift.ends_at) : NaN;
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  if (end <= start) return null;
  return { start, end };
}

/**
 * ¿Se pisan dos turnos?
 *
 * Dos turnos que se tocan en el borde (uno acaba a las 14:00 y el otro empieza
 * a las 14:00) NO se pisan: es el relevo normal de una jornada partida.
 */
export function shiftsOverlap(a: ShiftLike, b: ShiftLike): boolean {
  const wa = shiftWindow(a);
  const wb = shiftWindow(b);
  if (!wa || !wb) {
    // Sin horas solo queda el día: dos turnos el mismo día sin horario son, a
    // efectos de planificación, el mismo hueco.
    const da = dayOf(a.shift_date);
    const db = dayOf(b.shift_date);
    return Boolean(da && db && da === db);
  }
  return wa.start < wb.end && wb.start < wa.end;
}

/** Estados en los que un turno ya no ocupa a la persona. */
const DEAD_SHIFT = new Set(["cancelled", "no_show"]);

/**
 * El primer turno de la lista que choca con el candidato, si lo hay.
 *
 * Un turno cancelado no ocupa a nadie, y el propio turno que se está editando
 * tampoco choca consigo mismo.
 */
export function conflictingShift(existing: ShiftLike[], candidate: ShiftLike): ShiftLike | null {
  const selfId = candidate._id ?? candidate.id ?? null;
  for (const s of existing) {
    const sid = s._id ?? s.id ?? null;
    if (selfId && sid && sid === selfId) continue;
    if (DEAD_SHIFT.has(String(s.status || "").toLowerCase())) continue;
    if (shiftsOverlap(s, candidate)) return s;
  }
  return null;
}

/** Horas previstas del turno: las declaradas o, si no, las de su ventana. */
export function plannedHours(shift: ShiftLike): number {
  const declared = num(shift.hours_planned);
  if (declared > 0) return round2(declared);
  const w = shiftWindow(shift);
  if (!w) return 0;
  const gross = (w.end - w.start) / 3_600_000;
  return round2(Math.max(0, gross - num(shift.break_min) / 60));
}

/** Estados desde los que publicar un turno tiene sentido. */
export const PUBLISHABLE_SHIFT_STATUS = new Set(["planned"]);

/**
 * Qué pasa al publicar un turno.
 *
 * Publicar es decirle a la persona «esta es tu semana». Solo se publica lo que
 * está planificado y tiene a quién: publicar un turno sin nombre es publicar un
 * hueco, y publicar uno ya confirmado lo devolvería atrás.
 */
export function publishDecision(shift: ShiftLike): { ok: true } | { ok: false; reason: string } {
  const status = String(shift.status || "planned").toLowerCase();
  if (!PUBLISHABLE_SHIFT_STATUS.has(status)) {
    return { ok: false, reason: "Solo se publican los turnos en planificación." };
  }
  if (!shift.staff) {
    return { ok: false, reason: "El turno no tiene a nadie asignado." };
  }
  if (!dayOf(shift.shift_date)) {
    return { ok: false, reason: "El turno no tiene fecha." };
  }
  return { ok: true };
}

/* ═══════════════════════════════════════════════ de los marcajes a las horas */

/** Jornada ordinaria diaria en la República Dominicana (art. 147). */
export const DAILY_REGULAR_HOURS = 8;
/** Jornada ordinaria semanal (art. 147). */
export const WEEKLY_REGULAR_HOURS = 44;
/** Tope semanal a partir del cual el recargo pasa del 35 % al 100 % (art. 203). */
export const WEEKLY_OVERTIME_CAP = 68;
/** Recargo de la hora extraordinaria hasta el tope semanal. */
export const OVERTIME_RATE = 1.35;
/** Recargo de la hora que pasa del tope semanal. */
export const EXTRA_OVERTIME_RATE = 2;

export interface AttendanceLike {
  _id?: string | null;
  id?: string | null;
  attendance_date?: string | null;
  clock_in?: string | null;
  clock_out?: string | null;
  break_min?: number | null;
  hours_worked?: number | null;
  regular_hours?: number | null;
  overtime_hours?: number | null;
  status?: string | null;
  staff?: unknown;
  approved_at?: string | null;
  payroll_run_id?: string | null;
}

/**
 * Horas de verdad entre dos marcajes, menos el descanso.
 *
 * Un turno de noche cruza la medianoche: la salida cae en el día siguiente y la
 * resta sale negativa si uno se fía del reloj y no de la fecha. Aquí se usan
 * los dos instantes completos, así que el cruce sale solo.
 */
export function workedHours(clockIn: unknown, clockOut: unknown, breakMin: unknown = 0): number {
  const a = clockIn ? Date.parse(String(clockIn)) : NaN;
  const b = clockOut ? Date.parse(String(clockOut)) : NaN;
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return 0;
  const gross = (b - a) / 3_600_000;
  return round2(Math.max(0, gross - num(breakMin) / 60));
}

/** Estados de asistencia en los que no se trabajó, se cobre o no. */
export const NON_WORKING_ATTENDANCE = new Set(["absent", "excused", "holiday", "vacation", "sick"]);

/**
 * Reparto diario: lo que pasa de la jornada es extraordinario.
 *
 * El reparto definitivo es semanal (las 44 horas), pero el diario es el que ve
 * el encargado al aprobar el día, y tiene que cuadrar con lo que firmó.
 */
export function splitDaily(hours: number, dailyRegular = DAILY_REGULAR_HOURS) {
  const worked = Math.max(0, round2(num(hours)));
  const regular = Math.min(worked, dailyRegular);
  return { regular: round2(regular), overtime: round2(worked - regular) };
}

/** Las horas de un marcaje, calculadas o —si no hay marcajes— las declaradas. */
export function attendanceHours(att: AttendanceLike): { worked: number; regular: number; overtime: number } {
  if (NON_WORKING_ATTENDANCE.has(String(att.status || "").toLowerCase())) {
    return { worked: 0, regular: 0, overtime: 0 };
  }
  const computed = workedHours(att.clock_in, att.clock_out, att.break_min);
  // Sin salida marcada no hay jornada que calcular, pero puede haberla anotado
  // el encargado a mano: se respeta ese dato en vez de pagar cero.
  const worked = computed > 0 ? computed : Math.max(0, num(att.hours_worked));
  const split = splitDaily(worked);
  return { worked: round2(worked), ...split };
}

export type ClockAction = "in" | "out";

/**
 * Qué se escribe al fichar.
 *
 * Fichar dos veces la entrada no es un error del empleado: es el kiosco que se
 * quedó pensando y él que volvió a tocar. Se le contesta que ya estaba fichado
 * en vez de pisarle la hora real de llegada —que es la que cuenta—.
 */
export function clockDecision(
  current: AttendanceLike | null,
  action: ClockAction,
  nowISO: string
):
  | { ok: false; reason: string; code: "already_in" | "not_in" | "already_out" | "locked" }
  | { ok: true; patch: Record<string, unknown>; hours: { worked: number; regular: number; overtime: number } } {
  if (current?.payroll_run_id) {
    return { ok: false, reason: "Este día ya se pagó en una corrida de nómina.", code: "locked" };
  }
  if (action === "in") {
    if (current?.clock_in && !current?.clock_out) {
      return { ok: false, reason: "Ya tienes la entrada marcada.", code: "already_in" };
    }
    if (current?.clock_in && current?.clock_out) {
      return { ok: false, reason: "La jornada de hoy ya está cerrada.", code: "already_out" };
    }
    return {
      ok: true,
      patch: { clock_in: nowISO, status: "present", method: "kiosk" },
      hours: { worked: 0, regular: 0, overtime: 0 },
    };
  }

  if (!current?.clock_in) {
    return { ok: false, reason: "No hay entrada marcada que cerrar.", code: "not_in" };
  }
  if (current.clock_out) {
    return { ok: false, reason: "La salida ya estaba marcada.", code: "already_out" };
  }
  const hours = attendanceHours({ ...current, clock_out: nowISO });
  return {
    ok: true,
    patch: {
      clock_out: nowISO,
      hours_worked: hours.worked,
      regular_hours: hours.regular,
      overtime_hours: hours.overtime,
    },
    hours,
  };
}

/* ═══════════════════════════════════════════════════════════════════ nómina */

/**
 * Tipos de cotización de la Seguridad Social dominicana (TSS).
 *
 * Son los vigentes al escribir esto y se COPIAN a cada corrida: cuando cambien,
 * lo pagado el año pasado tiene que seguir explicándose con los de entonces.
 * Por eso están aquí solo como valor por defecto, no como verdad eterna.
 */
export const TSS_DEFAULTS = {
  sfsEmployee: 3.041,
  afpEmployee: 2.87,
  sfsEmployer: 7.09,
  afpEmployer: 7.1,
  riskEmployer: 1.2,
} as const;

/**
 * Escala anual del ISR sobre rentas del trabajo.
 *
 * Los tramos están en pesos al año; la retención mensual es la doceava parte.
 * Si la DGII los actualiza, se cambian aquí y en ningún otro sitio.
 */
export const ISR_BRACKETS: { upTo: number | null; base: number; rate: number; from: number }[] = [
  { from: 0, upTo: 416_220.0, base: 0, rate: 0 },
  { from: 416_220.0, upTo: 624_329.0, base: 0, rate: 0.15 },
  { from: 624_329.0, upTo: 867_123.0, base: 31_216.0, rate: 0.2 },
  { from: 867_123.0, upTo: null, base: 79_776.0, rate: 0.25 },
];

/** ISR anual de una renta imponible anual, según la escala vigente. */
export function isrAnnual(taxableAnnual: number): number {
  const income = Math.max(0, num(taxableAnnual));
  for (const b of ISR_BRACKETS) {
    if (b.upTo === null || income <= b.upTo) {
      return round2(b.base + (income - b.from) * b.rate);
    }
  }
  return 0;
}

/**
 * Retención mensual del ISR.
 *
 * La escala es anual, así que el sueldo del mes se anualiza, se le aplica la
 * escala y se divide entre doce. Aplicar los tramos al sueldo mensual —el error
 * clásico— dejaría a todo el mundo exento.
 */
export function isrMonthly(taxableMonthly: number): number {
  return round2(isrAnnual(Math.max(0, num(taxableMonthly)) * 12) / 12);
}

export interface StaffLike {
  _id?: string | null;
  id?: string | null;
  full_name?: string | null;
  payroll_code?: string | null;
  social_security_id?: string | null;
  salary_type?: string | null;
  base_salary?: number | null;
  hourly_rate?: number | null;
  daily_rate?: number | null;
  currency?: string | null;
  applies_social_security?: boolean | null;
  status?: string | null;
}

export interface PayrollPolicy {
  sfsEmployeePct: number;
  afpEmployeePct: number;
  sfsEmployerPct: number;
  afpEmployerPct: number;
  riskEmployerPct: number;
  /** Meses que cubre el periodo: 1 para mensual, 0,5 para quincenal. */
  monthsInPeriod: number;
}

export function defaultPolicy(monthsInPeriod = 0.5): PayrollPolicy {
  return {
    sfsEmployeePct: TSS_DEFAULTS.sfsEmployee,
    afpEmployeePct: TSS_DEFAULTS.afpEmployee,
    sfsEmployerPct: TSS_DEFAULTS.sfsEmployer,
    afpEmployerPct: TSS_DEFAULTS.afpEmployer,
    riskEmployerPct: TSS_DEFAULTS.riskEmployer,
    monthsInPeriod,
  };
}

/**
 * La tarifa por hora de una persona.
 *
 * Un sueldo mensual se convierte a hora dividiendo entre 23,83 jornadas — el
 * divisor que usa la práctica dominicana (52 semanas × 44 h ÷ 12 meses ÷ 8 h).
 * Es el número con el que se calculan las horas extra de un asalariado; usar
 * «30 días» daría una hora más barata y pagaría de menos el tiempo extra.
 */
export const MONTHLY_HOURS = round4((52 * WEEKLY_REGULAR_HOURS) / 12); // 190,6667

export function hourlyRateFor(staff: StaffLike): number {
  const explicit = num(staff.hourly_rate);
  if (explicit > 0) return round4(explicit);
  const type = String(staff.salary_type || "").toLowerCase();
  if (type === "monthly") {
    const base = num(staff.base_salary);
    return base > 0 ? round4(base / MONTHLY_HOURS) : 0;
  }
  if (type === "daily" || num(staff.daily_rate) > 0) {
    const daily = num(staff.daily_rate) || num(staff.base_salary);
    return daily > 0 ? round4(daily / DAILY_REGULAR_HOURS) : 0;
  }
  const base = num(staff.base_salary);
  return base > 0 ? round4(base / MONTHLY_HOURS) : 0;
}

export interface PayrollEntry {
  /** Día trabajado, `YYYY-MM-DD`. */
  date: string;
  regular: number;
  overtime: number;
}

export interface PayrollLineDraft {
  staffId: string | null;
  staffName: string;
  payrollCode: string | null;
  socialSecurityId: string | null;
  daysWorked: number;
  regularHours: number;
  overtimeHours: number;
  extraOvertimeHours: number;
  hourlyRate: number;
  regularAmount: number;
  overtimeAmount: number;
  otherEarnings: number;
  grossAmount: number;
  sfsEmployee: number;
  afpEmployee: number;
  isrAmount: number;
  otherDeductions: number;
  deductionsAmount: number;
  netAmount: number;
  employerCost: number;
  currency: string;
}

/** La semana ISO (lunes a domingo) a la que pertenece un día. */
export function weekKey(dateISO: string): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateISO;
  const dow = (d.getUTCDay() + 6) % 7; // 0 = lunes
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/**
 * Reparto semanal de las horas extraordinarias.
 *
 * El día dice qué pasó de las 8 horas; la semana dice cuánto de eso pasa del
 * tope de 68 y por tanto se paga al 100 % en vez de al 35 %. Sin agrupar por
 * semana, seis días de doce horas se pagarían todos al 35 % y la empresa
 * quedaría debiendo el resto.
 */
export function weeklyOvertime(entries: PayrollEntry[]): {
  regular: number; overtime: number; extraOvertime: number; days: number;
} {
  const weeks = new Map<string, { regular: number; overtime: number }>();
  let days = 0;
  for (const e of entries) {
    const worked = num(e.regular) + num(e.overtime);
    if (worked > 0) days += 1;
    const k = weekKey(e.date);
    const acc = weeks.get(k) || { regular: 0, overtime: 0 };
    acc.regular += num(e.regular);
    acc.overtime += num(e.overtime);
    weeks.set(k, acc);
  }

  let regular = 0, overtime = 0, extraOvertime = 0;
  for (const w of weeks.values()) {
    // Lo ordinario de la semana no puede pasar de 44 aunque ningún día haya
    // pasado de 8: seis jornadas de 8 h son 48, y las 4 últimas son extra.
    const reg = Math.min(w.regular, WEEKLY_REGULAR_HOURS);
    const spill = w.regular - reg;
    const totalOver = w.overtime + spill;
    const totalWeek = reg + totalOver;
    const aboveCap = Math.max(0, totalWeek - WEEKLY_OVERTIME_CAP);
    regular += reg;
    overtime += Math.max(0, totalOver - aboveCap);
    extraOvertime += aboveCap;
  }
  return {
    regular: round2(regular),
    overtime: round2(overtime),
    extraOvertime: round2(extraOvertime),
    days,
  };
}

export interface LineExtras {
  otherEarnings?: number;
  otherDeductions?: number;
}

/**
 * Una línea de nómina: de las horas de una persona a lo que se le transfiere.
 *
 * El orden importa y es el de la ley: primero el bruto, después la Seguridad
 * Social —que el ISR no grava—, y sobre lo que queda, el ISR. Calcular el ISR
 * sobre el bruto le retendría de más a todo el mundo.
 */
export function payrollLine(
  staff: StaffLike,
  entries: PayrollEntry[],
  policy: PayrollPolicy,
  extras: LineExtras = {}
): PayrollLineDraft {
  const rate = hourlyRateFor(staff);
  const { regular, overtime, extraOvertime, days } = weeklyOvertime(entries);

  const regularAmount = round2(regular * rate);
  const overtimeAmount = round2(overtime * rate * OVERTIME_RATE + extraOvertime * rate * EXTRA_OVERTIME_RATE);
  const otherEarnings = round2(num(extras.otherEarnings));
  const gross = round2(regularAmount + overtimeAmount + otherEarnings);

  const cotiza = staff.applies_social_security === true;
  const sfs = cotiza ? round2((gross * policy.sfsEmployeePct) / 100) : 0;
  const afp = cotiza ? round2((gross * policy.afpEmployeePct) / 100) : 0;

  // El ISR se retiene sobre el salario del MES, no sobre el de la quincena: se
  // lleva la base a mes completo, se calcula, y se retiene la parte del periodo.
  const months = policy.monthsInPeriod > 0 ? policy.monthsInPeriod : 1;
  const taxableMonthly = (gross - sfs - afp) / months;
  const isr = round2(isrMonthly(taxableMonthly) * months);

  const otherDeductions = round2(num(extras.otherDeductions));
  const deductions = round2(sfs + afp + isr + otherDeductions);
  const net = round2(gross - deductions);

  const employerCost = cotiza
    ? round2(
        gross +
          (gross * (policy.sfsEmployerPct + policy.afpEmployerPct + policy.riskEmployerPct)) / 100
      )
    : gross;

  return {
    staffId: (staff._id ?? staff.id ?? null) as string | null,
    staffName: String(staff.full_name || "Sin nombre"),
    payrollCode: staff.payroll_code ?? null,
    socialSecurityId: staff.social_security_id ?? null,
    daysWorked: days,
    regularHours: regular,
    overtimeHours: overtime,
    extraOvertimeHours: extraOvertime,
    hourlyRate: rate,
    regularAmount,
    overtimeAmount,
    otherEarnings,
    grossAmount: gross,
    sfsEmployee: sfs,
    afpEmployee: afp,
    isrAmount: isr,
    otherDeductions,
    deductionsAmount: deductions,
    netAmount: net,
    employerCost,
    currency: String(staff.currency || "dop").toLowerCase(),
  };
}

export function payrollTotals(lines: PayrollLineDraft[]) {
  const sum = (pick: (l: PayrollLineDraft) => number) => round2(lines.reduce((s, l) => s + pick(l), 0));
  return {
    staffCount: lines.length,
    gross: sum((l) => l.grossAmount),
    deductions: sum((l) => l.deductionsAmount),
    net: sum((l) => l.netAmount),
    employerCost: sum((l) => l.employerCost),
    regularHours: sum((l) => l.regularHours),
    overtimeHours: sum((l) => l.overtimeHours + l.extraOvertimeHours),
  };
}

/* ═════════════════════════════════════════════════════════ periodos y salida */

export type PeriodType = "weekly" | "biweekly" | "monthly" | "custom";

/** Cuántos meses cubre el periodo, que es lo que el ISR necesita saber. */
export function monthsInPeriod(type: PeriodType, start: string, end: string): number {
  if (type === "monthly") return 1;
  if (type === "biweekly") return 0.5;
  if (type === "weekly") return round4(7 / 30.4375);
  const days = daysBetween(start, end) + 1;
  return days > 0 ? round4(days / 30.4375) : 1;
}

/** La quincena o el mes al que pertenece un día, en fechas `YYYY-MM-DD`. */
export function periodFor(type: PeriodType, dateISO: string): { start: string; end: string } {
  const day = dayOf(dateISO) || dateISO;
  const [y, m, d] = day.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  if (type === "monthly") {
    return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(lastDay)}` };
  }
  if (type === "biweekly") {
    return d <= 15
      ? { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-15` }
      : { start: `${y}-${pad(m)}-16`, end: `${y}-${pad(m)}-${pad(lastDay)}` };
  }
  const start = weekKey(day);
  const endDate = new Date(`${start}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 6);
  return { start, end: endDate.toISOString().slice(0, 10) };
}

/**
 * Las columnas del archivo que se le manda al contador.
 *
 * Un solo sitio para el orden: la cabecera y las filas salen de aquí, así que
 * no pueden desalinearse —el fallo que convierte un ISR en un neto—.
 */
export const PAYROLL_COLUMNS: { key: keyof PayrollLineDraft; header: string }[] = [
  { key: "payrollCode", header: "Codigo" },
  { key: "staffName", header: "Nombre" },
  { key: "socialSecurityId", header: "NSS" },
  { key: "daysWorked", header: "Dias" },
  { key: "regularHours", header: "Horas ordinarias" },
  { key: "overtimeHours", header: "Horas extra 35%" },
  { key: "extraOvertimeHours", header: "Horas extra 100%" },
  { key: "hourlyRate", header: "Tarifa hora" },
  { key: "regularAmount", header: "Salario ordinario" },
  { key: "overtimeAmount", header: "Horas extra" },
  { key: "otherEarnings", header: "Otros ingresos" },
  { key: "grossAmount", header: "Bruto" },
  { key: "sfsEmployee", header: "SFS empleado" },
  { key: "afpEmployee", header: "AFP empleado" },
  { key: "isrAmount", header: "ISR" },
  { key: "otherDeductions", header: "Otras deducciones" },
  { key: "deductionsAmount", header: "Total deducciones" },
  { key: "netAmount", header: "Neto a pagar" },
  { key: "employerCost", header: "Costo empresa" },
];

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function payrollCsv(lines: PayrollLineDraft[]): string {
  const rows = [PAYROLL_COLUMNS.map((c) => c.header).join(",")];
  for (const l of lines) {
    rows.push(PAYROLL_COLUMNS.map((c) => csvCell(l[c.key])).join(","));
  }
  const t = payrollTotals(lines);
  rows.push(
    [
      "", "TOTALES", "", "", t.regularHours, t.overtimeHours, "", "", "", "", "",
      t.gross, "", "", "", "", t.deductions, t.net, t.employerCost,
    ].map(csvCell).join(",")
  );
  return rows.join("\n");
}

/** Estados de una corrida que todavía se puede tocar. */
export const OPEN_PAYROLL_STATUS = new Set(["draft"]);

/** Qué se puede hacer con una corrida según cómo esté. */
export function payrollTransition(
  status: string,
  action: "approve" | "pay" | "cancel"
): { ok: true; next: string } | { ok: false; reason: string } {
  const s = String(status || "draft").toLowerCase();
  if (action === "approve") {
    if (s !== "draft") return { ok: false, reason: "Solo se aprueba una corrida en borrador." };
    return { ok: true, next: "approved" };
  }
  if (action === "pay") {
    if (s !== "approved") return { ok: false, reason: "Hay que aprobar la corrida antes de pagarla." };
    return { ok: true, next: "paid" };
  }
  if (s === "paid") return { ok: false, reason: "Una corrida pagada no se anula: emite el ajuste en la siguiente." };
  if (s === "cancelled") return { ok: false, reason: "La corrida ya estaba anulada." };
  return { ok: true, next: "cancelled" };
}
