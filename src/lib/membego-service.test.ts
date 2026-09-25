import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";
import { fakeSupabase, type FakeSupabase } from "@/test/fake-supabase";
import type { MembegoSsoPayload, MembegoEvent } from "@/lib/membego";

/**
 * EL SATÉLITE CONTRA LA BASE, QUE NO TENÍA NINGUNA PRUEBA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DÓNDE SE PUEDE EQUIVOCAR ESTE SERVICIO
 *
 * Aquí no hay sesión: el SSO llega ANTES de que exista una —abrirla es su
 * trabajo— y el webhook lo firma una máquina. Todo escribe con el rol de
 * servicio, así que lo que delimita es el código y nada más.
 *
 * Tres cosas que no se ven en el módulo puro:
 *
 *   · qué cuenta local acaba unida a qué cliente de MembeGo —y con qué se
 *     cruzan, que es donde un correo corriente se convierte en un comodín—;
 *   · si un reintento del webhook repite el efecto o lo reconoce;
 *   · y qué autoriza a crear el vínculo, que es la llave de toda la
 *     integración.
 */

let db: FakeDb;
let sb: FakeSupabase;

/** Las cuentas de `auth`, que el doble de PostgREST no cubre. */
let cuentas: { id: string; email: string }[];
const cuentaCreada = vi.fn();

vi.mock("@/lib/supabase/service", () => ({
  supabaseService: () => ({
    from: (tabla: string) => sb.from(tabla),
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: cuentas }, error: null }),
        getUserById: async (id: string) => ({
          data: { user: cuentas.find((u) => u.id === id) ?? null }, error: null,
        }),
        createUser: async (input: { email: string }) => {
          cuentaCreada(input);
          const nueva = { id: `auth-${cuentas.length + 1}`, email: input.email };
          cuentas.push(nueva);
          return { data: { user: nueva }, error: null };
        },
      },
    },
  }),
}));
vi.mock("next/headers", () => ({ headers: async () => new Map() }));

import {
  linkByCompany, linkByOrganization, resolveLink, consumeJti, provisionSsoUser,
  applyMembegoEvent, setLinkStatus, unlinkOrganization, membegoStatus, auditMembego,
  type MembegoLink,
} from "@/lib/membego-service";

const ORG = "org-1";
const EMPRESA_MB = "emp-mb";

const sso = (over: Partial<MembegoSsoPayload> = {}): MembegoSsoPayload => ({
  sub: "sub-1", companyId: EMPRESA_MB, rol: "ADMINISTRADOR",
  email: "duena@tours.do", nombre: "Ana Dueña", jti: "jti-1",
  exp: Math.floor(Date.now() / 1000) + 300, iat: Math.floor(Date.now() / 1000),
  ...over,
} as MembegoSsoPayload);

const evento = (over: Partial<MembegoEvent> = {}): MembegoEvent => ({
  id: "evt-1", tipo: "cliente.visita", companyId: EMPRESA_MB,
  payload: { clienteId: "cli-mb-1", cliente: { nombre: "Juan Pérez", email: "juan@example.com", telefono: null } },
  emitidoEn: new Date().toISOString(),
  ...over,
});

const vinculo = (): MembegoLink => ({
  id: "lnk-1", organization_id: ORG, membego_company_id: EMPRESA_MB,
  status: "active", linked_at: new Date().toISOString(),
  last_event_at: null, events_received: 0,
});

const callado = async <T>(fn: () => Promise<T>): Promise<T> => {
  const real = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = real; }
};

beforeEach(() => {
  vi.clearAllMocks();
  db = fakeDb();
  sb = fakeSupabase(db);
  cuentas = [{ id: "auth-1", email: "duena@tours.do" }];
  db.seed("organizations", [{ _id: ORG, organization_id: ORG, name: "Tours del Este" }]);
  db.seed("organization_memberships", [
    { _id: "mem-1", organization_id: ORG, user_id: "auth-1", role: "owner", status: "active" },
  ]);
});

