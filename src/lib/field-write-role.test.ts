import { describe, it, expect } from "vitest";
import {
  protectedFieldChanges, protectedFieldMessage, fieldWriteRoleFor,
  hasProtectedFields, FIELD_WRITE_ROLE,
} from "@/lib/field-write-role";
import { RESOURCES } from "@/lib/resources";

/**
 * EL PROBLEMA QUE RESUELVE ESTE MÓDULO.
 *
 * `writeRole` es del recurso ENTERO. `order` lo tiene en `seller` —tiene que
 * tenerlo, quien vende registra la venta— y entre sus campos editables están
 * `seller` y `partner`. O sea que el mismo rango que permite anotar una nota
 * permitía cambiar a quién se le paga la comisión.
 */

describe("qué campos están protegidos", () => {
  it("la atribución de la venta y del embudo", () => {
    expect(fieldWriteRoleFor("order", "seller")).toBe("manager");
    expect(fieldWriteRoleFor("lead", "seller")).toBe("manager");
    expect(fieldWriteRoleFor("quote", "seller")).toBe("manager");
    expect(fieldWriteRoleFor("customer", "assigned_seller")).toBe("manager");
  });

  it("la llave de identidad pide administración, no gerencia", () => {
    // Es la única columna que traslada el dinero de una persona a otra con un
    // solo cambio: quien la reapunte hereda ventas, comisiones y liquidación.
    expect(fieldWriteRoleFor("seller", "user")).toBe("admin");
  });

  it("un campo cualquiera no está protegido", () => {
    expect(fieldWriteRoleFor("order", "notes")).toBeNull();
    expect(hasProtectedFields("product")).toBe(false);
  });

  it("todo campo protegido existe y es escribible en su recurso", () => {
    /**
     * Un campo mal escrito aquí no rompe nada visible: simplemente no se
     * protege, y la promesa de que «el vendedor no puede cambiar el vendedor»
     * sería mentira para ese recurso.
     */
    for (const [table, campos] of Object.entries(FIELD_WRITE_ROLE)) {
      const resource = Object.values(RESOURCES).find((r) => r.table === table);
      expect(resource, `${table} no existe en RESOURCES`).toBeTruthy();
      for (const campo of Object.keys(campos)) {
        expect(
          resource!.writable.includes(campo),
          `${table}.${campo} no es escribible: protegerlo no significa nada`
        ).toBe(true);
      }
    }
  });
});

describe("se prohíbe CAMBIAR, no enviar", () => {
  const actual = { _id: "o1", seller: "v1", partner: null, notes: "hola" };

  it("reenviar el mismo valor no es un cambio", () => {
    /**
     * El formulario genérico manda todos sus campos en cada guardado, también
     * los que nadie tocó. Rechazar por «viene el campo» convertiría editarle
     * una nota a una venta en un 403 incomprensible.
     */
    expect(protectedFieldChanges("order", "seller", { seller: "v1", notes: "adiós" }, actual)).toEqual([]);
  });

  it("cambiarlo, sí", () => {
    expect(protectedFieldChanges("order", "seller", { seller: "v2" }, actual)).toEqual(["seller"]);
  });

  it("vaciarlo también es cambiarlo", () => {
    expect(protectedFieldChanges("order", "seller", { seller: null }, actual)).toEqual(["seller"]);
  });

  it("la referencia expandida se compara por identificador", () => {
    // La fila vuelve unas veces como uuid y otras como objeto: comparar en
    // crudo daría «cambió» cada vez que el formulario devuelve lo que leyó.
    expect(protectedFieldChanges("order", "seller", { seller: { _id: "v1" } }, actual)).toEqual([]);
    expect(protectedFieldChanges("order", "seller", { seller: { _id: "v2" } }, actual)).toEqual(["seller"]);
  });

  it("al crear, cualquier valor cuenta como cambio", () => {
    // Nacer con el vendedor de otro es lo mismo que reasignárselo después.
    expect(protectedFieldChanges("order", "seller", { seller: "v2" }, null)).toEqual(["seller"]);
    expect(protectedFieldChanges("order", "seller", { seller: null }, null)).toEqual([]);
  });

  it("quien tiene rango de sobra pasa", () => {
    expect(protectedFieldChanges("order", "manager", { seller: "v2" }, actual)).toEqual([]);
    // Y gerencia NO basta para la llave de identidad.
    expect(protectedFieldChanges("seller", "manager", { user: "u9" }, { user: null })).toEqual(["user"]);
    expect(protectedFieldChanges("seller", "admin", { user: "u9" }, { user: null })).toEqual([]);
  });
});

describe("el mensaje del rechazo", () => {
  it("nombra el campo en castellano", () => {
    // Un 403 que no dice qué se intentó cambiar manda a la persona a adivinar.
    expect(protectedFieldMessage(["seller"])).toBe(
      "No tienes permisos para cambiar el vendedor de este registro"
    );
    expect(protectedFieldMessage(["seller", "partner"])).toBe(
      "No tienes permisos para cambiar el vendedor ni el socio de este registro"
    );
  });
});
