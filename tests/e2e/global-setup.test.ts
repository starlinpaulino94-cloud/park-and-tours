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

  it("y si no existen, crea LAS CUATRO: propietario, vendedor, socio y proveedor", async () => {
    /**
     * Cuatro porque el aislamiento no se puede probar con la de propietario —ve
     * todo por definición— y porque son TRES los actores acotados que las fases
     * 1-8 construyeron: el vendedor de la casa, el tour center y el proveedor.
     * Cada uno tiene su propia cadena de identidad y ninguna se ejercita con la
     * cuenta de otro.
     *
     * Las tres se DERIVAN de la de pruebas (`algo@x` → `algo+vendedor@x`) para que
     * hereden su garantía: si `E2E_EMAIL` es una dirección dedicada, estas también
     * lo son, y la comprobación de «esta cuenta no es de nadie» corre sobre las
     * cuatro.
     */
    db.seed("auth_users", []);
    process.env.E2E_EMAIL = "e2e@e2e.invalid";

    await globalSetup();

    expect(creados.map((c) => c.email)).toEqual([
      "e2e@e2e.invalid",
      "e2e+vendedor@e2e.invalid",
      "e2e+socio@e2e.invalid",
      "e2e+proveedor@e2e.invalid",
    ]);

    const roles = membresias().map((m) => m.role).sort();
    expect(roles).toEqual(["owner", "partner", "seller", "supplier"]);
    expect(membresias().every((m) => m.is_primary)).toBe(true);
  });

  it("LA DEL SOCIO va en la empresa DEL SOCIO, no en la del inquilino", async () => {
    /**
     * Es lo que hace que el enganche del token ponga `partner_id`: lo saca del
     * `org_id` de la membresía cuando esa organización es de tipo `partner`. Con la
     * membresía en el inquilino, el socio habría entrado como personal interno —con
     * rango `partner` y sin acotar por nada—, que es el fallo más grave posible en
     * esta prueba porque el E2E seguiría pasando.
     */
    db.seed("auth_users", []);
    process.env.E2E_EMAIL = "e2e@e2e.invalid";

    await globalSetup();

    const socio = db.rows("organizations").find((o) => o.slug === "e2e-partner")!;
    expect(socio.kind, "no es una organización de socio").toBe("partner");
    expect(socio.tenant_org_id, "no cuelga del inquilino").toBe(E2E_ORG);

    const suya = membresias().find((m) => m.role === "partner")!;
    expect(suya.organization_id, "la membresía del socio no está en su empresa").toBe(socio._id);
  });

  it("y la del PROVEEDOR va en el inquilino, con su ficha apuntando a la cuenta", async () => {
    /**
     * Al contrario que el socio: el proveedor no es una organización, es una fila
     * de `supplier` con `user_id`. El enganche la busca acotada a la empresa de la
     * membresía, así que si la ficha no apunta a esta cuenta el token sale sin
     * `supplier_id` y el portal no la deja entrar — y el E2E fallaría en el login,
     * no en la afirmación, que es un diagnóstico muy peor.
     */
    db.seed("auth_users", []);
    process.env.E2E_EMAIL = "e2e@e2e.invalid";

    await globalSetup();

    const proveedor = membresias().find((m) => m.role === "supplier")!;
    expect(proveedor.organization_id, "la membresía del proveedor no está en el inquilino").toBe(E2E_ORG);

    const fichas = db.rows("supplier");
    const propia = fichas.find((f) => f.tax_id === "E2E-P1")!;
    expect(propia.user_id, "la ficha no apunta a la cuenta del proveedor").toBe(proveedor.user_id);
    expect(propia.status).toBe("active");
    // Y la del vecino existe y NO está vinculada: sin un otro no hay aislamiento
    // que probar.
    const ajena = fichas.find((f) => f.tax_id === "E2E-P2")!;
    expect(ajena.user_id ?? null).toBeNull();
  });

  it("la cuenta DERIVADA del vendedor pasa por la misma comprobación", async () => {
    /**
     * La cuenta de vendedor nace de la de pruebas (`algo@x` →
     * `algo+vendedor@x`). Con el alias `+`, cualquiera puede haber registrado
     * esa dirección antes: es una dirección real que llega al mismo buzón.
     *
     * Sin esta comprobación, el arranque le reescribiría la contraseña y le
     * movería la empresa de aterrizaje en cada ejecución de CI, en silencio,
     * que es exactamente el fallo que este fichero existe para no repetir —y
     * que la primera vez costó que alguien no pudiera trabajar sin entender
     * por qué—.
     */
    const VENDEDOR = "user-vendedor";
    db.seed("auth_users", [
      { _id: USUARIO, email: "demopresentaciones@havelgo.com" },
      { _id: VENDEDOR, email: "demopresentaciones+vendedor@havelgo.com" },
    ]);
    db.seed("organizations", [
      { _id: E2E_ORG, name: "E2E Tenant", slug: "e2e-tenant", kind: "tenant", status: "active", tenant_org_id: E2E_ORG },
      { _id: REAL, name: "Havelgo Demo Tours", slug: "havelgo-demo", kind: "tenant", status: "active", tenant_org_id: REAL },
    ]);
    db.seed("organization_memberships", [
      // La de propietario sí es exclusiva del E2E: el arranque pasa de largo…
      { _id: "mem-e2e", user_id: USUARIO, organization_id: E2E_ORG, role: "owner", status: "active", is_primary: true },
      // …y se topa con que la DERIVADA pertenece a una empresa de verdad.
      { _id: "mem-real", user_id: VENDEDOR, organization_id: REAL, role: "owner", status: "active", is_primary: true },
    ]);

    const error = await globalSetup().catch((e: Error) => e);
    expect(error, "el arranque tiene que negarse").toBeInstanceOf(Error);
    expect((error as Error).message).toContain("demopresentaciones+vendedor@havelgo.com");
    expect((error as Error).message).toContain("Havelgo Demo Tours");

    // Y no le ha tocado la contraseña a esa cuenta.
    expect(claves.some((c) => c.id === VENDEDOR)).toBe(false);
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
