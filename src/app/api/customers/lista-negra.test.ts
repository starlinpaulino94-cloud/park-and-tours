import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AppRole } from "@/lib/auth";

/**
 * LA PUERTA DEL BLOQUEO, PROBADA CONTRA LA RUTA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO BASTA CON `lista-negra.ts`
 *
 * Aquellas pruebas comprueban que la REGLA es correcta. Estas comprueban que la
 * ruta la aplica, que es otra cosa: el motivo puede estar perfectamente exigido
 * en el módulo puro y la ruta no llamarlo. Y sobre todo comprueban lo que solo
 * pasa aquí — qué se ESCRIBE en la ficha al bloquear y al levantar, que es lo
 * que el siguiente que la abra va a leer.
 *
 * Se falsea solo el suelo: la autorización por rango, la validación del motivo
 * y lo que se guarda corren de verdad.
 */

const requireTenantWrite = vi.fn();
let ficha: Record<string, unknown> = {};
/** Lo que la ruta acabó escribiendo en la ficha. */
let escrito: Record<string, unknown> | null = null;
const auditado = vi.fn();

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    requireTenantWrite: (...a: unknown[]) => requireTenantWrite(...a),
    tenantFindOne: async () => ficha,
    tenantUpdate: async (_c: string, _t: string, _id: string, payload: Record<string, unknown>) => {
      escrito = payload;
      return { ...ficha, ...payload };
    },
  };
});
vi.mock("@/lib/rate-limit", () => ({ assertRateLimit: vi.fn(), rateLimitKey: () => "k" }));
vi.mock("@/lib/csrf", () => ({ assertSameOriginMutation: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAudit: (...a: unknown[]) => auditado(...a) }));

const { PUT } = await import("./[id]/lista-negra/route");

const ctx = (role: AppRole) => ({
  companyId: "org-1", userId: "usr-1", role, branchId: null, sellerId: null, partnerId: null,
  company: { _id: "org-1" },
});

const pedir = (body: Record<string, unknown>) =>
  PUT(
    { json: async () => body, headers: new Headers(), url: "http://x/api/customers/cli-1/lista-negra" } as unknown as NextRequest,
    { params: Promise.resolve({ id: "cli-1" }) }
  );

beforeEach(() => {
  vi.clearAllMocks();
  escrito = null;
  ficha = { _id: "cli-1", first_name: "Pedro", last_name: "Mora", status: "active" };
  requireTenantWrite.mockResolvedValue(ctx("manager"));
});

describe("bloquear a un cliente", () => {
  it("escribe el estado, el motivo, cuándo y quién", async () => {
    const res = await pedir({ blocked: true, reason: "Tres no-shows sin avisar en agosto" });
    expect(res.status).toBe(200);
    expect(escrito).toMatchObject({
      status: "blacklist",
      blocked_reason: "Tres no-shows sin avisar en agosto",
      blocked_by: "usr-1",
    });
    expect(escrito?.blocked_at).toBeTruthy();
  });

  it("sin motivo NO escribe nada", async () => {
    // Sin el motivo, quien lo encuentre bloqueado dentro de seis meses no puede
    // decidir con el cliente delante.
    const res = await pedir({ blocked: true, reason: "corto" });
    expect(res.status).toBe(400);
    expect(escrito, "se bloqueó sin motivo").toBeNull();
  });

  it("y quien vende NO puede bloquear", async () => {
    /**
     * El rango de vender lo tiene también el vendedor de un tour center (5.1):
     * sin esto, el empleado de una agencia podía vetarle un cliente a la empresa
     * que le da el producto.
     */
    requireTenantWrite.mockResolvedValue(ctx("seller"));
    const res = await pedir({ blocked: true, reason: "Tres no-shows sin avisar" });
    expect(res.status).toBe(403);
    expect(escrito).toBeNull();
  });

  it("bloquear al que ya está bloqueado se dice, no se contesta que sí", async () => {
    // Contestar «hecho» sobre algo que no se hizo deja a quien lo pidió
    // creyendo otra cosa —y sobrescribiría el motivo original—.
    ficha = { ...ficha, status: "blacklist", blocked_reason: "El motivo de antes" };
    const res = await pedir({ blocked: true, reason: "Otro motivo cualquiera" });
    expect(res.status).toBe(409);
    expect(escrito, "se pisó el motivo original").toBeNull();
  });

  it("queda en la bitácora como aviso, con el motivo", async () => {
    await pedir({ blocked: true, reason: "Tres no-shows sin avisar en agosto" });
    const linea = auditado.mock.calls[0][0] as { action: string; severity: string; description: string };
    expect(linea.action).toBe("customer_blacklisted");
    expect(linea.severity, "bloquear a un cliente no es rutina").toBe("warning");
    expect(linea.description).toMatch(/Pedro Mora/);
    expect(linea.description).toMatch(/no-shows/);
  });
});

describe("levantar el bloqueo", () => {
  beforeEach(() => {
    ficha = { ...ficha, status: "blacklist", blocked_reason: "Tres no-shows sin avisar" };
  });

  it("EL MOTIVO SE BORRA con el bloqueo", async () => {
    /**
     * Dejarlo dejaría una ficha activa con un texto que dice por qué está
     * bloqueada: el siguiente que la abra se queda sin saber si lo está o no.
     * Lo que queda del episodio es la bitácora.
     */
    const res = await pedir({ blocked: false, reason: "Vino a explicarlo y se acordó seguir" });
    expect(res.status).toBe(200);
    expect(escrito).toMatchObject({
      status: "active", blocked_reason: null, blocked_at: null, blocked_by: null,
    });
  });

  it("y no hace falta motivo para levantarlo", async () => {
    // Exigirlo convertiría en trabajo lo que arregla un error: el bloqueo mal
    // puesto tiene que poder quitarse en un clic.
    const res = await pedir({ blocked: false });
    expect(res.status).toBe(200);
    expect(escrito).toMatchObject({ status: "active", blocked_reason: null });
  });

  it("levantar lo que no está bloqueado se dice", async () => {
    ficha = { ...ficha, status: "active", blocked_reason: null };
    const res = await pedir({ blocked: false });
    expect(res.status).toBe(409);
    expect(escrito).toBeNull();
  });

  it("y queda en la bitácora con su propia acción", async () => {
    await pedir({ blocked: false, reason: "Vino a explicarlo" });
    const linea = auditado.mock.calls[0][0] as { action: string; metadata: Record<string, unknown> };
    expect(linea.action).toBe("customer_unblacklisted");
    expect(linea.metadata.previous, "se pierde el motivo que tenía").toBe("Tres no-shows sin avisar");
  });
});
