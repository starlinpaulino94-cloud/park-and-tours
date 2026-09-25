import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import type { OutboxStore } from "@/lib/messaging/outbox";
import type { FuenteDelManifiesto } from "@/lib/manifest-service";
import {
  destinatariosDeLaSalida, enviarManifiesto, publicoDePersona,
} from "@/lib/manifiesto-envio-service";

/**
 * A QUIÉN LE LLEGA EL MANIFIESTO, Y CON QUÉ RECORTE.
 *
 * Todo lo que se prueba aquí se prueba SIN base de datos, porque la fuente y la
 * bandeja son parámetros. Eso no es comodidad de la prueba: es lo que permite
 * que el cron —que no tiene sesión— lea con la llave de servicio en vez de leer
 * cero filas y decir que no había nada que mandar.
 */

vi.mock("server-only", () => ({}));

const SALIDA = "2026-03-11T11:00:00Z";
const AHORA = new Date("2026-03-10T12:00:00Z");

/**
 * El reloj se fija para TODO el módulo, no solo para el parámetro.
 *
 * `enqueueMessage` mira la hora por su cuenta —tiene que hacerlo: decide si un
 * aviso atado a una fecha ya caducó—, así que pasarle un `ahora` al envío y
 * dejar el reloj real corriendo por debajo hacía que la prueba dijera «el
 * momento del aviso ya pasó» para una salida que en su propio calendario es de
 * mañana. Es exactamente el tipo de prueba que pasa en enero y falla en marzo.
 */
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
});
afterAll(() => vi.useRealTimers());
const EMPRESA = { _id: "c1", name: "Park and Tours" } as never;

/** La bandeja de mentira: guarda lo que se encoló y respeta el dedupe. */
function bandeja() {
  const filas: Record<string, unknown>[] = [];
  const store: OutboxStore = {
    pending: async () => [],
    update: async () => {},
    create: async (_companyId, data) => {
      const clave = data.dedupe_key as string | undefined;
      if (clave && filas.some((f) => f.dedupe_key === clave)) {
        throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
      }
      const fila = { ...data, _id: `m${filas.length + 1}` };
      filas.push(fila);
      return { _id: fila._id as string };
    },
    // Vacío a propósito: así se usan las plantillas que trae el sistema, que son
    // las que de verdad van a salir en una empresa que no reescribió nada.
    templates: async () => [],
    findByDedupe: async (_c, clave) => {
      const f = filas.find((x) => x.dedupe_key === clave);
      return f ? { _id: f._id as string } : null;
    },
  };
  return { store, filas };
}

const guiaDeLaCasa = {
  id: "st-guia", _id: "st-guia", full_name: "Luis Guía", staff_type: "guide",
  email: "luis@operadora.com", phone: "8095550001", status: "active", supplier_id: null,
};
const chofer = {
  id: "st-chofer", _id: "st-chofer", full_name: "Pedro Chofer", staff_type: "driver",
  email: "pedro@transporte.com", phone: "8095550002", status: "active", supplier_id: "sup-1",
};
const transporte = {
  id: "sup-1", _id: "sup-1", name: "Transporte del Este", contact_name: "Oficina Este",
  email: "ops@transporte.com", phone: "8095559999", status: "active",
};

function fuente(over: Partial<FuenteDelManifiesto> = {}): FuenteDelManifiesto {
  return {
    salida: async () => ({
      _id: "dep-1", departure_at: SALIDA, status: "confirmed",
      capacity: 20, meeting_point: "Lobby",
      product: { _id: "p1", name: "Isla Saona" },
      departure_resource: [{ _id: "dr1", vehicle: { _id: "v1", plate: "A123456", capacity: 15 } }],
      pickup_route: [],
    }),
    reservas: async () => [
      {
        _id: "b1", booking_number: "R-001", status: "confirmed",
        adults: 2, children: 0, infants: 0, balance_amount: 40, currency: "usd",
        pickup_time: "07:30", room_number: "412",
        customer: { first_name: "Ana", last_name: "García", phone: "8095550101" },
        pickup_hotel: { name: "Bahía Príncipe", zone: { name: "Bávaro" } },
      } as never,
    ],
    equipo: async () => ({
      recursos: [{ _id: "dr1", resource_role: "guide", staff: guiaDeLaCasa, supplier: null }],
      rutas: [{ _id: "pr1", driver: chofer, guide: null, supplier: transporte, acceptance: "accepted" }],
    }),
    ...over,
  };
}

