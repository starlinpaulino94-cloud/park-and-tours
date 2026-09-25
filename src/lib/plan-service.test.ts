import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";
import { fakeSupabase, type FakeSupabase } from "@/test/fake-supabase";

/**
 * EL TECHO DEL PLAN, CONTRA LA BASE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DÓNDE SE PUEDE EQUIVOCAR ESTE SERVICIO
 *
 * Las reglas —cuándo avisa, cuándo bloquea, qué dice el mensaje— viven en
 * `plan.ts` y están probadas. Lo que decide ESTE fichero es el NÚMERO con el
 * que se comparan, y ahí hay tres cosas que el módulo puro no puede ver:
 *
 *   · qué organizaciones entran en el recuento de usuarios —la membresía de un
 *     vendedor de tour center cuelga del socio, no de la operadora—;
 *   · dónde se corta el mes de las reservas, que en UTC no es el mes de la
 *     empresa;
 *   · y qué pasa cuando un recuento no se puede hacer: cero no es «no lleva
 *     nada usado», pero seguir devolviéndolo es lo correcto y callarlo no.
 */

let db: FakeDb;
let sb: FakeSupabase;
const avisado = vi.fn();

vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => sb }));
vi.mock("@/lib/notify-service", () => ({
  notify: (...a: unknown[]) => avisado(...a), notifyRoles: vi.fn(),
}));

import {
  loadPlan, loadUsage, planStatusFor, assertWithinLimit, assertModule, addStorageUsage,
} from "@/lib/plan-service";

const ORG = "org-1";
const PLAN = "plan-1";

const ctx = (over: Record<string, unknown> = {}) => ({
  companyId: ORG,
  userId: "usr-1",
  company: {
    _id: ORG, plan: PLAN, timezone: "America/Santo_Domingo",
    modules_enabled: ["bookings", "crm"], subscription_status: "active", ...over,
  },
}) as never;

const callado = async <T>(fn: () => Promise<T>): Promise<T> => {
  const real = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = real; }
};

beforeEach(() => {
  vi.clearAllMocks();
  db = fakeDb();
  sb = fakeSupabase(db);
  db.seed("plan", [{
    _id: PLAN, organization_id: null, code: "pro", name: "Pro",
    max_users: 5, max_bookings_month: 100, max_products: 10, max_storage_mb: 1000,
    trial_days: 14, modules_enabled: ["bookings", "cash"], is_premium: false,
  }]);
  db.seed("organizations", [
    { _id: ORG, organization_id: ORG, name: "Tours del Este", storage_used_mb: 120, tenant_org_id: null },
  ]);
  db.seed("organization_memberships", [
    { _id: "mem-1", organization_id: ORG, user_id: "u1", role: "owner", status: "active" },
    { _id: "mem-2", organization_id: ORG, user_id: "u2", role: "seller", status: "active" },
  ]);
  db.seed("product", [
    { _id: "prod-1", organization_id: ORG, name: "Saona", status: "active" },
    { _id: "prod-2", organization_id: ORG, name: "Vieja", status: "inactive" },
  ]);
});

/* ═════════════════════════════ el plan y el uso ═════════════════════════ */