const conVinculo = () => {
  db.seed("membego_link", [{
    _id: "lnk-1", organization_id: ORG, membego_company_id: EMPRESA_MB,
    status: "active", linked_at: new Date().toISOString(), events_received: 0,
  }]);
};

/* ═══════════════════════════════ el vínculo ═════════════════════════════ */

describe("el vínculo entre las dos empresas", () => {
  it("se lee por los dos lados", async () => {
    conVinculo();
    expect((await linkByCompany(EMPRESA_MB))?.organization_id).toBe(ORG);
    expect((await linkByOrganization(ORG))?.membego_company_id).toBe(EMPRESA_MB);
  });

  it("no poder leerlo NO es que no exista", async () => {
    // En una integración, el peor fallo posible es el silencio: sin vínculo el
    // webhook contestaría que no hay nada que hacer y MembeGo dejaría de
    // reintentar.
    conVinculo();
    sb.breakReads("membego_link");
    await expect(linkByCompany(EMPRESA_MB)).rejects.toThrow();
    await expect(linkByOrganization(ORG)).rejects.toThrow();
  });

  it("lo crea el primer SSO de un administrador con UNA sola organización", async () => {
    const out = await resolveLink(sso());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.created).toBe(true);
    expect(out.link.organization_id).toBe(ORG);
    const bitacora = db.rows("audit_log");
    expect(bitacora.map((b) => b.action)).toContain("membego_linked");
    expect(bitacora[0].severity, "vincular una empresa no es un evento rutinario").toBe("warning");
  });

  it("un rol que no administra no vincula nada", async () => {
    const out = await resolveLink(sso({ rol: "CAJERO" }));
    expect(out).toEqual({ ok: false, reason: "sin_vinculo" });
    expect(db.rows("membego_link")).toHaveLength(0);
  });

  it("con dos organizaciones no se adivina", async () => {
    // Elegir por él una empresa que ve dinero sería peor que pedirle que lo
    // haga a mano.
    db.seed("organizations", [{ _id: "org-2", organization_id: "org-2", name: "Otra" }]);
    db.seed("organization_memberships", [
      { _id: "mem-2", organization_id: "org-2", user_id: "auth-1", role: "admin", status: "active" },
    ]);
    expect(await resolveLink(sso())).toEqual({ ok: false, reason: "ambiguo" });
  });

  it("y con ninguna, tampoco", async () => {
    await db.tenantUpdate(ORG, "organization_memberships", "mem-1", { status: "suspended" });
    expect(await resolveLink(sso())).toEqual({ ok: false, reason: "sin_organizacion" });
  });

  it("una membresía que no es de administración no sirve para vincular", async () => {
    await db.tenantUpdate(ORG, "organization_memberships", "mem-1", { role: "cashier" });
    expect(await resolveLink(sso())).toEqual({ ok: false, reason: "sin_organizacion" });
  });

  it("una organización ya vinculada a OTRA empresa no se pisa en silencio", async () => {
    db.seed("membego_link", [{
      _id: "lnk-otro", organization_id: ORG, membego_company_id: "emp-vieja",
      status: "active", linked_at: new Date().toISOString(), events_received: 0,
    }]);
    expect(await resolveLink(sso())).toEqual({ ok: false, reason: "ambiguo" });
  });

  it("un vínculo suspendido cierra la puerta también al SSO", async () => {
    conVinculo();
    await db.tenantUpdate(ORG, "membego_link", "lnk-1", { status: "suspended" });
    expect(await resolveLink(sso())).toEqual({ ok: false, reason: "suspendido" });
  });

  it("y el que ya existe se reutiliza sin volver a crearlo", async () => {
    conVinculo();
    const out = await resolveLink(sso());
    expect(out.ok && out.created).toBe(false);
    expect(db.rows("membego_link")).toHaveLength(1);
  });

  it("pausar cierra la puerta sin perder lo sincronizado", async () => {
    conVinculo();
    const out = await setLinkStatus(ORG, "suspended");
    expect(out.status).toBe("suspended");
  });

  it("y desvincular no borra los espejos: son historial de la organización", async () => {
    conVinculo();
    db.seed("membego_customer", [{ _id: "mc-1", organization_id: ORG, membego_cliente_id: "cli-mb-1" }]);
    await unlinkOrganization(ORG);
    expect(db.rows("membego_link")).toHaveLength(0);
    expect(db.rows("membego_customer"), "se borró el historial").toHaveLength(1);
  });

  it("desvincular lo que no está vinculado es 404", async () => {
    await expect(unlinkOrganization(ORG)).rejects.toMatchObject({ status: 404 });
  });
});

