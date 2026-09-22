import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";
import { fakeSupabase } from "@/test/fake-supabase";
import { clasificarDestino, mensajeDestinoProhibido } from "./global-setup";

/**
 * EL ARRANQUE DEL E2E NO SE APROPIA DE LA CUENTA DE NADIE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DE DÓNDE SALE ESTA PRUEBA
 *
 * `E2E_EMAIL` apuntaba a una cuenta de demostración que alguien usaba. Cada
 * ejecución de CI le reescribía la contraseña y le movía la empresa de
 * aterrizaje al inquilino de pruebas. Desde fuera se veía así: la persona
 * tecleaba su contraseña correcta y el formulario la rechazaba, y no había nada
 * que mirar — el efecto lo causaba algo que ni siquiera estaba pasando en ese
 * momento.
 *
 * Es el peor tipo de defecto: silencioso, a distancia, y disfrazado de error de
 * quien lo sufre.
 */

let db: FakeDb;
let contador = 0;
const creados: { email: string; password: string }[] = [];
const claves: { id: string; password: string }[] = [];

/** El Admin API de Auth, sobre la misma base en memoria. */
const authAdmin = {
  listUsers: async ({ page }: { page: number }) => ({
    data: { users: page === 1 ? db.rows("auth_users").map((u) => ({ id: u._id, email: u.email })) : [] },
    error: null,
  }),
  updateUserById: async (id: string, attrs: { password?: string }) => {
    claves.push({ id, password: attrs.password ?? "" });
    return { data: null, error: null };
  },
  createUser: async ({ email, password }: { email: string; password: string }) => {
    creados.push({ email, password });
    const id = `nuevo-${++contador}`;
    db.seed("auth_users", [{ _id: id, email }]);
    return { data: { user: { id, email } }, error: null };
  },
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => {
    const sb = fakeSupabase(db) as unknown as Record<string, unknown>;
    return { ...sb, from: (t: string) => (sb.from as (x: string) => unknown)(t), auth: { admin: authAdmin } };
  },
}));

import globalSetup from "./global-setup";

const E2E_ORG = "org-e2e";
const REAL = "org-real";
const USUARIO = "user-1";

function proyecto(extra: Record<string, Record<string, unknown>[]> = {}) {
  return fakeDb({
    organizations: [
      { _id: E2E_ORG, name: "E2E Tenant", slug: "e2e-tenant", kind: "tenant", status: "active", tenant_org_id: E2E_ORG },
    ],
    auth_users: [{ _id: USUARIO, email: "demopresentaciones@havelgo.com" }],
    organization_memberships: [],
    ...extra,
  });
}

