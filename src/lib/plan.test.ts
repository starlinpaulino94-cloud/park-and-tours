import { describe, it, expect } from "vitest";
import {
  subscriptionState, limitCheck, limitMessage, blockMessage, moduleAllowed,
  planStatus, monthStart, GRACE_DAYS_PAST_DUE, TRIAL_WARNING_DAYS,
} from "@/lib/plan";

/**
 * El plan decide si una empresa puede seguir operando, así que aquí se prueban
 * las FRONTERAS: el día que vence la prueba, el límite exacto, el cero, el
 * dato ausente. Son los cuatro sitios donde este tipo de regla se equivoca, y
 * equivocarse significa o cortarle la operación a quien paga o regalar el
 * producto a quien no.
 */

const NOW = new Date("2026-09-16T12:00:00Z");
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

describe("estado de la suscripción", () => {
  it("sin información no bloquea: el dato ausente deja trabajar", () => {
    for (const input of [null, undefined, {}, { subscription_status: "" }, { subscription_status: null }]) {
      const state = subscriptionState(input, NOW);
      expect(state.canWrite, JSON.stringify(input)).toBe(true);
      expect(state.status).toBe("unknown");
      expect(state.warn).toBe(false);
    }
  });

  it("un estado heredado que el check ya no admite tampoco bloquea", () => {
    // 0042 normaliza estos valores a NULL, pero una base restaurada de un
    // respaldo viejo puede traerlos. Bloquear por eso sería cerrar la puerta
    // por una rareza de datos, no por un impago.
    const state = subscriptionState({ subscription_status: "activo" }, NOW);
    expect(state.canWrite).toBe(true);
    expect(state.status).toBe("unknown");
  });

  it("activa: escribe y no avisa", () => {
    const state = subscriptionState({ subscription_status: "active" }, NOW);
    expect(state.canWrite).toBe(true);
    expect(state.warn).toBe(false);
    expect(state.reason).toBeNull();
  });

  it("prueba en curso: escribe, y avisa solo cuando está cerca del final", () => {
    const lejos = subscriptionState({ subscription_status: "trial", trial_ends_at: inDays(10) }, NOW);
    expect(lejos.canWrite).toBe(true);
    expect(lejos.trialDaysLeft).toBe(10);
    expect(lejos.warn).toBe(false);

    const cerca = subscriptionState(
      { subscription_status: "trial", trial_ends_at: inDays(TRIAL_WARNING_DAYS) }, NOW);
    expect(cerca.canWrite).toBe(true);
    expect(cerca.warn).toBe(true);
  });

  it("la prueba vence al pasar la fecha, no antes: el último día se sigue vendiendo", () => {
    // Frontera: quedan horas. Cortar aquí sería cobrarle un día de menos a
    // quien todavía está decidiendo.
    const ultimoDia = subscriptionState(
      { subscription_status: "trial", trial_ends_at: new Date(NOW.getTime() + 3_600_000).toISOString() }, NOW);
    expect(ultimoDia.canWrite).toBe(true);
    expect(ultimoDia.trialDaysLeft).toBe(1);

    const vencida = subscriptionState(
      { subscription_status: "trial", trial_ends_at: inDays(-1) }, NOW);
    expect(vencida.canWrite).toBe(false);
    expect(vencida.reason).toBe("trial_expired");
  });

  it("una prueba sin fecha de fin no vence nunca", () => {
    // Son las empresas dadas de alta antes de que la columna existiera: la
    // migración no puede inventarles una fecha de vencimiento retroactiva.
    const state = subscriptionState({ subscription_status: "trial" }, NOW);
    expect(state.canWrite).toBe(true);
    expect(state.trialDaysLeft).toBeNull();
  });

  it("cobro fallido: hay gracia, avisa desde el primer día y bloquea al agotarse", () => {
    const reciente = subscriptionState(
      { subscription_status: "past_due", next_billing_at: inDays(-1) }, NOW);
    expect(reciente.canWrite).toBe(true);
    expect(reciente.warn).toBe(true);
    expect(reciente.graceDaysLeft).toBe(GRACE_DAYS_PAST_DUE - 1);

    const agotada = subscriptionState(
      { subscription_status: "past_due", next_billing_at: inDays(-GRACE_DAYS_PAST_DUE - 1) }, NOW);
    expect(agotada.canWrite).toBe(false);
    expect(agotada.reason).toBe("past_due");
  });

  it("cobro fallido sin fecha: se concede la gracia completa, no se bloquea", () => {
    const state = subscriptionState({ subscription_status: "past_due" }, NOW);
    expect(state.canWrite).toBe(true);
    expect(state.graceDaysLeft).toBe(GRACE_DAYS_PAST_DUE);
  });

  it("cancelada y suspendida bloquean la escritura de inmediato", () => {
    for (const status of ["cancelled", "suspended"] as const) {
      const state = subscriptionState({ subscription_status: status }, NOW);
      expect(state.canWrite, status).toBe(false);
      expect(state.reason).toBe(status);
    }
  });

  it("todo motivo de bloqueo tiene un mensaje que dice que los datos siguen ahí", () => {
    for (const reason of ["trial_expired", "past_due", "cancelled", "suspended"] as const) {
      const message = blockMessage(reason);
      expect(message.length).toBeGreaterThan(20);
      // La promesa del principio 1, por escrito: se pierde la escritura, no el
      // acceso. Si alguien reescribe estos textos, esto lo recuerda.
      expect(message.toLowerCase(), reason).toMatch(/consult|export|datos siguen/);
    }
  });
});

