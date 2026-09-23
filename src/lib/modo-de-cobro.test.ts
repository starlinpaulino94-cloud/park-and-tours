import { describe, it, expect } from "vitest";
import {
  modoDeCobro, cobraElPuntoDeVenta, elVendedorRetiene, repartoDelCobro,
  MODOS_DE_COBRO, MODO_DE_COBRO_ETIQUETA,
} from "@/lib/modo-de-cobro";

describe("qué modo de cobro se le aplica a una venta", () => {
  it("LO DESCONOCIDO ES «PAGA EL CLIENTE AL OPERADOR»", () => {
    /**
     * Es lo que hace hoy el sistema con todas las ventas. Cualquier otra
     * lectura del hueco cambiaría de golpe, el día del despliegue, dónde está
     * el dinero de todas las ventas existentes.
     */
    expect(modoDeCobro(null)).toBe("operator_collects");
    expect(modoDeCobro({})).toBe("operator_collects");
    expect(modoDeCobro({ relacion: {}, vendedor: {} })).toBe("operator_collects");
    expect(modoDeCobro({ relacion: { collection_mode: "lo_que_sea" } })).toBe("operator_collects");
  });

  it("EL CONTRATO DEL SOCIO GANA A LA FICHA DEL VENDEDOR", () => {
    /**
     * Es el orden contrario al que parece. Un vendedor de un tour center que
     * retiene puede existir, pero mientras el contrato diga que cobra el punto
     * de venta, el dinero es del mostrador y no suyo: dejar que su ficha gane
     * haría que retuviera de un dinero que la operadora nunca va a ver pasar.
     */
    expect(modoDeCobro({
      relacion: { collection_mode: "pos_collects" },
      vendedor: { collection_mode: "seller_retains" },
    })).toBe("pos_collects");
  });

  it("y «paga el operador» en el contrato es una declaración, no un hueco", () => {
    // Si el socio dice expresamente que cobra la operadora, la ficha del
    // vendedor tampoco lo cambia.
    expect(modoDeCobro({
      relacion: { collection_mode: "operator_collects" },
      vendedor: { collection_mode: "seller_retains" },
    })).toBe("operator_collects");
  });

  it("la ficha del vendedor decide cuando no hay contrato de socio", () => {
    // El caso del promotor de playa de la propia operadora.
    expect(modoDeCobro({ vendedor: { collection_mode: "seller_retains" } })).toBe("seller_retains");
    expect(modoDeCobro({ relacion: null, vendedor: { collection_mode: "seller_retains" } }))
      .toBe("seller_retains");
  });

  it("cada modo tiene su etiqueta, para que la ficha diga qué se está pactando", () => {
    for (const modo of MODOS_DE_COBRO) {
      expect(MODO_DE_COBRO_ETIQUETA[modo], modo).toBeTruthy();
    }
  });

  it("las preguntas cortas dicen lo que su nombre", () => {
    expect(cobraElPuntoDeVenta("pos_collects")).toBe(true);
    expect(cobraElPuntoDeVenta("operator_collects")).toBe(false);
    expect(elVendedorRetiene("seller_retains")).toBe(true);
    expect(elVendedorRetiene("pos_collects")).toBe(false);
  });
});

describe("cuánto retiene el vendedor", () => {
  it("su comisión, y el resto lo paga el cliente al subir", () => {
    expect(repartoDelCobro(100, 15)).toEqual({ retenido: 15, pendiente: 85 });
  });

  it("LA COMISIÓN NUNCA PASA DEL TOTAL", () => {
    /**
     * Con una comisión mal configurada —un porcentaje de más, una regla fija
     * por encima del precio— el vendedor retendría más de lo que cobró y el
     * cliente subiría a la guagua con saldo NEGATIVO: con dinero a devolver por
     * una excursión que aún no ha hecho.
     */
    expect(repartoDelCobro(100, 140)).toEqual({ retenido: 100, pendiente: 0 });
    expect(repartoDelCobro(100, 100)).toEqual({ retenido: 100, pendiente: 0 });
  });

  it("una comisión negativa no le saca dinero al cliente", () => {
    expect(repartoDelCobro(100, -20)).toEqual({ retenido: 0, pendiente: 100 });
  });

  it("los céntimos cuadran", () => {
    const r = repartoDelCobro(99.99, 33.33);
    expect(r.retenido + r.pendiente).toBe(99.99);
  });

  it("un total en cero no retiene nada", () => {
    expect(repartoDelCobro(0, 15)).toEqual({ retenido: 0, pendiente: 0 });
  });
});