beforeEach(() => {
  db = proyecto();
  creados.length = 0;
  claves.length = 0;
  // Una pila local: el arranque se niega a escribir en un proyecto remoto, y
  // esa negativa salta ANTES que la comprobación de la cuenta —a propósito—,
  // así que con una URL remota estas pruebas no llegarían a lo que miden.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "no-se-mira";
  process.env.E2E_EMAIL = "demopresentaciones@havelgo.com";
  process.env.E2E_PASSWORD = "clave-del-e2e";
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

const membresias = () => db.rows("organization_memberships");

describe("la cuenta del E2E", () => {
  it("NO le toca la contraseña a alguien que pertenece a una empresa de verdad", async () => {
    /**
     * ──────────────────────────────────────────────────────────────────────
     * EL INVARIANTE
     *
     * Este arranque corre con la llave de servicio: puede reescribir cualquier
     * contraseña del proyecto. Lo único que lo acota es a QUIÉN decide tocar.
     *
     * Y la comprobación tiene que ir ANTES de escribir. Comprobar después de
     * haber reescrito la contraseña no comprueba nada: el daño ya está hecho y
     * la persona ya no puede entrar.
     */
    db.seed("organizations", [
      { _id: REAL, name: "Havelgo Demo Tours", slug: "havelgo-demo-presentaciones", kind: "tenant", status: "active", tenant_org_id: REAL },
    ]);
    db.seed("organization_memberships", [
      { _id: "mem-1", user_id: USUARIO, organization_id: REAL, role: "owner", status: "active", is_primary: true },
    ]);

    await expect(globalSetup()).rejects.toThrow(/pertenece a 1 empresa/i);

    expect(claves, "ni una sola escritura de contraseña").toEqual([]);
    expect(
      membresias().find((m) => m.organization_id === REAL)!.is_primary,
      "y sigue aterrizando en su empresa"
    ).toBe(true);
    expect(membresias().some((m) => m.organization_id === E2E_ORG), "sin membresía nueva").toBe(false);
  });

  it("el fallo dice qué cuenta, qué empresa y qué hacer", async () => {
    // Un `throw` sin salida convierte el arreglo en una investigación. El
    // mensaje tiene que servir para actuar sin leer este fichero.
    db.seed("organizations", [
      { _id: REAL, name: "Havelgo Demo Tours", slug: "havelgo-demo-presentaciones", kind: "tenant", status: "active", tenant_org_id: REAL },
    ]);
    db.seed("organization_memberships", [
      { _id: "mem-1", user_id: USUARIO, organization_id: REAL, role: "owner", status: "active", is_primary: true },
    ]);

    const error = await globalSetup().catch((e: Error) => e);
    const texto = (error as Error).message;

    expect(texto, "la cuenta").toContain("demopresentaciones@havelgo.com");
    expect(texto, "la empresa que la reclama").toContain("Havelgo Demo Tours");
    expect(texto, "y el remedio").toMatch(/dirección dedicada|E2E_EMAIL/);
  });

  it("sobre una cuenta que es solo del E2E sí opera", async () => {
    // El arreglo no puede consistir en dejar de funcionar.
    db.seed("organization_memberships", [
      { _id: "mem-e2e", user_id: USUARIO, organization_id: E2E_ORG, role: "owner", status: "active", is_primary: false },
    ]);

    await globalSetup();

    expect(claves, "le repone la contraseña conocida").toEqual([{ id: USUARIO, password: "clave-del-e2e" }]);
    expect(membresias().find((m) => m.organization_id === E2E_ORG)!.is_primary).toBe(true);
  });

  it("y si no existe, la crea", async () => {
    db.seed("auth_users", []);
    process.env.E2E_EMAIL = "e2e@e2e.invalid";

    await globalSetup();

    expect(creados.map((c) => c.email)).toEqual(["e2e@e2e.invalid"]);
    expect(membresias()).toHaveLength(1);
    expect(membresias()[0].is_primary).toBe(true);
  });

  it("sin credenciales no escribe nada", async () => {
    // Correr el E2E en local no puede tener efectos en ningún proyecto.
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await globalSetup();
    expect(claves).toEqual([]);
    expect(creados).toEqual([]);
    expect(membresias()).toEqual([]);
  });
});

describe("el destino del arranque tiene que ser desechable", () => {
  it("una pila local se reconoce", () => {
    for (const url of [
      "http://127.0.0.1:54321", "http://localhost:54321",
      "http://host.docker.internal:54321", "http://kong:8000",
    ]) {
      expect(clasificarDestino(url), url).toBe("desechable");
    }
  });

  it("un proyecto remoto se RECHAZA por defecto", () => {
    /**
     * Denegar por defecto. Durante meses esto escribió en el proyecto de
     * producción en cada pull request, y nada lo impedía porque nada lo
     * preguntaba.
     */
    expect(clasificarDestino("https://abcdefgh.supabase.co")).toBe("remoto_prohibido");
    expect(clasificarDestino("https://abcdefgh.supabase.co", "false")).toBe("remoto_prohibido");
    expect(clasificarDestino("https://abcdefgh.supabase.co", "1")).toBe("remoto_prohibido");
    expect(clasificarDestino("https://abcdefgh.supabase.co", "yes")).toBe("remoto_prohibido");
  });

  it("solo una persona escribiendo E2E_ALLOW_REMOTE=true lo abre", () => {
    expect(clasificarDestino("https://abcdefgh.supabase.co", "true")).toBe("remoto_permitido");
    expect(clasificarDestino("https://abcdefgh.supabase.co", "TRUE")).toBe("remoto_permitido");
  });

  it("una URL ilegible tampoco pasa", () => {
    // Si no se sabe a dónde apunta, no se escribe.
    for (const url of [undefined, "", "no-es-una-url", "supabase.co"]) {
      expect(clasificarDestino(url as string | undefined), String(url)).toBe("ilegible");
    }
  });

  it("el mensaje dice qué pasa, por qué y cuál es la salida", () => {
    const texto = mensajeDestinoProhibido("https://abcdefgh.supabase.co", "remoto_prohibido");
    expect(texto).toContain("abcdefgh.supabase.co");
    expect(texto).toContain("REESCRIBE contraseñas");
    expect(texto).toContain("supabase start");
    expect(texto).toContain("E2E_ALLOW_REMOTE=true");
  });
});

describe("contra un proyecto remoto no se escribe NI UNA fila", () => {
  it("se niega antes de tocar nada", async () => {
    /**
     * No basta con que falle: tiene que fallar ANTES de escribir.
     *
     * Es la misma lección que la comprobación de la cuenta. Un arranque que
     * crea la empresa, crea el usuario y LUEGO se da cuenta de que la base era
     * la de producción ya ha escrito en la base de producción. La comprobación
     * después del daño no es una comprobación.
     */
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proyecto.supabase.co";
    delete process.env.E2E_ALLOW_REMOTE;

    await expect(globalSetup()).rejects.toThrow(/proyecto remoto/i);

    expect(claves, "ni una contraseña reescrita").toEqual([]);
    expect(creados, "ni un usuario creado").toEqual([]);
    expect(membresias(), "ni una membresía").toEqual([]);
    expect(
      db.rows("organizations").filter((o) => o._id !== E2E_ORG),
      "ni una empresa creada",
    ).toEqual([]);
  });
});
