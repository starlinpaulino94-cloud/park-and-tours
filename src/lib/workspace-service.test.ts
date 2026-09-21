import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";
import { fakeSupabase, type FakeSupabase } from "@/test/fake-supabase";

/**
 * A QUÉ EMPRESAS PUEDE ENTRAR UNA PERSONA.
 *
 * Esta lista hace dos trabajos a la vez —pintar el selector y autorizar el
 * cambio— y es a propósito: con dos fuentes distintas, una acabaría enseñando
 * empresas a las que la otra no deja entrar, o al revés.
 *
 * Lo que se comprueba aquí es la frontera. Cada fila de más en esta lista es
 * una empresa entera que alguien podría abrir.
 */

let db: FakeDb;
let sb: FakeSupabase;

vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => sb }));

import { workspacesOf, canEnterWorkspace } from "@/lib/workspace-service";

const YO = "user-1";

function membresías() {
  return fakeDb({
    organizations: [
      { _id: "org-real", name: "Caribe Tours", kind: "tenant", tenant_org_id: "org-real" },
      { _id: "org-demo", name: "Caribe Tours (demo)", kind: "tenant", tenant_org_id: "org-demo" },
      { _id: "org-ajena", name: "La de al lado", kind: "tenant", tenant_org_id: "org-ajena" },
    ],
    /**
     * La demo va PRIMERA a propósito.
     *
     * Con la principal ya en primer lugar, la prueba del orden pasaba sola:
     * quitar el `sort` del servicio no rompía nada. Sembrada al revés que como
     * tiene que salir, el orden se comprueba de verdad. Lo encontró la mutación.
     */
    organization_memberships: [
      { _id: "mem-2", user_id: YO, organization_id: "org-demo", role: "operations", status: "active", is_primary: false },
      { _id: "mem-1", user_id: YO, organization_id: "org-real", role: "owner", status: "active", is_primary: true },
      // De otra persona: no es mía y no tiene por qué salir en mi lista.
      { _id: "mem-3", user_id: "user-2", organization_id: "org-ajena", role: "owner", status: "active", is_primary: true },
    ],
  });
}

beforeEach(() => {
  db = membresías();
  sb = fakeSupabase(db);
});

describe("las empresas de una persona", () => {
  it("salen las suyas, con el rol que tiene EN CADA UNA", async () => {
    const lista = await workspacesOf(YO, "org-real");
    expect(lista.map((w) => w.id)).toEqual(["org-real", "org-demo"]);
    expect(lista[0].role).toBe("owner");
    expect(lista[1].role, "en la demo no manda igual que en la suya").toBe("operations");
  });

  it("la principal va primero y el orden no baila", async () => {
    // El selector se usa con el ratón y por costumbre: si el orden cambia entre
    // recargas, alguien acaba entrando a la empresa equivocada.
    const a = await workspacesOf(YO, "org-real");
    const b = await workspacesOf(YO, "org-demo");
    expect(a.map((w) => w.id)).toEqual(b.map((w) => w.id));
    expect(a[0].isPrimary).toBe(true);
  });

  it("dice en cuál se está ahora", async () => {
    const lista = await workspacesOf(YO, "org-demo");
    expect(lista.find((w) => w.id === "org-demo")!.isActive).toBe(true);
    expect(lista.find((w) => w.id === "org-real")!.isActive).toBe(false);
  });

  it("la empresa de otra persona NO sale", async () => {
    const lista = await workspacesOf(YO, "org-real");
    expect(lista.some((w) => w.id === "org-ajena")).toBe(false);
  });

  it("una membresía desactivada deja de contar en el momento", async () => {
    // Sin sesión que cerrar: la lista se recalcula en cada petición.
    db.tenantUpdate("org-demo", "organization_memberships", "mem-2", { status: "inactive" });
    const lista = await workspacesOf(YO, "org-real");
    expect(lista.map((w) => w.id)).toEqual(["org-real"]);
  });

  it("quien no pertenece a ninguna no tiene a dónde ir", async () => {
    expect(await workspacesOf("user-fantasma", "org-real")).toEqual([]);
  });
});

describe("autorizar el cambio", () => {
  it("deja entrar donde hay membresía activa", async () => {
    const destino = await canEnterWorkspace(YO, "org-demo");
    expect(destino?.name).toBe("Caribe Tours (demo)");
    expect(destino?.role).toBe("operations");
  });

  it("NO deja entrar a la empresa de otro", async () => {
    // Es toda la frontera: si esto cediera, bastaría con poner un identificador
    // en la petición para abrir la operación de otra empresa entera.
    expect(await canEnterWorkspace(YO, "org-ajena")).toBeNull();
  });

  it("NO deja entrar con una membresía desactivada", async () => {
    db.tenantUpdate("org-demo", "organization_memberships", "mem-2", { status: "inactive" });
    expect(await canEnterWorkspace(YO, "org-demo")).toBeNull();
  });

  it("un identificador inventado no abre nada", async () => {
    expect(await canEnterWorkspace(YO, "org-que-no-existe")).toBeNull();
    expect(await canEnterWorkspace(YO, "")).toBeNull();
  });

  it("el rol que devuelve es el de DESTINO, no el de origen", async () => {
    /**
     * ──────────────────────────────────────────────────────────────────────
     * LA PARTE QUE DE VERDAD IMPORTA
     *
     * Quien es dueño en su empresa y `operations` en la de al lado tiene que
     * entrar a la segunda como `operations`. Si el cambio conservara el rol de
     * origen, esto no sería un selector: sería una escalada de privilegios a un
     * clic, y encima invisible —todo funcionaría, solo que de más—.
     */
    const destino = await canEnterWorkspace(YO, "org-demo");
    expect(destino?.role).toBe("operations");
    expect(destino?.role).not.toBe("owner");
  });
});