/* ══════════════════════════ el token de un solo uso ═════════════════════ */

describe("el token SSO se canjea una vez", () => {
  it("el primero entra", async () => {
    expect(await consumeJti("jti-1", Math.floor(Date.now() / 1000) + 300)).toBe(true);
  });

  it("y el segundo choca contra la clave, sin ventana entre comprobar y marcar", async () => {
    // La clave primaria es el propio jti: el primer insert entra y el segundo
    // choca. Comprobar-y-después-marcar dejaría una rendija por la que el mismo
    // token abre dos sesiones.
    sb.breakWithDuplicate("membego_sso_jti");
    expect(await consumeJti("jti-1", Math.floor(Date.now() / 1000) + 300)).toBe(false);
  });

  it("un fallo que NO es duplicado sí lanza", async () => {
    sb.breakWrites("membego_sso_jti", "se cayó la base");
    await expect(consumeJti("jti-2", Math.floor(Date.now() / 1000) + 300)).rejects.toThrow();
  });
});

/* ═══════════════════════════ la cuenta del usuario ══════════════════════ */

describe("la cuenta local del usuario del token", () => {
  it("se mapea por `sub`: cambiar de correo no crea una segunda cuenta", async () => {
    db.seed("membego_user", [{
      _id: "mu-1", organization_id: ORG, membego_sub: "sub-1", user_id: "auth-1", role_managed: true,
    }]);
    const out = await provisionSsoUser(vinculo(), sso({ email: "nuevo@tours.do" }));
    expect(out.userId).toBe("auth-1");
    expect(out.created).toBe(false);
    expect(cuentaCreada).not.toHaveBeenCalled();
  });

  it("si el correo ya existe en auth, se reutiliza esa cuenta", async () => {
    const out = await provisionSsoUser(vinculo(), sso());
    expect(out.userId).toBe("auth-1");
    expect(cuentaCreada).not.toHaveBeenCalled();
  });

  it("y si no existe, se crea con su membresía", async () => {
    const out = await provisionSsoUser(vinculo(), sso({ sub: "sub-9", email: "nuevo@tours.do" }));
    expect(out.created).toBe(true);
    const membresias = db.rows("organization_memberships").filter((m) => m.user_id === out.userId);
    expect(membresias).toHaveLength(1);
    expect(membresias[0].role).toBe("admin");
  });

  it("una cuenta desactivada NO la revive el SSO", async () => {
    // Suspender tiene que cerrar la puerta de verdad, venga por donde venga el
    // intento de entrar.
    await db.tenantUpdate(ORG, "organization_memberships", "mem-1", { status: "suspended" });
    await expect(provisionSsoUser(vinculo(), sso())).rejects.toMatchObject({ status: 403 });
  });

  it("el rol lo gobierna el SSO solo en las membresías que el SSO creó", async () => {
    db.seed("membego_user", [{
      _id: "mu-1", organization_id: ORG, membego_sub: "sub-1", user_id: "auth-1", role_managed: false,
    }]);
    await db.tenantUpdate(ORG, "organization_memberships", "mem-1", { role: "cashier" });
    await provisionSsoUser(vinculo(), sso({ rol: "ADMINISTRADOR" }));
    expect(
      db.row("organization_memberships", { _id: "mem-1" })!.role,
      "el SSO pisó un rol puesto a mano"
    ).toBe("cashier");
  });

  it("y sí lo actualiza cuando la membresía es suya", async () => {
    db.seed("membego_user", [{
      _id: "mu-1", organization_id: ORG, membego_sub: "sub-1", user_id: "auth-1", role_managed: true,
    }]);
    await db.tenantUpdate(ORG, "organization_memberships", "mem-1", { role: "cashier" });
    await provisionSsoUser(vinculo(), sso({ rol: "GERENTE" }));
    expect(db.row("organization_memberships", { _id: "mem-1" })!.role).toBe("manager");
    expect(db.rows("audit_log").map((b) => b.action)).toContain("membego_role_updated");
  });

  it("sin correo y sin mapa previo no se puede abrir nada", async () => {
    await expect(
      provisionSsoUser(vinculo(), sso({ sub: "sub-nuevo", email: "" }))
    ).rejects.toMatchObject({ status: 400 });
  });
});