describe("el guía de la casa y el guía prestado no son el mismo público", () => {
  it("un guía sin proveedor detrás cobra a bordo: va por el corte de guía", () => {
    expect(publicoDePersona(guiaDeLaCasa, "guide")).toBe("guia");
  });

  it("un guía PRESTADO por una empresa de transporte va por el corte de chofer", () => {
    /**
     * Hace el mismo trabajo y no es quien cobra. Sin esta distinción, «guía»
     * habría querido decir «alguien autorizado a pedirle dinero al cliente en
     * nombre de la operadora».
     */
    expect(publicoDePersona({ ...guiaDeLaCasa, supplier_id: "sup-1" }, "guide")).toBe("chofer");
  });

  it("el chofer es chofer diga lo que diga la asignación", () => {
    expect(publicoDePersona(chofer, "driver")).toBe("chofer");
    expect(publicoDePersona({ ...chofer, supplier_id: null }, "driver")).toBe("chofer");
  });

  it("lo que hace ESE DÍA manda sobre lo que hace normalmente", () => {
    // Al fotógrafo que ese día va de guía se le asignó como guía, y es la
    // asignación la que describe el trabajo del día.
    const fotografo = { ...guiaDeLaCasa, staff_type: "photographer" };
    expect(publicoDePersona(fotografo, "guide")).toBe("guia");
    expect(publicoDePersona(fotografo, null)).toBe("chofer");
  });
});

describe("los destinatarios de una salida", () => {
  it("son el guía, el chofer y la oficina del proveedor, cada uno con su corte", () => {
    return destinatariosDeLaSalida("c1", "dep-1", fuente()).then((d) => {
      expect(d.map((x) => x.publico).sort()).toEqual(["chofer", "guia", "proveedor"]);
    });
  });

  it("QUIEN RECHAZÓ EL ENCARGO NO RECIBE LA LISTA", async () => {
    /**
     * Es la mitad que faltaba de la aceptación de 0087: sin esto, decir «no» no
     * quitaba ningún acceso y el proveedor seguía recibiendo los clientes de un
     * servicio que no va a operar.
     */
    for (const acceptance of ["rejected", "expired"]) {
      const d = await destinatariosDeLaSalida("c1", "dep-1", fuente({
        equipo: async () => ({
          recursos: [],
          rutas: [{ _id: "pr1", driver: null, guide: null, supplier: transporte, acceptance }],
        }),
      }));
      expect(d.map((x) => x.publico), acceptance).not.toContain("proveedor");
    }
  });

  it("y quien aceptó, o a quien no se le pidió, SÍ", async () => {
    for (const acceptance of ["accepted", "pending", "not_required", null]) {
      const d = await destinatariosDeLaSalida("c1", "dep-1", fuente({
        equipo: async () => ({
          recursos: [],
          rutas: [{ _id: "pr1", driver: null, guide: null, supplier: transporte, acceptance }],
        }),
      }));
      expect(d.map((x) => x.publico), String(acceptance)).toContain("proveedor");
    }
  });

  it("una ficha dada de baja no recibe el manifiesto de mañana", async () => {
    const d = await destinatariosDeLaSalida("c1", "dep-1", fuente({
      equipo: async () => ({
        recursos: [{ _id: "dr1", resource_role: "guide", staff: { ...guiaDeLaCasa, status: "inactive" } }],
        rutas: [{ _id: "pr1", supplier: { ...transporte, status: "inactive" }, acceptance: "accepted" }],
      }),
    }));
    expect(d).toEqual([]);
  });

  it("quien no tiene ni correo ni teléfono no se encola: sería una fila fallida por pasada", async () => {
    const d = await destinatariosDeLaSalida("c1", "dep-1", fuente({
      equipo: async () => ({
        recursos: [{ _id: "dr1", resource_role: "guide", staff: { ...guiaDeLaCasa, email: null, phone: null } }],
        rutas: [],
      }),
    }));
    expect(d).toEqual([]);
  });

  it("el mismo chofer asignado dos veces es UNA persona y un mensaje", async () => {
    const d = await destinatariosDeLaSalida("c1", "dep-1", fuente({
      equipo: async () => ({
        recursos: [{ _id: "dr1", resource_role: "driver", staff: chofer }],
        rutas: [{ _id: "pr1", driver: chofer, guide: null, supplier: null }],
      }),
    }));
    expect(d).toHaveLength(1);
  });
});

