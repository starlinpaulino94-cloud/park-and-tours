import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { TenantContext } from "@/lib/tenant";
import type { AppRole } from "@/lib/auth";

/**
 * LA ESCALADA DE PRIVILEGIOS QUE HABÍA.
 *
 * Dar de alta a alguien exigía rol de administrador y aceptaba CUALQUIER rol,
 * incluido `owner`, con una contraseña que elegía el propio administrador. Es
 * decir: cualquier administrador podía fabricarse una cuenta de propietario y
 * entrar con ella. Que no pudiera cambiarse su propio rol —lo único que se
 * comprobaba— daba la impresión de que el asunto estaba cubierto.
 *
 * Estas pruebas van contra la RUTA y no contra la función pura: lo que protege
 * el sistema no es que la regla exista, es que la ruta la llame.
 */

const requireTenant = vi.fn();
const requireTenantWrite = vi.fn();
const writeAudit = vi.fn();
const inviteUserByEmail = vi.fn();
const createUser = vi.fn();
const listUsers = vi.fn();
const membershipInsert = vi.fn();
const membershipUpdate = vi.fn();
/** La membresía que la ruta encuentra al buscar al usuario que se edita. */
let membershipRow: Record<string, unknown> | null = null;

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    requireTenant: (...a: unknown[]) => requireTenant(...a),
    requireTenantWrite: (...a: unknown[]) => requireTenantWrite(...a),
  };
});
vi.mock("@/lib/audit", () => ({ writeAudit: (...a: unknown[]) => writeAudit(...a) }));
vi.mock("@/lib/csrf", () => ({ assertSameOriginMutation: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ assertRateLimit: vi.fn(), rateLimitKey: () => "k" }));
vi.mock("@/lib/plan-service", () => ({ assertWithinLimit: vi.fn(), assertModule: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({
  supabaseService: () => ({
    auth: {
      admin: {
        inviteUserByEmail: (...a: unknown[]) => inviteUserByEmail(...a),
        createUser: (...a: unknown[]) => createUser(...a),
        listUsers: (...a: unknown[]) => listUsers(...a),
        getUserById: async () => ({ data: { user: null } }),
        updateUserById: async () => ({ error: null }),
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: membershipRow, error: null }) }),
          maybeSingle: async () => ({ data: membershipRow, error: null }),
        }),
      }),
      insert: (row: unknown) => membershipInsert(row),
      update: (row: unknown) => ({ eq: () => ({ eq: () => membershipUpdate(row) }) }),
    }),
  }),
}));

import { POST as create, PUT as update } from "./route";
import { POST as invite } from "./invite/route";

const ctxOf = (role: AppRole): TenantContext & { companyId: string } => ({
  userId: "user-1", email: "admin@x.com", name: "Admin", role,
  companyId: "org-1", partnerId: null, company: null,
});

const reqWith = (body: unknown) => ({
  json: async () => body,
  nextUrl: { origin: "https://parkandtours.membego.com", searchParams: new URLSearchParams() },
  headers: new Headers(),
}) as unknown as NextRequest;

const bodyOf = async (res: Response) => ({ status: res.status, body: await res.json() });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  listUsers.mockResolvedValue({ data: { users: [] }, error: null });
  createUser.mockResolvedValue({ data: { user: { id: "nuevo" } }, error: null });
  inviteUserByEmail.mockResolvedValue({ data: { user: { id: "invitado" } }, error: null });
  membershipInsert.mockResolvedValue({ error: null });
  membershipUpdate.mockResolvedValue({ error: null });
  membershipRow = null;
});