describe("límites del plan", () => {
  const limits = { max_users: 3, max_bookings_month: 300, max_products: 50, max_storage_mb: 2048 };

  it("NULL es ilimitado, no cero", () => {
    const check = limitCheck("max_bookings_month", { max_bookings_month: null }, 999_999);
    expect(check.allowed).toBe(true);
    expect(check.limit).toBeNull();
    expect(check.remaining).toBeNull();
    expect(check.percent).toBeNull();
    expect(check.warn).toBe(false);
  });

  it("un plan sin límites declarados no bloquea nada", () => {
    expect(limitCheck("max_users", null, 500).allowed).toBe(true);
    expect(limitCheck("max_users", {}, 500).allowed).toBe(true);
  });

  it("el límite se alcanza EN el número, no después", () => {
    // La frontera que regala una unidad si se escribe `>` en vez de `>=`.
    expect(limitCheck("max_users", limits, 2).allowed).toBe(true);
    const lleno = limitCheck("max_users", limits, 3);
    expect(lleno.allowed).toBe(false);
    expect(lleno.remaining).toBe(0);
    expect(lleno.percent).toBe(100);
  });

  it("cero es un límite real: no deja crear ninguna", () => {
    const check = limitCheck("max_products", { max_products: 0 }, 0);
    expect(check.allowed).toBe(false);
    expect(check.percent).toBe(100);
  });

  it("avisa a partir del 80 % sin bloquear", () => {
    const ochenta = limitCheck("max_bookings_month", limits, 240);
    expect(ochenta.percent).toBe(80);
    expect(ochenta.warn).toBe(true);
    expect(ochenta.allowed).toBe(true);

    const setentaynueve = limitCheck("max_bookings_month", limits, 236);
    expect(setentaynueve.percent).toBe(79);
    expect(setentaynueve.warn).toBe(false);
  });

  it("el aviso se decide sobre el porcentaje QUE SE ENSEÑA, no sobre el crudo", () => {
    // 239 de 300 es 79,67 %: el medidor redondea y enseña 80 %. El aviso sale
    // con ese mismo 80 % —no con el crudo— para que la pantalla no diga «80 %»
    // al lado de una barra tranquila. El medidor y el aviso cuentan la misma
    // historia, igual que el medidor y la guarda.
    const check = limitCheck("max_bookings_month", limits, 239);
    expect(check.percent).toBe(80);
    expect(check.warn).toBe(true);
  });

  it("pedir varias de golpe se mide entero: una importación no entra a medias", () => {
    // Importar 60 clientes con 10 de hueco tiene que fallar ANTES de escribir
    // los primeros 10 y dejar el archivo a medio cargar.
    const check = limitCheck("max_products", limits, 45, 10);
    expect(check.allowed).toBe(false);
    expect(limitCheck("max_products", limits, 40, 10).allowed).toBe(true);
  });

  it("un uso corrupto no se convierte en negativo ni en NaN", () => {
    for (const used of [-5, NaN, Infinity]) {
      const check = limitCheck("max_users", limits, used as number);
      expect(Number.isFinite(check.used), String(used)).toBe(true);
      expect(check.used).toBeGreaterThanOrEqual(0);
    }
  });

  it("el mensaje del límite nombra el techo y la salida", () => {
    const message = limitMessage(limitCheck("max_users", limits, 3), "Operador");
    expect(message).toContain("3");
    expect(message).toContain("Operador");
    expect(message.toLowerCase()).toContain("sube de plan");
  });
});

