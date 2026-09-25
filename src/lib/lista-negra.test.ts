import { describe, it, expect } from "vitest";
import {
  estaVetado, mensajeInterno, mensajePublico, motivoValido, cambioDeVeto,
  puertaEquivocada, MOTIVO_MINIMO, CODIGO_VETADO, VETADO,
} from "@/lib/lista-negra";

describe("quién está vetado", () => {
  it("solo el que está en la lista negra", () => {
    expect(estaVetado({ status: "blacklist" })).toBe(true);
    expect(estaVetado({ status: "active" })).toBe(false);
  });

  it("y UNA FICHA INACTIVA NO LO ESTÁ", () => {
    /**
     * `inactive` es otra cosa: una ficha archivada, un duplicado que se retiró
     * del listado. Bloquear ventas por eso convertiría una tarea de limpieza en
     * un veto comercial sin que nadie lo decidiera.
     */
    expect(estaVetado({ status: "inactive" })).toBe(false);
  });

  it("sin estado, no", () => {
    expect(estaVetado({})).toBe(false);
    expect(estaVetado(null)).toBe(false);
    expect(estaVetado(undefined)).toBe(false);
  });
});

describe("qué se dice, y a quién", () => {
  it("dentro va el motivo: el cajero decide con la persona delante", () => {
    expect(mensajeInterno({ status: VETADO, blocked_reason: "Tres no-shows sin avisar" }))
      .toBe("Este cliente está en la lista negra: Tres no-shows sin avisar");
  });

  it("y sin motivo anotado, se dice lo que hay y no se inventa", () => {
    expect(mensajeInterno({ status: VETADO })).toBe("Este cliente está en la lista negra.");
  });

  it("FUERA NO VIAJA NI EL MOTIVO NI LA PALABRA", () => {
    /**
     * Un desconocido que reserva por internet no tiene por qué enterarse de que
     * está en una lista, y decírselo por una respuesta HTTP es la peor manera:
     * sin nadie delante que lo explique y con el texto para reenviarlo.
     */
    const fuera = mensajePublico("809-555-0001");
    expect(fuera).not.toMatch(/lista negra|bloquead|blacklist/i);
    expect(fuera).toMatch(/809-555-0001/);
  });

  it("y sin teléfono sigue diciendo con quién hablar", () => {
    expect(mensajePublico(null)).toMatch(/Escríbenos/);
    expect(mensajePublico("  ")).not.toMatch(/al\s+$/);
  });

  it("el código es estable: es lo que leen las rutas de fuera", () => {
    // El texto se puede reescribir; el código no, porque de él depende que la
    // ruta pública traduzca en vez de reenviar el motivo tal cual.
    expect(CODIGO_VETADO).toBe("CUSTOMER_BLOCKED");
  });
});

describe("el motivo", () => {
  it("dos palabras no son un motivo", () => {
    expect(motivoValido("malo")).toBe(false);
    expect(motivoValido("   ")).toBe(false);
    expect(motivoValido(null)).toBe(false);
    expect(motivoValido(123)).toBe(false);
  });

  it("y uno de verdad sí", () => {
    expect(motivoValido("Tres no-shows sin avisar en agosto")).toBe(true);
    expect(motivoValido("x".repeat(MOTIVO_MINIMO))).toBe(true);
  });
});

describe("qué clase de cambio es", () => {
  it("de activo a lista negra, veta", () => {
    expect(cambioDeVeto("active", "blacklist")).toBe("veta");
  });

  it("de lista negra a activo, levanta", () => {
    expect(cambioDeVeto("blacklist", "active")).toBe("levanta");
  });

  it("de activo a inactivo no es ni lo uno ni lo otro", () => {
    expect(cambioDeVeto("active", "inactive")).toBe("ninguno");
  });

  it("EL MISMO VALOR NO ES UN CAMBIO", () => {
    /**
     * El formulario genérico manda todos sus campos en cada guardado, también
     * los que nadie tocó. Rechazar por «viene el estado» convertiría cualquier
     * edición de una nota en un error incomprensible.
     */
    expect(cambioDeVeto("blacklist", "blacklist")).toBe("ninguno");
    expect(cambioDeVeto("active", "active")).toBe("ninguno");
  });

  it("y si no viene el campo, tampoco", () => {
    expect(cambioDeVeto("active", undefined)).toBe("ninguno");
    expect(cambioDeVeto("blacklist", null)).toBe("ninguno");
  });
});

describe("qué tiene que pasar por la puerta del bloqueo", () => {
  it("entrar en la lista negra desde el desplegable, no", () => {
    expect(puertaEquivocada("customer", { status: "blacklist" }, { status: "active" })).toBeTruthy();
  });

  it("y salir de ella, tampoco", () => {
    // En los dos sentidos: levantar un bloqueo sin que conste quién fue es la
    // mitad del problema.
    expect(puertaEquivocada("customer", { status: "active" }, { status: "blacklist" })).toBeTruthy();
  });

  it("ordenar el directorio SÍ: activo ↔ inactivo es trabajo normal", () => {
    expect(puertaEquivocada("customer", { status: "inactive" }, { status: "active" })).toBeNull();
  });

  it("SI NO VIENE EL ESTADO, NO HAY NADA QUE MIRAR", () => {
    /**
     * Es lo que impide que esta guarda convierta cualquier edición en un error.
     * Sin la comprobación, un guardado que solo cambia una nota entra aquí con
     * `status` ausente, se compara contra `undefined` y —según cómo se lea— pasa
     * a parecer un cambio.
     */
    expect(puertaEquivocada("customer", { notes: "algo" }, { status: "blacklist" })).toBeNull();
  });

  it("y otra tabla no es asunto suyo", () => {
    expect(puertaEquivocada("product", { status: "blacklist" }, { status: "active" })).toBeNull();
  });

  it("al crear, nacer bloqueado también es bloquear", () => {
    // Sin esto bastaba con crear la ficha ya en la lista negra para saltarse la
    // puerta entera.
    expect(puertaEquivocada("customer", { status: "blacklist" }, null)).toBeTruthy();
  });
});
