import { describe, it, expect } from "vitest";
import { modeloDe, devengaComision } from "@/lib/modelo-comercial";

describe("cómo gana dinero un tour center", () => {
  it("a comisión devenga; a neto, no", () => {
    /**
     * EL COBRO DOBLE, EN UNA LÍNEA.
     *
     * Con `net` el margen del socio ya viajó dentro del precio que pagó.
     * Liquidarle además una comisión es pagarle su margen dos veces — y no se
     * ve el día de la venta, porque las dos cifras son correctas por separado.
     */
    expect(devengaComision({ pricing_model: "commission" })).toBe(true);
    expect(devengaComision({ pricing_model: "net" })).toBe(false);
  });

  it("lo desconocido es COMISIÓN, no neto", () => {
    /**
     * Es lo que hacía el sistema con todos los socios antes de que la columna
     * existiera. Entender el hueco como `net` les quitaría la comisión a todos
     * de golpe el día del despliegue — el mismo apagón silencioso que evita la
     * siembra del contrato, con el signo cambiado.
     */
    for (const valor of [undefined, null, "", "NET", "neto", "otra cosa"]) {
      expect(modeloDe({ pricing_model: valor as string }), String(valor)).toBe("commission");
    }
    expect(modeloDe(null)).toBe("commission");
    expect(devengaComision(undefined)).toBe(true);
  });
});