describe("crear un usuario", () => {
  it("un administrador NO puede fabricar una cuenta de propietario", async () => {
    requireTenantWrite.mockResolvedValue(ctxOf("admin"));
    const { status, body } = await bodyOf(await create(reqWith({
      name: "Yo mismo", email: "otro@x.com", password: "unaclavelarga", role: "owner",
    })));

    expect(status).toBe(403);
    expect(body.error.message).toMatch(/por encima/i);
    // Y no llegó a tocar Supabase: la cuenta no existe ni a medias.
    expect(createUser).not.toHaveBeenCalled();
    expect(membershipInsert).not.toHaveBeenCalled();
  });

  it("sí puede crear los roles que están a su alcance", async () => {
    requireTenantWrite.mockResolvedValue(ctxOf("admin"));
    const { status } = await bodyOf(await create(reqWith({
      name: "Gerente", email: "g@x.com", password: "unaclavelarga", role: "manager",
    })));
    expect(status).toBe(200);
    expect(createUser).toHaveBeenCalled();
  });

  it("un propietario sí puede nombrar a otro propietario", async () => {
    requireTenantWrite.mockResolvedValue(ctxOf("owner"));
    const { status } = await bodyOf(await create(reqWith({
      name: "Socia", email: "s@x.com", password: "unaclavelarga", role: "owner",
    })));
    expect(status).toBe(200);
  });
});

describe("cambiar el rol de otro", () => {
  it("un administrador no puede promover a nadie a propietario", async () => {
    // Es el mismo agujero por la otra puerta: si solo se cerrara el alta,
    // bastaría con crear un usuario normal y ascenderlo después.
    requireTenantWrite.mockResolvedValue(ctxOf("admin"));
    membershipRow = { id: "m1", user_id: "otro", organization_id: "org-1", role: "seller", status: "active" };
    const { status } = await bodyOf(await update(reqWith({ user_id: "otro", role: "owner" })));
    expect(status).toBe(403);
    expect(membershipUpdate).not.toHaveBeenCalled();
  });
});

describe("invitar", () => {
  it("manda el correo y deja la membresía PENDIENTE", async () => {
    /**
     * Pendiente importa: solo las membresías activas resuelven inquilino, así
     * que si el correo acaba en la bandeja equivocada, quien lo reciba no entra
     * a nada hasta demostrar que controla esa dirección.
     */
    requireTenantWrite.mockResolvedValue(ctxOf("admin"));
    const { status, body } = await bodyOf(await invite(reqWith({
      name: "Nueva", email: " Nueva@Empresa.COM ", role: "seller",
    })));

    expect(status).toBe(200);
    expect(body.data.status).toBe("pending");
    // El correo, normalizado como lo guarda Supabase.
    expect(inviteUserByEmail.mock.calls[0][0]).toBe("nueva@empresa.com");
    // Y vuelve a ESTE dominio, no a uno configurado en otra parte.
    expect(inviteUserByEmail.mock.calls[0][1].redirectTo)
      .toBe("https://parkandtours.membego.com/auth/callback?next=/auth/establecer-clave");
    expect(membershipInsert).toHaveBeenCalledWith(expect.objectContaining({ status: "pending" }));
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "team_member_invited" }));
  });

  it("tampoco por aquí se cuela un propietario", async () => {
    requireTenantWrite.mockResolvedValue(ctxOf("admin"));
    const { status } = await bodyOf(await invite(reqWith({ name: "X", email: "x@y.com", role: "owner" })));
    expect(status).toBe(403);
    expect(inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("un correo que no puede ser un correo se rechaza antes de mandar nada", async () => {
    requireTenantWrite.mockResolvedValue(ctxOf("admin"));
    const { status } = await bodyOf(await invite(reqWith({ name: "X", email: "x@y", role: "seller" })));
    expect(status).toBe(400);
    expect(inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("«ya registrado» se explica en vez de soltar el error de Supabase", async () => {
    // Es una persona con cuenta en otra empresa, no un fallo del sistema.
    requireTenantWrite.mockResolvedValue(ctxOf("admin"));
    inviteUserByEmail.mockResolvedValue({ data: null, error: { message: "User already registered" } });

    const { status, body } = await bodyOf(await invite(reqWith({ name: "X", email: "x@y.com", role: "seller" })));
    expect(status).toBe(409);
    expect(body.error.message).toMatch(/Añádelo desde/);
  });
});
