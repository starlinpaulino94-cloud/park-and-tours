import { describe, it, expect } from "vitest";
import { vetoDeDisputa, destinatarioDeDisputa } from "@/lib/disputa";

const MOTIVO = "Faltan dos reservas del día 12";

describe("cuándo se puede disputar una liquidación", () => {
  it("una pendiente o aprobada, sí", () => {
    for (const estado of ["pending", "approved", "partially_paid", "held"]) {
      expect(vetoDeDisputa(estado, MOTIVO), estado).toBeNull();
    }
  });

  it("una PAGADA también, y es el caso que más importa", () => {
    /**
     * «Me pagaste menos de lo acordado» solo se descubre cobrando. Cerrar la
     * disputa al pagar convertiría el pago en un finiquito unilateral: la
     * operadora zanjaría la discusión pagando de menos.
     */
    expect(vetoDeDisputa("paid", MOTIVO)).toBeNull();
  });

  it("una anulada, no", () => {
    expect(vetoDeDisputa("void", MOTIVO)?.status).toBe(409);
  });

  it("ni una que ya lo está", () => {
    // Sin esto, cada clic sobrescribiría el motivo y la fecha de la anterior —y
    // el plazo se contaría desde la última vez que alguien pulsó.
    expect(vetoDeDisputa("disputed", MOTIVO)?.mensaje).toMatch(/ya está en disputa/);
  });

  it("y sin motivo no se abre ninguna", () => {
    // `disputed` a secas es una etiqueta que obliga a llamar para enterarse:
    // justo lo que esto viene a quitar.
    expect(vetoDeDisputa("pending", "")?.status).toBe(400);
    expect(vetoDeDisputa("pending", "   ")?.status).toBe(400);
    expect(vetoDeDisputa("pending", "no cuadra")?.status).toBe(400);
  });
});

describe("a quién le toca resolverla", () => {
  it("quien la aprobó manda sobre quien la confirmó", () => {
    expect(destinatarioDeDisputa({ approved_by: "u-1", confirmed_by: "u-2" })).toBe("u-1");
  });

  it("y si no hay aprobador, el que la confirmó", () => {
    expect(destinatarioDeDisputa({ confirmed_by: "u-2" })).toBe("u-2");
  });

  it("la referencia expandida y la cruda dan lo mismo", () => {
    expect(destinatarioDeDisputa({ approved_by: { _id: "u-1" } })).toBe("u-1");
  });

  it("sin nadie, null — que es distinto de esconderlo", () => {
    /**
     * Es el caso que hay que evitar, no el que hay que disimular: la respuesta
     * dice que no hay destinatario para que la pantalla pueda decirlo también,
     * en vez de dejar al tour center creyendo que alguien lo está mirando.
     */
    expect(destinatarioDeDisputa({})).toBeNull();
    expect(destinatarioDeDisputa({ approved_by: null, confirmed_by: "" })).toBeNull();
  });
});