/* ════════════════════════════════ los eventos ═══════════════════════════ */

describe("los eventos del webhook", () => {
  it("un tipo conocido se procesa y deja su efecto", async () => {
    const out = await applyMembegoEvent(vinculo(), evento());
    expect(out.status).toBe("processed");
    const espejo = db.rows("membego_customer");
    expect(espejo).toHaveLength(1);
    expect(espejo[0].visits).toBe(1);
  });

  it("un tipo desconocido se registra y se ignora, sin efecto", async () => {
    const out = await applyMembegoEvent(vinculo(), evento({ id: "evt-x", tipo: "cliente.cumpleanos" }));
    expect(out.status).toBe("ignored");
    expect(db.rows("membego_customer")).toHaveLength(0);
    expect(db.rows("membego_event")[0].status).toBe("ignored");
  });

  it("UN REINTENTO NO REPITE EL EFECTO", async () => {
    // La fila del sobre se inserta ANTES de tocar nada, así que el reintento
    // choca ahí y responde 200 sin volver a sumar la visita.
    sb.breakWithDuplicate("membego_event");
    const out = await applyMembegoEvent(vinculo(), evento());
    expect(out.status).toBe("duplicate");
    expect(db.rows("membego_customer")).toHaveLength(0);
  });

  it("si el efecto falla, el sobre queda marcado para repararlo", async () => {
    sb.breakReads("membego_customer", "se cayó la base");
    await expect(applyMembegoEvent(vinculo(), evento())).rejects.toThrow();
    const sobre = db.rows("membego_event")[0];
    expect(sobre.status).toBe("failed");
    expect(String(sobre.error)).toMatch(/se cayó la base/);
    expect(sobre.payload, "el payload íntegro es lo único con lo que se repara").toBeTruthy();
  });

  it("una compra suma compras y una visita suma visitas", async () => {
    await applyMembegoEvent(vinculo(), evento({ id: "e1", tipo: "cliente.visita" }));
    await applyMembegoEvent(vinculo(), evento({ id: "e2", tipo: "cliente.compro_servicio" }));
    const espejo = db.rows("membego_customer")[0];
    expect(espejo.visits).toBe(1);
    expect(espejo.purchases).toBe(1);
  });

  it("la membresía del evento se guarda en el espejo", async () => {
    await applyMembegoEvent(vinculo(), evento({
      id: "e3", tipo: "membresia.activada",
      payload: {
        clienteId: "cli-mb-1",
        cliente: { nombre: "Juan Pérez", email: "juan@example.com" },
        membresia: { id: "m-1", planId: "p-1", plan: "Oro", esDePago: true, vigenteHasta: "2027-01-01" },
      },
    }));
    const espejo = db.rows("membego_customer")[0];
    expect(espejo.plan_name).toBe("Oro");
    expect(espejo.membership_paid).toBe(true);
  });

  it("un evento sin cliente no escribe espejo, y no es un error", async () => {
    const out = await applyMembegoEvent(vinculo(), evento({ id: "e4", payload: {} }));
    expect(out.status).toBe("processed");
    expect(db.rows("membego_customer")).toHaveLength(0);
  });
});

