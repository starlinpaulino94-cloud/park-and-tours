import { describe, it, expect } from "vitest";
import {
  vetoDeAsignacion, payloadDeAsignacion,
  CAMPOS_QUE_ASIGNA_EL_PROVEEDOR, CAMPOS_DE_PERSONAL, TABLA_DEL_TIPO,
} from "@/lib/asignacion-proveedor";

/**
 * EL PROVEEDOR ASIGNA SU PROPIA FLOTA.
 *
 * La operadora encarga «una guagua de 30 plazas para la Saona del jueves»; cuál
 * manda y quién la conduce lo sabe el transportista. Hasta ahora lo decía por
 * WhatsApp y alguien lo teclaba — y cuando no lo teclaba, el manifiesto salía con
 * «sin asignar» y la hoja de ruta sin chofer.
 */

describe("cuándo puede asignar, y cuándo ya no", () => {
  const HOY = "2026-03-10";

  it("puede en un servicio suyo, vivo y por delante", () => {
    expect(vetoDeAsignacion({ status: "confirmed", acceptance: "accepted", service_date: "2026-03-12" }, HOY))
      .toBeNull();
  });

  it("un servicio CANCELADO no se asigna", () => {
    expect(vetoDeAsignacion({ status: "cancelled", service_date: "2026-03-12" }, HOY)?.motivo)
      .toBe("cancelado");
  });

  it("uno que RECHAZÓ tampoco: no hay nada que asignar", () => {
    /**
     * Es la otra mitad de la aceptación de 0087. Sin esto, un transportista podía
     * decir «no puedo» y seguir poniéndole chofer — y la operadora, que ya está
     * buscando a otro, se encontraría dos guaguas en el mismo hotel.
     */
    const v = vetoDeAsignacion({ status: "planned", acceptance: "rejected", service_date: "2026-03-12" }, HOY);
    expect(v?.motivo).toBe("rechazado");
    expect(v?.status).toBe(409);
  });

  it("y uno con el plazo vencido, tampoco", () => {
    expect(vetoDeAsignacion({ acceptance: "expired", service_date: "2026-03-12" }, HOY)?.motivo)
      .toBe("vencido");
  });

  it("lo que ya pasó no se toca", () => {
    expect(vetoDeAsignacion({ status: "completed", service_date: "2026-03-09" }, HOY)?.motivo)
      .toBe("pasado");
  });

  it("PERO EL SERVICIO DE HOY SE SIGUE PUDIENDO ASIGNAR, aunque ya haya salido", () => {
    /**
     * Se compara por FECHA y no contra el reloj. El chofer de las seis ya salió,
     * y apuntar quién fue es exactamente lo que hace falta para que la hoja de
     * ruta y la liquidación digan la verdad. Comparar contra el instante habría
     * cerrado la puerta en el peor momento: cuando hay que corregir un cambio de
     * última hora.
     */
    expect(vetoDeAsignacion({ status: "in_progress", service_date: "2026-03-10" }, HOY)).toBeNull();
    expect(vetoDeAsignacion({ service_date: "2026-03-10T06:00:00Z" }, HOY)).toBeNull();
  });

  it("y un servicio SIN FECHA no se veta", () => {
    // La fila existe y es suya. Bloquear por un dato que la operadora no rellenó
    // dejaría al transportista sin poder decir quién va.
    expect(vetoDeAsignacion({ status: "planned", service_date: null }, HOY)).toBeNull();
  });

  it("pendiente de contestar SÍ se puede asignar", () => {
    // Poner la guagua antes de aceptar formalmente es lo que pasa de verdad: se
    // organiza el día y luego se confirma. Bloquearlo obligaría a aceptar a
    // ciegas para poder planificar.
    expect(vetoDeAsignacion({ status: "planned", acceptance: "pending", service_date: "2026-03-12" }, HOY))
      .toBeNull();
  });
});