describe("módulos", () => {
  it("la lista vacía significa sin restricción, no sin módulos", () => {
    // Al contrario dejaría a oscuras a toda empresa anterior al alta nueva.
    expect(moduleAllowed(null, "accounting")).toBe(true);
    expect(moduleAllowed([], "accounting")).toBe(true);
  });

  it("con lista, solo entra lo contratado", () => {
    expect(moduleAllowed(["bookings", "payments"], "bookings")).toBe(true);
    expect(moduleAllowed(["bookings", "payments"], "accounting")).toBe(false);
  });
});

describe("resumen para la pantalla", () => {
  const plan = {
    code: "operador", name: "Operador", max_users: 3, max_bookings_month: 300,
    max_products: 50, max_storage_mb: 2048,
    modules_enabled: ["bookings", "crm", "payments", "cash_pos", "reports", "audit"],
  };
  const usage = { users: 3, bookingsThisMonth: 120, products: 10, storageMb: 100 };

  it("el medidor y la guarda dicen lo mismo", () => {
    const status = planStatus(plan, { subscription_status: "active" }, usage, NOW);
    const users = status.limits.find((l) => l.metric === "max_users")!;
    expect(users.allowed).toBe(false);
    // La guarda de la API llama a `limitCheck` con los mismos datos: si esto
    // divergiera, la pantalla prometería un usuario que la API rechaza.
    expect(limitCheck("max_users", plan, usage.users).allowed).toBe(users.allowed);
  });

  it("enumera los trece módulos, marcados uno por uno", () => {
    const status = planStatus(plan, { subscription_status: "active" }, usage, NOW);
    expect(status.modules).toHaveLength(13);
    expect(status.modules.find((m) => m.key === "accounting")!.enabled).toBe(false);
    expect(status.modules.find((m) => m.key === "bookings")!.enabled).toBe(true);
  });

  it("sin plan asignado no hay techo, y sigue pudiendo escribir", () => {
    const status = planStatus(null, { subscription_status: "active" }, usage, NOW);
    expect(status.subscription.canWrite).toBe(true);
    expect(status.limits.every((l) => l.allowed)).toBe(true);
    expect(status.modules.every((m) => m.enabled)).toBe(true);
  });
});

describe("el mes en curso", () => {
  it("empieza el día 1 a medianoche UTC", () => {
    expect(monthStart(new Date("2026-09-16T23:30:00Z"))).toBe("2026-09-01T00:00:00.000Z");
  });

  it("el último instante del mes sigue contando en ese mes", () => {
    // Frontera del cambio de mes: contar desde el mes siguiente pondría el
    // contador a cero un día antes y regalaría un mes de reservas.
    expect(monthStart(new Date("2026-09-30T23:59:59Z"))).toBe("2026-09-01T00:00:00.000Z");
    expect(monthStart(new Date("2026-10-01T00:00:00Z"))).toBe("2026-10-01T00:00:00.000Z");
  });
});