/* ══════════════════ con qué ficha local se cruza el cliente ═════════════ */

describe("a qué ficha local se ata el cliente de MembeGo", () => {
  const conFichas = (filas: Record<string, unknown>[]) => db.seed("customer", filas);

  it("se reutiliza la ficha que ya existe por correo", async () => {
    conFichas([{ _id: "cli-1", organization_id: ORG, email: "juan@example.com", first_name: "Juan" }]);
    await applyMembegoEvent(vinculo(), evento());
    expect(db.rows("customer"), "se duplicó al cliente que ya compraba aquí").toHaveLength(1);
    expect(db.rows("membego_customer")[0].customer_id).toBe("cli-1");
  });

  it("y se compara sin mayúsculas: el mismo correo llega escrito de dos maneras", async () => {
    conFichas([{ _id: "cli-1", organization_id: ORG, email: "Juan@Example.com" }]);
    await applyMembegoEvent(vinculo(), evento());
    expect(db.rows("customer")).toHaveLength(1);
  });

  it("UN GUION BAJO EN EL CORREO NO ES UN COMODÍN", async () => {
    /**
     * Se compara con `ilike`, que es un PATRÓN: en SQL `_` casa con cualquier
     * carácter. Y los correos con guion bajo son de todos los días, así que
     * `juan_perez@example.com` casaba también con `juanXperez@example.com` — y
     * el espejo de MembeGo acababa atado a la ficha de OTRA persona, con sus
     * visitas, sus compras y su membresía apuntadas a un tercero.
     */
    conFichas([{ _id: "cli-otro", organization_id: ORG, email: "juanXperez@example.com" }]);
    await applyMembegoEvent(vinculo(), evento({
      payload: { clienteId: "cli-mb-1", cliente: { nombre: "Juan Pérez", email: "juan_perez@example.com" } },
    }));
    const atada = db.rows("membego_customer")[0].customer_id;
    expect(atada, "se ató al cliente equivocado").not.toBe("cli-otro");
    expect(db.rows("customer")).toHaveLength(2);
  });

  it("y un `%` no casa con cualquier cliente de la empresa", async () => {
    conFichas([{ _id: "cli-a", organization_id: ORG, email: "ana@example.com" }]);
    await applyMembegoEvent(vinculo(), evento({
      payload: { clienteId: "cli-mb-1", cliente: { nombre: "Quien Sea", email: "%" } },
    }));
    expect(db.rows("membego_customer")[0].customer_id).not.toBe("cli-a");
  });

  it("con un `*` ni se busca por correo: PostgREST lo convierte en comodín", async () => {
    conFichas([{ _id: "cli-a", organization_id: ORG, email: "ana@example.com" }]);
    await applyMembegoEvent(vinculo(), evento({
      payload: { clienteId: "cli-mb-1", cliente: { nombre: "Quien Sea", email: "*@example.com" } },
    }));
    expect(db.rows("membego_customer")[0].customer_id).not.toBe("cli-a");
  });

  it("NO PODER BUSCAR no es que el cliente no exista", async () => {
    /**
     * Descartando el error se caía de largo hasta el `insert`, y la ficha
     * duplicada es lo que este módulo dice expresamente que no hace. Lanzar deja
     * el evento marcado como fallido con su payload íntegro, que es reparable;
     * la ficha doble no se repara sola.
     */
    sb.breakReads("customer", "se cayó la base");
    await expect(applyMembegoEvent(vinculo(), evento())).rejects.toThrow(/buscar la ficha/);
    expect(db.rows("membego_event")[0].status).toBe("failed");
  });

  it("y no poder buscar POR TELÉFONO tampoco crea una ficha nueva", async () => {
    // Su propio camino: sin correo en el payload, el cruce por teléfono es el
    // único que queda, y su error tiene que parar el evento igual que el otro.
    sb.breakReads("customer", "se cayó la base");
    await expect(applyMembegoEvent(vinculo(), evento({
      payload: { clienteId: "cli-mb-1", cliente: { nombre: "Sin Correo", telefono: "809-555-0142" } },
    }))).rejects.toThrow(/por teléfono/);
    expect(db.rows("customer")).toHaveLength(0);
  });

  it("el teléfono se cruza por dígitos, no por cómo esté escrito", async () => {
    conFichas([{ _id: "cli-tel", organization_id: ORG, phone: "+1 (809) 555-0142", email: null }]);
    await applyMembegoEvent(vinculo(), evento({
      payload: { clienteId: "cli-mb-1", cliente: { nombre: "Sin Correo", telefono: "809-555-0142" } },
    }));
    expect(db.rows("customer")).toHaveLength(1);
    expect(db.rows("membego_customer")[0].customer_id).toBe("cli-tel");
  });

  it("y si no hay ninguna, se crea con origen membego", async () => {
    await applyMembegoEvent(vinculo(), evento());
    const ficha = db.rows("customer")[0];
    expect(ficha.source).toBe("membego");
    expect(ficha.first_name).toBe("Juan");
    expect(ficha.last_name).toBe("Pérez");
  });

  it("el espejo que ya conoce a este cliente no vuelve a buscar ficha", async () => {
    conFichas([{ _id: "cli-1", organization_id: ORG, email: "otro@example.com" }]);
    db.seed("membego_customer", [{
      _id: "mc-1", organization_id: ORG, membego_cliente_id: "cli-mb-1",
      customer_id: "cli-1", visits: 3, purchases: 1,
    }]);
    await applyMembegoEvent(vinculo(), evento());
    expect(db.rows("customer")).toHaveLength(1);
    expect(db.rows("membego_customer")[0].visits, "el contador no siguió desde 3").toBe(4);
  });
});