describe("lo que el proveedor puede escribir, y nada más", () => {
  it("son campos distintos en cada tabla", () => {
    expect(CAMPOS_QUE_ASIGNA_EL_PROVEEDOR.departure_resource).toEqual(["vehicle", "staff"]);
    expect(CAMPOS_QUE_ASIGNA_EL_PROVEEDOR.pickup_route).toEqual(["vehicle", "driver", "guide"]);
  });

  it("NO incluyen cuánta gente lleva ni en qué estado está", () => {
    /**
     * Lo decide quien vende, no quien transporta. Si el transportista pudiera
     * escribir `pax_assigned`, podría cobrar por treinta pasajeros de un servicio
     * de doce; si pudiera escribir `status`, podría marcar como completado algo
     * que no prestó.
     */
    for (const tabla of ["departure_resource", "pickup_route"]) {
      const campos = CAMPOS_QUE_ASIGNA_EL_PROVEEDOR[tabla];
      for (const prohibido of ["pax_assigned", "pax_total", "status", "cost", "acceptance", "supplier"]) {
        expect(campos, `${tabla}/${prohibido}`).not.toContain(prohibido);
      }
    }
  });

  it("y se sabe cuáles apuntan a personas, que es lo que decide contra qué tabla se comprueba", () => {
    expect(CAMPOS_DE_PERSONAL.departure_resource).toEqual(["staff"]);
    expect(CAMPOS_DE_PERSONAL.pickup_route).toEqual(["driver", "guide"]);
    // Y todo campo de personal es un campo que puede escribir: si no, se
    // comprobaría el dueño de algo que nunca llega a guardarse.
    for (const tabla of Object.keys(CAMPOS_DE_PERSONAL)) {
      for (const campo of CAMPOS_DE_PERSONAL[tabla]) {
        expect(CAMPOS_QUE_ASIGNA_EL_PROVEEDOR[tabla], `${tabla}/${campo}`).toContain(campo);
      }
    }
  });
});

describe("el payload de la asignación", () => {
  it("se construye ELIGIENDO de la lista blanca, no borrando", () => {
    /**
     * El día que estas tablas ganen una columna —un coste acordado, una nota de
     * la operadora— no se le abre sola. Con una lista de prohibidos, la columna
     * nueva habría sido escribible desde el portal sin que nadie lo decidiera.
     */
    const sucio = {
      vehicle: "v1", staff: "s1",
      pax_assigned: 30, status: "completed", cost: 0, supplier: "otro",
      acceptance: "accepted", campo_que_no_existia_ayer: "x",
    };
    expect(payloadDeAsignacion("recurso", sucio)).toEqual({ vehicle: "v1", staff: "s1" });
  });

  it("cada tipo admite lo suyo y no lo del otro", () => {
    expect(payloadDeAsignacion("ruta", { vehicle: "v1", driver: "d1", guide: "g1", staff: "s1" }))
      .toEqual({ vehicle: "v1", driver: "d1", guide: "g1" });
    expect(payloadDeAsignacion("recurso", { driver: "d1", guide: "g1" })).toEqual({});
  });

  it("NULO ES «QUÍTALO» Y AUSENTE ES «NO LO TOQUES»", () => {
    /**
     * Sin esa distinción, un transportista no podría retirar la guagua que se le
     * acaba de averiar: mandar `null` se leería como «no cambies nada» y la
     * asignación vieja seguiría ahí, con el despacho creyendo que sale.
     */
    expect(payloadDeAsignacion("recurso", { vehicle: null })).toEqual({ vehicle: null });
    expect(payloadDeAsignacion("recurso", { vehicle: "" })).toEqual({ vehicle: null });
    expect(payloadDeAsignacion("recurso", { staff: "s1" })).toEqual({ staff: "s1" });
    expect(payloadDeAsignacion("recurso", {})).toEqual({});
  });

  it("y los dos tipos apuntan a las dos tablas de despacho", () => {
    expect(TABLA_DEL_TIPO).toEqual({ recurso: "departure_resource", ruta: "pickup_route" });
  });
});
