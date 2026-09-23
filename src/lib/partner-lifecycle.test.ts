import { describe, it, expect } from "vitest";
import { vetoDeSocio, estadoDeCondiciones, versionTrasEditar } from "@/lib/partner-lifecycle";

describe("vetoDeSocio — un estado que no se comprueba no es un estado", () => {
  it("el socio activo opera", () => {
    expect(vetoDeSocio("active")).toBeNull();
  });

  it("el pendiente no opera, y se le dice que está en camino", () => {
    /**
     * `pending` existía en el esquema desde la primera migración y el
     * formulario lo ofrecía. No lo miraba nadie: el enganche del token
     * comprueba el estado de la MEMBRESÍA, no el de la organización del socio,
     * así que un tour center marcado como pendiente reservaba con normalidad.
     */
    const veto = vetoDeSocio("pending");
    expect(veto?.motivo).toBe("pendiente");
    expect(veto?.mensaje).toMatch(/activaci[óo]n/i);
  });

  it("suspendido, inactivo y bloqueado tampoco", () => {
    for (const estado of ["suspended", "inactive", "blocked"]) {
      expect(vetoDeSocio(estado)?.motivo, estado).toBe("inactivo");
    }
  });

  it("lo desconocido veta: falla cerrado", () => {
    /**
     * Es la diferencia entre fallar cerrado y fallar abierto, y lo que hay al
     * otro lado es el ERP de la operadora. La cadena vacía es lo que devuelve
     * el cargador cuando la consulta falla: un socio suspendido no puede
     * volver a operar por el expediente de que se caiga la red.
     */
    for (const estado of ["", null, undefined, "activo", "ACTIVE_"]) {
      expect(vetoDeSocio(estado)?.motivo, String(estado)).toBe("inactivo");
    }
  });

  it("no se deja engañar por mayúsculas ni espacios", () => {
    expect(vetoDeSocio("  Active ")).toBeNull();
  });
});

describe("estadoDeCondiciones — «hay fecha» no es «aceptó esto»", () => {
  it("sin condiciones escritas no hay nada que aceptar", () => {
    expect(estadoDeCondiciones(null)).toBe("sin_condiciones");
    expect(estadoDeCondiciones({ terms_version: 0 })).toBe("sin_condiciones");
  });

  it("con condiciones y sin firma, pendiente", () => {
    expect(estadoDeCondiciones({ terms_version: 1 })).toBe("pendiente");
  });

  it("aceptadas cuando la versión firmada es la vigente", () => {
    expect(estadoDeCondiciones({
      terms_version: 3, terms_accepted_version: 3, terms_accepted_at: "2026-01-01T00:00:00Z",
    })).toBe("aceptadas");
  });

  it("y vuelven a pendiente cuando la operadora cambia el texto", () => {
    /**
     * ESTE ES EL CASO QUE JUSTIFICA LAS DOS COLUMNAS.
     *
     * Con una sola —una fecha de aceptación— la firma vieja se queda ahí
     * acreditando un texto que ya no rige, que es justo el papel que alguien
     * sacaría en una discusión sobre una comisión.
     */
    expect(estadoDeCondiciones({
      terms_version: 4, terms_accepted_version: 3, terms_accepted_at: "2026-01-01T00:00:00Z",
    })).toBe("pendiente");
  });
});

describe("versionTrasEditar — la versión sube solo si el texto cambió", () => {
  it("un texto nuevo sube la versión", () => {
    expect(versionTrasEditar("", "20% de comisión", 0)).toBe(1);
    expect(versionTrasEditar("20%", "25%", 4)).toBe(5);
  });

  it("guardar sin tocar el texto no la sube", () => {
    /**
     * Si subiera en cada guardado, el socio recibiría «las condiciones han
     * cambiado» cada vez que alguien corrige un teléfono. A la tercera vez
     * nadie las vuelve a leer, y entonces la aceptación deja de significar
     * nada aunque el sistema la siga pidiendo.
     */
    expect(versionTrasEditar("20%", "20%", 4)).toBe(4);
    expect(versionTrasEditar(undefined, undefined, 2)).toBe(2);
  });

  it("los espacios de más no son un cambio", () => {
    expect(versionTrasEditar("20%", "  20%  ", 7)).toBe(7);
  });

  it("borrar el texto sí lo es", () => {
    // Quitar las condiciones es un cambio de condiciones: la firma sobre el
    // texto anterior no puede seguir valiendo.
    expect(versionTrasEditar("20%", "", 7)).toBe(8);
  });
});