/* ══════════════════════════════ el panel ════════════════════════════════ */

describe("el panel de la conexión", () => {
  it("sin vínculo no inventa números", async () => {
    const estado = await membegoStatus(ORG);
    expect(estado.link).toBeNull();
    expect(estado.members).toBe(0);
    expect(estado.customers).toBe(0);
  });

  it("con vínculo cuenta lo sincronizado y los eventos fallidos", async () => {
    conVinculo();
    db.seed("membego_user", [{ _id: "mu-1", organization_id: ORG, membego_sub: "s1", user_id: "auth-1" }]);
    db.seed("membego_customer", [{ _id: "mc-1", organization_id: ORG, membego_cliente_id: "c1" }]);
    db.seed("membego_event", [
      { _id: "e1", organization_id: ORG, event_id: "e1", tipo: "cliente.visita", status: "processed", received_at: "2026-09-01" },
      { _id: "e2", organization_id: ORG, event_id: "e2", tipo: "cliente.visita", status: "failed", received_at: "2026-09-02" },
    ]);
    const estado = await membegoStatus(ORG);
    expect(estado.members).toBe(1);
    expect(estado.customers).toBe(1);
    expect(estado.failed).toBe(1);
    expect(estado.recent).toHaveLength(2);
  });

  it("la bitácora sin sesión no tumba la operación que describe", async () => {
    sb.breakWrites("audit_log");
    await callado(() => auditMembego(ORG, "membego_linked", "algo pasó"));
    expect(db.rows("audit_log")).toHaveLength(0);
  });
});
