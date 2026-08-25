import { describe, it, expect, vi, beforeEach } from "vitest";

const getUserById = vi.fn();

vi.mock("@/lib/supabase/service", () => ({
  supabaseService: () => ({ auth: { admin: { getUserById } } }),
}));
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: vi.fn() }));

import { UNKNOWN_REQUESTER, clearUserDirectoryCache, resolveUserNames } from "@/lib/user-directory";

const user = (over: Record<string, unknown>) => ({ data: { user: { id: "u1", ...over } } });

beforeEach(() => {
  vi.clearAllMocks();
  clearUserDirectoryCache();
});

describe("user-directory — resolución de nombres", () => {
  it("usa el nombre del perfil cuando existe", async () => {
    getUserById.mockResolvedValue(user({ user_metadata: { name: "María Fernández" }, email: "maria@x.com" }));
    const names = await resolveUserNames(["u1"]);
    expect(names.get("u1")).toBe("María Fernández");
  });

  it("nunca devuelve el correo, ni siquiera sin nombre registrado", async () => {
    getUserById.mockResolvedValue(user({ user_metadata: {}, email: "juan.perez@empresa.com" }));
    const names = await resolveUserNames(["u1"]);
    expect(names.get("u1")).toBe("Juan Perez");
    expect([...names.values()].join(" ")).not.toContain("@");
  });

  it("un nombre que en realidad es un correo se convierte en nombre", async () => {
    getUserById.mockResolvedValue(user({ user_metadata: { name: "ana@x.com" }, email: "ana@x.com" }));
    expect((await resolveUserNames(["u1"])).get("u1")).toBe("Ana");
  });

  it("sin identidad resoluble no inventa nada: la fila usará la etiqueta neutra", async () => {
    getUserById.mockResolvedValue({ data: { user: null } });
    const names = await resolveUserNames(["u1"]);
    expect(names.has("u1")).toBe(false);
    expect(UNKNOWN_REQUESTER).toBe("Solicitante sin nombre registrado");
  });

  it("un fallo del Admin API no rompe la pantalla", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    getUserById.mockRejectedValue(new Error("503"));
    await expect(resolveUserNames(["u1"])).resolves.toEqual(new Map());
  });

  it("ignora ids nulos y no consulta de más", async () => {
    await resolveUserNames([null, undefined, ""]);
    expect(getUserById).not.toHaveBeenCalled();
  });
});

describe("user-directory — caché", () => {
  it("no repite la consulta del mismo id dentro de la misma llamada", async () => {
    getUserById.mockResolvedValue(user({ user_metadata: { name: "Ana" } }));
    await resolveUserNames(["u1", "u1", "u1"]);
    expect(getUserById).toHaveBeenCalledTimes(1);
  });

  it("reutiliza el nombre entre renders sucesivos", async () => {
    getUserById.mockResolvedValue(user({ user_metadata: { name: "Ana" } }));

    await resolveUserNames(["u1"]);
    const second = await resolveUserNames(["u1"]);

    expect(getUserById).toHaveBeenCalledTimes(1);
    expect(second.get("u1")).toBe("Ana");
  });

  it("tampoco reintenta en bucle contra un servicio que ya falló", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    getUserById.mockRejectedValue(new Error("503"));

    await resolveUserNames(["u1"]);
    await resolveUserNames(["u1"]);

    expect(getUserById).toHaveBeenCalledTimes(1);
  });

  it("solo consulta los ids que aún no están en caché", async () => {
    getUserById.mockImplementation(async (id: string) => user({ id, user_metadata: { name: `Nombre ${id}` } }));

    await resolveUserNames(["a"]);
    getUserById.mockClear();
    const names = await resolveUserNames(["a", "b"]);

    expect(getUserById).toHaveBeenCalledTimes(1);
    expect(getUserById).toHaveBeenCalledWith("b");
    expect(names.get("a")).toBe("Nombre a");
  });
});
