import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";

/**
 * LA LLAVE DEL PORTAL DEL PROVEEDOR.
 *
 * `supplier.user_id` es el único camino hacia el portal del proveedor: el
 * enganche de autenticación busca la ficha por esa columna y publica
 * `supplier_id` en el token. Hasta ahora **nada en el producto podía
 * escribirla** —no estaba entre los campos editables y no había ruta—, así que
 * toda la fase 8 era inalcanzable salvo con un `update` a mano.
 *
 * Lo que se prueba aquí es que, ya que se puede escribir, no se pueda escribir
 * mal: una cuenta de otra empresa, o una cuenta que ya es otro proveedor.
 */

let db: FakeDb;

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    tenantQuery: (...a: [string, string, Record<string, unknown>?]) => db.tenantQuery(...a),
  };
});

const membresias = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  supabaseService: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ limit: () => membresias() }) }) }),
    }),
  }),
}));

import { assertSupplierUserLinkable } from "@/lib/supplier-identity";

const ORG = "org-1";
const conMembresia = (estado = "active") =>
  membresias.mockResolvedValue({ data: [{ user_id: "u-1", status: estado }], error: null });

beforeEach(() => {
  membresias.mockReset();
  db = fakeDb({
    supplier: [
      { _id: "prov-1", organization_id: ORG, name: "Transporte Bávaro" },
      { _id: "prov-2", organization_id: ORG, name: "Catamaranes del Este", user: "u-1" },
    ],
  });
});

describe("vincular una cuenta a un proveedor", () => {
  it("sin el campo no comprueba nada: no toda edición toca la cuenta", async () => {
    await expect(assertSupplierUserLinkable(ORG, { name: "Otro nombre" }, "prov-1")).resolves.toBeUndefined();
    expect(membresias).not.toHaveBeenCalled();
  });

  it("DESVINCULAR siempre se puede", async () => {
    // Quitarle la cuenta a una ficha solo le quita acceso a esa persona: nunca
    // se lo da a nadie, así que no hay nada que validar.
    await expect(assertSupplierUserLinkable(ORG, { user: null }, "prov-1")).resolves.toBeUndefined();
    expect(membresias).not.toHaveBeenCalled();
  });

  it("una cuenta SIN acceso a esta empresa se rechaza", async () => {
    /**
     * Sin esto, un administrador podía apuntar la ficha a un usuario de otra
     * operadora: hoy no vería nada —la muralla por empresa sigue en pie— pero
     * la ficha quedaría con una llave ajena.
     */
    membresias.mockResolvedValue({ data: [], error: null });
    await expect(assertSupplierUserLinkable(ORG, { user: "u-ajeno" }, "prov-1"))
      .rejects.toThrow(/no tiene acceso activo/);
  });

  it("una membresía suspendida tampoco vale", async () => {
    conMembresia("suspended");
    await expect(assertSupplierUserLinkable(ORG, { user: "u-1" }, "prov-1"))
      .rejects.toThrow(/no tiene acceso activo/);
  });

  it("una cuenta que YA es otro proveedor se rechaza, y dice cuál", async () => {
    // Con dos fichas, el token publicaría una de las dos y esa persona vería
    // los servicios y el estado de cuenta de otro sin que nadie sepa por qué.
    conMembresia();
    await expect(assertSupplierUserLinkable(ORG, { user: "u-1" }, "prov-1"))
      .rejects.toThrow(/Catamaranes del Este/);
  });

  it("pero reguardar la MISMA ficha con su misma cuenta no choca consigo misma", async () => {
    conMembresia();
    await expect(assertSupplierUserLinkable(ORG, { user: "u-1" }, "prov-2")).resolves.toBeUndefined();
  });

  it("un fallo al leer la membresía NO se toma por «no tiene acceso»", async () => {
    /**
     * La dirección peligrosa en los dos sentidos: tratarlo como un «no» manda
     * a invitar a alguien que ya está invitado; tratarlo como un «sí» vincula
     * sin comprobar. Se lanza.
     */
    membresias.mockResolvedValue({ data: null, error: { message: "sin conexión" } });
    await expect(assertSupplierUserLinkable(ORG, { user: "u-1" }, "prov-1"))
      .rejects.toThrow(/No se pudo comprobar el acceso/);
  });
});
