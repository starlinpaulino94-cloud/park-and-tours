import { describe, it, expect } from "vitest";
import { desajusteDeAtribucion } from "@/lib/atribucion-coherente";

const interno = { _id: "v-1", first_name: "Ana", last_name: "Pérez", partner: null };
const delSocio = { _id: "v-2", first_name: "Luis", partner: "soc-1" };
const deOtroSocio = { _id: "v-3", first_name: "Marta", partner: "soc-2" };

describe("el vendedor de una venta tiene que ser de quien la vende", () => {
  it("el vendedor de la casa en una venta propia, bien", () => {
    expect(desajusteDeAtribucion(interno, null)).toBeNull();
    expect(desajusteDeAtribucion(interno, "")).toBeNull();
  });

  it("el vendedor del tour center en la venta de ese tour center, bien", () => {
    expect(desajusteDeAtribucion(delSocio, "soc-1")).toBeNull();
  });

  it("el de otro tour center, no", () => {
    /**
     * Detrás del vendedor va la COMISIÓN: el motor la calcula sobre
     * `seller_id` sin volver a mirar de quién es la venta. Con esto abierto, se
     * le paga a quien no vendió, y quien vendió lo reclama —con razón— en la
     * liquidación del mes siguiente.
     */
    expect(desajusteDeAtribucion(deOtroSocio, "soc-1")).toMatch(/otro tour center/);
  });

  it("el de la casa en la venta de un tour center, TAMBIÉN bien", () => {
    /**
     * LA REGLA NO ES SIMÉTRICA, Y LA PRIMERA VERSIÓN LO FUE.
     *
     * Exigir que los dos coincidieran siempre parecía lo obvio; lo cazó una
     * prueba de comisiones que ya existía. El conserje trae al cliente y el
     * vendedor del mostrador remata: el motor genera DOS comisiones, una para
     * el socio y otra para el vendedor. Prohibirlo habría roto una forma de
     * vender que ya estaba en producción, y el error se habría visto el día de
     * la primera venta referida, no aquí.
     */
    expect(desajusteDeAtribucion(interno, "soc-1")).toBeNull();
  });

  it("ni el de un tour center en una venta propia", () => {
    expect(desajusteDeAtribucion(delSocio, null)).toMatch(/pertenece a un tour center/);
  });

  it("un socio en blanco es una venta propia, no un socio distinto", () => {
    /**
     * `partner_id` llega del cuerpo de la petición: puede venir vacío o con
     * espacios. Tomándolo tal cual, el mensaje que se le da a quien vende es
     * «es de otro tour center» cuando lo que pasa es que no eligió ninguno —y
     * entonces se pone a buscar cuál es el otro—.
     */
    expect(desajusteDeAtribucion(delSocio, "   ")).toMatch(/pertenece a un tour center/);
    expect(desajusteDeAtribucion(delSocio, "")).toMatch(/pertenece a un tour center/);
  });

  it("y sin vendedor no hay nada que comprobar", () => {
    // Es el caso COMÚN: la venta directa de la empresa o del tour center. Si
    // esto fallara, la mitad de las ventas dejarían de poder registrarse.
    expect(desajusteDeAtribucion(null, "soc-1")).toBeNull();
    expect(desajusteDeAtribucion(undefined, null)).toBeNull();
  });

  it("la ficha expandida y la cruda deciden lo mismo", () => {
    // La fila puede traer el socio como objeto o como uuid según quién la leyó.
    expect(desajusteDeAtribucion({ _id: "v-2", partner: { _id: "soc-1" } }, "soc-1")).toBeNull();
    expect(desajusteDeAtribucion({ _id: "v-2", partner: { _id: "soc-1" } }, "soc-2")).toMatch(/otro tour center/);
  });

  it("y el mensaje nombra a la persona, que es lo que quien vende tiene delante", () => {
    expect(desajusteDeAtribucion(deOtroSocio, "soc-1")).toMatch(/Marta/);
  });
});
