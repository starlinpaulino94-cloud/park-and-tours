import { describe, it, expect } from "vitest";
import { cupoVisible, MOTIVO_CUPO_MENSAJE } from "@/lib/cupo-socio";
import { allotmentState, type AllotmentRow } from "@/lib/allotments";

const estado = (row: AllotmentRow | null) => allotmentState(row);

describe("lo que el socio puede reservar de verdad", () => {
  it("sin contrato, lo que tenga la salida", () => {
    /**
     * El caso normal de una agencia sin cupo negociado: vende contra la
     * capacidad general, igual que un vendedor de la casa.
     */
    const v = cupoVisible(40, estado(null));
    expect(v.disponible).toBe(40);
    expect(v.motivo).toBeNull();
    expect(v.limita_el_contrato).toBe(false);
    // Y no se le inventa un contrato: el `free_sale` que devuelve
    // `allotmentState` para que la venta siga es un valor por defecto, no un
    // acuerdo que el socio firmó.
    expect(v.contrato).toBeNull();
  });

  it("CON CONTRATO, EL MENOR DE LOS DOS — que es lo que faltaba enseñar", () => {
    /**
     * EL FALLO, EN UNA FRASE.
     *
     * El catálogo del portal enseñaba las plazas de la SALIDA. Un socio con
     * diez garantizadas veía cuarenta, vendía quince, y el 409 le llegaba en la
     * cara del turista. El contrato no estaba roto: estaba escondido.
     */
    const v = cupoVisible(40, estado({
      _id: "al-1", allotment_type: "guaranteed", seats: 10, seats_used: 2, partner: "s-1",
    }));
    expect(v.disponible).toBe(8);
    expect(v.limita_el_contrato).toBe(true);
    expect(v.contrato).toEqual({
      tipo: "guaranteed", contratadas: 10, usadas: 2, liberadas: 0, restantes: 8,
    });
  });

  it("y cuando la guagua es más pequeña que el contrato, manda la guagua", () => {
    const v = cupoVisible(3, estado({
      _id: "al-1", allotment_type: "guaranteed", seats: 10, seats_used: 0, partner: "s-1",
    }));
    expect(v.disponible).toBe(3);
    // Nadie le agranda la guagua: el remedio no es llamar a su comercial.
    expect(v.limita_el_contrato).toBe(false);
  });

  it("las plazas liberadas ya no son suyas", () => {
    /**
     * Volvieron a la venta libre. Contarlas como disponibles sería prometer dos
     * veces la misma plaza: una al socio y otra a quien la compró después.
     */
    const v = cupoVisible(40, estado({
      _id: "al-1", allotment_type: "guaranteed", seats: 10, seats_used: 2, seats_released: 6, partner: "s-1",
    }));
    expect(v.disponible).toBe(2);
    expect(v.contrato?.restantes).toBe(2);
  });

  it("cupo cerrado es cero aunque la salida esté vacía", () => {
    const v = cupoVisible(40, estado({ _id: "al-1", allotment_type: "closed", partner: "s-1" }));
    expect(v.disponible).toBe(0);
    expect(v.motivo).toBe("cerrado");
  });

  it("cupo agotado y salida llena NO son el mismo mensaje", () => {
    /**
     * Porque el remedio es distinto: al cupo agotado le pone plazas su
     * comercial; a la salida llena no le pone plazas nadie, y lo que toca es
     * otro día. Un único «no hay plazas» manda al socio a llamar a quien no
     * puede ayudarle.
     */
    const agotado = cupoVisible(40, estado({
      _id: "al-1", allotment_type: "guaranteed", seats: 5, seats_used: 5, partner: "s-1",
    }));
    const llena = cupoVisible(0, estado(null));
    expect(agotado.motivo).toBe("cupo_agotado");
    expect(llena.motivo).toBe("salida_llena");
    expect(MOTIVO_CUPO_MENSAJE.cupo_agotado).not.toBe(MOTIVO_CUPO_MENSAJE.salida_llena);
  });

  it("el contrato se responde aunque de la salida no se sepa nada", () => {
    /**
     * «Tu cupo está cerrado» se sabe con certeza sin mirar la guagua, y decirlo
     * ya le ahorra al socio el viaje entero.
     */
    expect(cupoVisible(null, estado({ _id: "al-1", allotment_type: "closed", partner: "s-1" })).motivo)
      .toBe("cerrado");
    expect(cupoVisible(null, estado({
      _id: "al-1", allotment_type: "guaranteed", seats: 2, seats_used: 2, partner: "s-1",
    })).motivo).toBe("cupo_agotado");
  });

  it("NO SABER NO ES AGOTADO", () => {
    /**
     * Una salida sin cupo calculado —creada por SQL, importada, anterior a la
     * columna— no está llena. Enseñarla en rojo le cierra al socio una salida
     * vacía, que es el mismo `?? 0` que el punto de venta ya tuvo que arreglar.
     */
    const v = cupoVisible(null, estado(null));
    expect(v.disponible).toBeNull();
    expect(v.motivo).toBeNull();
  });

  it("a petición vende contra la salida, pero avisa de que hay que confirmar", () => {
    const v = cupoVisible(40, estado({
      _id: "al-1", allotment_type: "on_request", seats: 10, seats_used: 10, partner: "s-1",
    }));
    // No tiene tope propio: `seats_used` en un cupo que no aparta plazas no
    // significa nada, y tomarlo por un tope le cerraría la venta sin motivo.
    expect(v.disponible).toBe(40);
    expect(v.requiere_confirmacion).toBe(true);
    expect(v.contrato?.restantes).toBeNull();
  });

  it("venta libre no requiere confirmación ni tiene tope", () => {
    const v = cupoVisible(40, estado({
      _id: "al-1", allotment_type: "free_sale", seats: 0, partner: "s-1",
    }));
    expect(v.disponible).toBe(40);
    expect(v.requiere_confirmacion).toBe(false);
    expect(v.contrato?.restantes).toBeNull();
  });
});
