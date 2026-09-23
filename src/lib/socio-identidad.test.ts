import { describe, it, expect } from "vitest";
import { esDeSocio } from "@/lib/tenant";
import type { AppRole } from "@/lib/auth";

/**
 * QUIÉN ES DE FUERA. LA PREGUNTA, NO EL TEXTO QUE LA HACE.
 *
 * Las guardas de contrato comprueban que los veinte puntos de aislamiento
 * LLAMAN a `esDeSocio`. Eso no vale de nada si la función contesta mal, y
 * ninguna prueba de texto puede saberlo: `esDeSocio` podría devolver `false`
 * siempre y las veinte llamadas seguirían ahí, en su sitio, sin decir nada.
 *
 * Esto es lo que comprueba que la respuesta es la correcta.
 */

const quien = (p: Partial<{ role: AppRole; partnerId: string | null; isPartnerMember: boolean }>) =>
  ({ role: "seller" as AppRole, ...p });

describe("esDeSocio — identificador presente ⇒ acotado", () => {
  it("el empleado de un tour center dado de alta como vendedor es de fuera", () => {
    /**
     * LA PUERTA TRASERA, EN UNA LÍNEA.
     *
     * Este es exactamente el caso que las 29 comparaciones por nombre dejaban
     * pasar: rol `seller`, socio asignado. Con `ctx.role === "partner"` daba
     * `false` y esa persona entraba al ERP interno de la operadora.
     */
    expect(esDeSocio(quien({ role: "seller", isPartnerMember: true }))).toBe(true);
    expect(esDeSocio(quien({ role: "cashier", partnerId: "socio-1" }))).toBe(true);
  });

  it("el usuario de portal clásico sigue siendo de fuera", () => {
    // Los contextos FABRICADOS a mano —motor público, revendedor, sembrador—
    // no rellenan ninguno de los dos identificadores. Si la regla dejara de
    // mirar el rol, esos contextos pasarían a ser «personal interno».
    expect(esDeSocio(quien({ role: "partner" }))).toBe(true);
  });

  it("el personal interno no es de fuera", () => {
    for (const role of ["admin", "manager", "seller", "cashier"] as AppRole[]) {
      expect(esDeSocio(quien({ role })), role).toBe(false);
    }
  });

  it("un socio vacío no cuenta como socio", () => {
    /**
     * `partnerId` llega de las claims: puede venir como cadena vacía. Tomarla
     * por buena convertiría en «de un socio» a cualquiera —incluido un
     * administrador—, que es el fallo simétrico y bastante peor: deja al
     * personal interno fuera de su propio ERP.
     */
    expect(esDeSocio(quien({ role: "admin", partnerId: "" }))).toBe(false);
    expect(esDeSocio(quien({ role: "admin", partnerId: null }))).toBe(false);
    expect(esDeSocio(quien({ role: "admin", isPartnerMember: false }))).toBe(false);
  });
});