describe("el envío", () => {
  it("encola correo y WhatsApp para cada destinatario", async () => {
    const { store, filas } = bandeja();
    const envio = await enviarManifiesto(EMPRESA, "c1", "dep-1", AHORA, store, fuente());

    expect(envio.veto).toBeNull();
    // Tres destinatarios por dos canales.
    expect(envio.encolados).toBe(6);
    expect(filas.filter((f) => f.channel === "email")).toHaveLength(3);
    expect(filas.filter((f) => f.channel === "whatsapp")).toHaveLength(3);
    for (const fila of filas) expect(fila.template_key).toBe("manifest_dispatch");
  });

  it("EL CORREO LLEVA EL PAPEL, Y DICE PARA QUIÉN SE RECORTA", async () => {
    /**
     * `attachment_scope` es lo único que el despachador tiene para saber qué
     * corte generar: el PDF no se guarda, se compone al entregar. Sin ese dato
     * en la fila, el manifiesto saldría entero.
     */
    const { store, filas } = bandeja();
    await enviarManifiesto(EMPRESA, "c1", "dep-1", AHORA, store, fuente());

    const correos = filas.filter((f) => f.channel === "email");
    expect(correos).toHaveLength(3);
    for (const correo of correos) {
      expect(correo.attachment_kind).toBe("manifest");
      expect(["guia", "chofer", "proveedor"]).toContain(correo.attachment_scope);
    }
    // Uno de cada corte, y no tres veces el mismo.
    expect(correos.map((c) => c.attachment_scope).sort()).toEqual(["chofer", "guia", "proveedor"]);
  });

  it("y el WhatsApp NO lleva papel ni recorte", async () => {
    // Pedirle un adjunto a un WhatsApp de texto solo produce un fallo de entrega
    // en cada envío; y un recorte guardado sin adjunto invita a leerlo como «a
    // quién va el mensaje», que ya dice `to_address`.
    const { store, filas } = bandeja();
    await enviarManifiesto(EMPRESA, "c1", "dep-1", AHORA, store, fuente());
    for (const fila of filas.filter((f) => f.channel === "whatsapp")) {
      expect(fila.attachment_kind).toBeUndefined();
      expect(fila.attachment_scope).toBeUndefined();
    }
  });

  it("el cuerpo del mensaje NO lleva el nombre de ningún cliente", async () => {
    /**
     * La lista nominal viaja en el PDF y en ningún otro sitio. El cuerpo se lee
     * en la pantalla de bloqueo y se reenvía de un grupo a otro sin pensarlo.
     */
    const { store, filas } = bandeja();
    await enviarManifiesto(EMPRESA, "c1", "dep-1", AHORA, store, fuente());
    for (const fila of filas) {
      const cuerpo = String(fila.body || "");
      expect(cuerpo).not.toContain("Ana");
      expect(cuerpo).not.toContain("García");
      expect(cuerpo).not.toContain("412");
      expect(cuerpo).not.toContain("8095550101");
      // Y sí lleva lo que hace falta para trabajar.
      expect(cuerpo).toContain("Isla Saona");
      expect(cuerpo).toContain("Bahía Príncipe");
      expect(cuerpo).toContain("A123456");
    }
  });

  it("QUIEN SOLO TIENE UN CANAL RECIBE POR ESE, Y NO SE GUARDA UNA FILA FALLIDA", async () => {
    /**
     * `enqueueMessage` no descarta lo que no puede entregar: lo guarda FALLIDO
     * con el motivo escrito, que para un aviso a un cliente es lo correcto —la
     * empresa ve el dato que falta y lo arregla—. Para el manifiesto no: el
     * barrido pasa todos los días y el chofer que no tiene correo generaría una
     * fila fallida por pasada hasta que la bandeja fuera ilegible.
     *
     * Y encima no hace falta: lo que no sale por un canal sale por el otro, que
     * es justo por lo que hay dos.
     */
    const { store, filas } = bandeja();
    const envio = await enviarManifiesto(EMPRESA, "c1", "dep-1", AHORA, store, fuente({
      equipo: async () => ({
        recursos: [{ _id: "dr1", resource_role: "driver", staff: { ...chofer, email: null } }],
        rutas: [{ _id: "pr1", driver: null, guide: null, supplier: { ...transporte, phone: null } }],
      }),
    }));

    expect(envio.encolados).toBe(2);
    expect(envio.sinSalida, "se guardó una fila fallida por un canal que no existe").toEqual([]);
    // El chofer sin correo, por WhatsApp; la oficina sin teléfono, por correo.
    // (El WhatsApp no lleva recorte guardado porque no lleva adjunto.)
    expect(filas.map((f) => `${f.to_name}/${f.channel}`).sort())
      .toEqual(["Oficina Este/email", "Pedro Chofer/whatsapp"]);
  });

  it("mandarlo dos veces sin que cambie la lista NO vuelve a escribir a nadie", async () => {
    const { store, filas } = bandeja();
    await enviarManifiesto(EMPRESA, "c1", "dep-1", AHORA, store, fuente());
    const primera = filas.length;

    const otra = await enviarManifiesto(EMPRESA, "c1", "dep-1", AHORA, store, fuente());
    expect(otra.encolados).toBe(0);
    expect(otra.duplicados).toBe(primera);
    expect(filas).toHaveLength(primera);
  });

  it("pero si entra una reserva, SALE OTRA VEZ", async () => {
    /**
     * El fallo que esto evita: manifiesto mandado a las 6, reserva a las 14, y
     * el chofer sale con una lista a la que le falta gente — que es peor que no
     * haberla mandado, porque cree que la tiene.
     */
    const { store, filas } = bandeja();
    const base = fuente();
    await enviarManifiesto(EMPRESA, "c1", "dep-1", AHORA, store, base);
    const primera = filas.length;

    const conUnaMas = fuente({
      reservas: async () => [
        ...(await base.reservas("c1", "dep-1")),
        {
          _id: "b2", booking_number: "R-002", status: "confirmed",
          adults: 2, children: 0, infants: 0, pickup_time: "08:00",
          customer: { first_name: "Beto", last_name: "Pérez" },
          pickup_hotel: { name: "Meliá", zone: { name: "Bávaro" } },
        } as never,
      ],
    });
    const segunda = await enviarManifiesto(EMPRESA, "c1", "dep-1", AHORA, store, conUnaMas);
    expect(segunda.encolados).toBe(primera);
    expect(segunda.huella).not.toBe(filas[0].dedupe_key);
  });

  it("una salida cancelada no manda su lista a nadie, y lo dice", async () => {
    const { store, filas } = bandeja();
    const envio = await enviarManifiesto(EMPRESA, "c1", "dep-1", AHORA, store, fuente({
      salida: async () => ({ _id: "dep-1", departure_at: SALIDA, status: "cancelled", product: null }),
    }));
    expect(envio.veto).toContain("cancelled");
    expect(envio.encolados).toBe(0);
    expect(filas).toEqual([]);
  });

  it("la ventana se comprueba AQUÍ, no solo en el barrido", async () => {
    // Una llamada manual desde la pantalla pasa por la misma regla: si no, el
    // botón sería una puerta para mandar el manifiesto de una salida de dentro
    // de tres semanas.
    const { store, filas } = bandeja();
    const lejos = new Date("2026-03-01T12:00:00Z");
    const envio = await enviarManifiesto(EMPRESA, "c1", "dep-1", lejos, store, fuente());
    expect(envio.veto).toContain("36");
    expect(filas).toEqual([]);
  });

  it("una salida que nadie opera lo dice en vez de callarse", async () => {
    // «No se mandó» sin motivo es la respuesta que obliga a la operadora a abrir
    // la base de datos.
    const { store } = bandeja();
    const envio = await enviarManifiesto(EMPRESA, "c1", "dep-1", AHORA, store, fuente({
      equipo: async () => ({ recursos: [], rutas: [] }),
    }));
    expect(envio.veto).toContain("Nadie");
  });

  it("queda apuntado en la fila de qué salida es", async () => {
    // Es lo que permite responder «¿se le mandó el manifiesto a este chofer?»
    // sin leer el cuerpo de cada mensaje.
    const { store, filas } = bandeja();
    await enviarManifiesto(EMPRESA, "c1", "dep-1", AHORA, store, fuente());
    for (const fila of filas) expect(fila.departure).toBe("dep-1");
  });
});