describe("el plan y lo que lleva usado", () => {
  it("sin plan asignado no hay techo declarado", async () => {
    expect(await loadPlan(null)).toBeNull();
  });

  it("un fallo leyendo el catálogo NO bloquea la operación", async () => {
    // Sin plan conocido no hay techo, que es el lado correcto del error: cobrar
    // de más por una consulta caída sería peor que cobrar de menos.
    sb.breakReads("plan");
    expect(await callado(() => loadPlan(PLAN))).toBeNull();
  });

  it("los usuarios cuentan las activas Y las invitaciones sin aceptar", async () => {
    // La invitación RESERVA la plaza: si no contara, un plan de cinco aceptaría
    // veinte invitaciones y el tope saltaría delante de alguien que ya recibió
    // el correo.
    db.seed("organization_memberships", [
      { _id: "mem-3", organization_id: ORG, user_id: "u3", role: "seller", status: "pending" },
      { _id: "mem-4", organization_id: ORG, user_id: "u4", role: "seller", status: "suspended" },
    ]);
    const uso = await loadUsage(ORG);
    expect(uso.users, "una cuenta desactivada tiene que liberar su plaza").toBe(3);
  });

  it("y los de los TOUR CENTERS también, que cuelgan del socio", async () => {
    /**
     * La membresía de un usuario de portal cuelga de la organización del SOCIO.
     * Contando solo la raíz, una operadora con cinco empleados y cuarenta
     * personas repartidas en sus tour centers figuraba con cinco — o sea un plan
     * que no limita nada.
     */
    db.seed("organizations", [
      { _id: "org-socio", organization_id: "org-socio", name: "Agencia", tenant_org_id: ORG },
    ]);
    db.seed("organization_memberships", [
      { _id: "mem-s1", organization_id: "org-socio", user_id: "s1", role: "seller", status: "active" },
    ]);
    expect((await loadUsage(ORG)).users).toBe(3);
  });

  it("los productos inactivos liberan sitio de verdad", async () => {
    // Es lo que el mensaje del límite promete.
    expect((await loadUsage(ORG)).products).toBe(1);
  });

  it("las reservas se cuentan sin filtrar por estado", async () => {
    // Una reserva cancelada se creó igual: si no contara, cancelar y recrear
    // sería un contador infinito.
    db.seed("booking", [
      { _id: "bk-1", organization_id: ORG, status: "confirmed", created_at: new Date().toISOString() },
      { _id: "bk-2", organization_id: ORG, status: "cancelled", created_at: new Date().toISOString() },
    ]);
    expect((await loadUsage(ORG)).bookingsThisMonth).toBe(2);
  });

  it("EL MES ES EL DE LA EMPRESA, NO EL DEL SERVIDOR", async () => {
    /**
     * `monthStart()` corta en UTC y el proceso corre en UTC. Una reserva de las
     * 21:00 del 31 de agosto en Santo Domingo son las 01:00 UTC del 1 de
     * septiembre: cortando en UTC se le carga al cupo del mes SIGUIENTE, y la
     * operadora que cierra el mes vendiendo de noche empieza septiembre con el
     * contador ya empezado.
     */
    // El reloj se fija: si no, la prueba diría cosas distintas según el día en
    // que se ejecute, que es justo lo que se está probando.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T12:00:00.000Z"));
    try {
      db.seed("booking", [{
        _id: "bk-noche", organization_id: ORG, status: "confirmed",
        // 01:00 UTC del 1 de septiembre = 21:00 del 31 de agosto en Santo Domingo.
        created_at: "2026-09-01T01:00:00.000Z",
      }]);
      const enUtc = await loadUsage(ORG, null);
      const enLaEmpresa = await loadUsage(ORG, "America/Santo_Domingo");
      expect(enUtc.bookingsThisMonth, "en UTC entra en el mes nuevo").toBe(1);
      expect(enLaEmpresa.bookingsThisMonth, "en la zona de la empresa es del mes pasado").toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("y sin zona declarada se corta en UTC, que es lo que hacía antes", async () => {
    db.seed("booking", [
      { _id: "bk-1", organization_id: ORG, status: "confirmed", created_at: new Date().toISOString() },
    ]);
    expect((await loadUsage(ORG)).bookingsThisMonth).toBe(1);
  });

  it("UN RECUENTO QUE NO SE PUDO HACER se sigue dando por cero, pero se dice", async () => {
    /**
     * Cero apaga el techo entero: `limitCheck` compara contra cero y deja pasar
     * todo, el aviso de «te estás acercando» no salta, y la pantalla del plan le
     * enseña al cliente «0 de 5 usuarios» sobre una empresa con cinco. Seguir
     * devolviendo cero es lo correcto —sin dato no se bloquea— pero callarlo no.
     */
    sb.breakReads("organization_memberships");
    const gritos: string[] = [];
    const real = console.error;
    console.error = (...a: unknown[]) => { gritos.push(a.join(" ")); };
    let uso;
    try { uso = await loadUsage(ORG); } finally { console.error = real; }
    expect(uso!.users).toBe(0);
    expect(gritos.join(" ")).toMatch(/no se pudo contar usuarios/);
  });

  it("el estado completo junta plan y uso", async () => {
    const estado = await planStatusFor(ctx());
    expect(estado.plan?.name).toBe("Pro");
    expect(estado.usage.users).toBe(2);
  });
});

/* ══════════════════════════════ las guardas ═════════════════════════════ */

describe("¿cabe uno más?", () => {
  it("con sitio, pasa sin ruido", async () => {
    await expect(assertWithinLimit(ctx(), "max_users")).resolves.toBeUndefined();
    expect(avisado).not.toHaveBeenCalled();
  });

  it("lleno, lanza 402 y no 403", async () => {
    // No es que al usuario le falten permisos —los tiene—: es que el plan de la
    // empresa se llenó. Son dos conversaciones con personas distintas.
    for (let i = 3; i <= 5; i++) {
      db.seed("organization_memberships", [
        { _id: `mem-${i}`, organization_id: ORG, user_id: `u${i}`, role: "seller", status: "active" },
      ]);
    }
    await expect(assertWithinLimit(ctx(), "max_users")).rejects.toMatchObject({
      status: 402, code: "PLAN_LIMIT",
    });
  });

  it("avisa ANTES de chocar, una vez al mes por métrica", async () => {
    // El banner de la pantalla solo lo ve quien entra a mirarla, y el límite que
    // rechaza una venta sin previo aviso es un error de sistema delante del
    // cliente.
    for (let i = 3; i <= 4; i++) {
      db.seed("organization_memberships", [
        { _id: `mem-${i}`, organization_id: ORG, user_id: `u${i}`, role: "seller", status: "active" },
      ]);
    }
    await assertWithinLimit(ctx(), "max_users");
    expect(avisado).toHaveBeenCalledTimes(1);
    const aviso = avisado.mock.calls[0][0] as { event: string; dedupeSeed: string };
    expect(aviso.event).toBe("plan_limit_near");
    expect(aviso.dedupeSeed, "la semilla lleva el mes").toMatch(/^max_users:\d{4}-\d{2}$/);
  });

  it("sin techo declarado ni se cuenta", async () => {
    await db.tenantUpdate("", "plan", PLAN, { max_products: null });
    sb.breakReads("product", "no debería llegar a consultarse");
    await expect(assertWithinLimit(ctx(), "max_products")).resolves.toBeUndefined();
  });

  it("sin plan asignado tampoco hay techo", async () => {
    await expect(assertWithinLimit(ctx({ plan: null }), "max_users")).resolves.toBeUndefined();
  });

  it("Y LA GUARDA CUENTA EL MES DE LA EMPRESA, no el del servidor", async () => {
    /**
     * De poco sirve que `loadUsage` sepa cortar el mes si quien decide no le
     * pasa la zona. Con el cupo en una reserva y una venta de la última noche
     * de agosto: en UTC es de septiembre y el cupo estaría gastado —la venta
     * siguiente se rechaza—; en Santo Domingo es de agosto y septiembre empieza
     * con el cupo entero.
     */
    await db.tenantUpdate("", "plan", PLAN, { max_bookings_month: 1 });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T12:00:00.000Z"));
    try {
      db.seed("booking", [{
        _id: "bk-noche", organization_id: ORG, status: "confirmed",
        created_at: "2026-09-01T01:00:00.000Z",
      }]);
      await expect(
        assertWithinLimit(ctx(), "max_bookings_month")
      ).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ══════════════════════════════ los módulos ═════════════════════════════ */

describe("¿está el módulo contratado?", () => {
  it("el contratado pasa", () => {
    expect(() => assertModule(ctx(), "bookings")).not.toThrow();
  });

  it("y el que no, es 402 con su código", () => {
    // El menú es cortesía; la puerta es esto: una petición a mano —o una
    // pestaña abierta antes del cambio de plan— entraba igual.
    try {
      assertModule(ctx(), "transport");
      throw new Error("no lanzó");
    } catch (err) {
      expect((err as { status: number; code: string }).status).toBe(402);
      expect((err as { code: string }).code).toBe("PLAN_MODULE");
    }
  });
});

/* ════════════════════════════ el almacenamiento ═════════════════════════ */

describe("el medidor de almacenamiento", () => {
  it("suma lo subido al acumulado", async () => {
    await addStorageUsage(ORG, 5 * 1024 * 1024);
    expect(Number(db.row("organizations", { _id: ORG })!.storage_used_mb)).toBe(125);
  });

  it("cero bytes no escribe nada", async () => {
    await addStorageUsage(ORG, 0);
    expect(Number(db.row("organizations", { _id: ORG })!.storage_used_mb)).toBe(120);
  });

  it("NO PODER LEER EL ACUMULADO no es que sea cero", async () => {
    /**
     * Descartando el error, `current` salía 0 y se escribía `0 + mb`: una
     * empresa con 120 MB medidos quedaba en 1 por UNA lectura fallida. Eso no es
     * cobrar de menos —que es el lado del error que este módulo elige—, es
     * borrar el medidor, y a partir de ahí el techo no vuelve a saltar.
     */
    sb.breakReads("organizations");
    await callado(() => addStorageUsage(ORG, 1024 * 1024));
    sb.healReads("organizations");
    expect(
      Number(db.row("organizations", { _id: ORG })!.storage_used_mb),
      "el medidor se borró"
    ).toBe(120);
  });

  it("y un fallo NO tumba una subida que ya se hizo", async () => {
    // El archivo existe: cobrar de menos por un contador atrasado es preferible
    // a perder el archivo del cliente.
    sb.breakWrites("organizations");
    await expect(callado(() => addStorageUsage(ORG, 1024 * 1024))).resolves.toBeUndefined();
  });
});
