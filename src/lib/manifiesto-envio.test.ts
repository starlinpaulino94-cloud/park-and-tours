import { describe, it, expect } from "vitest";
import {
  CAMPOS_DEL_MANIFIESTO, PUBLICOS_DEL_MANIFIESTO, incluye,
  recortarFila, recortarManifiesto, recortarParadas, recortarResumen,
  huellaDeLaSalida, claveDeEnvio, vetoDeEnvio, paradasParaWhatsapp,
  VENTANA_DE_ENVIO_HORAS, MAXIMO_DE_PARADAS_EN_WHATSAPP,
  type PublicoDelManifiesto,
} from "@/lib/manifiesto-envio";
import { manifestRow, pickupStops, paxSummary, type ManifestRow } from "@/lib/manifest";

/**
 * EL MANIFIESTO ES EL DOCUMENTO CON MÁS DATOS DE TERCEROS DEL SISTEMA.
 *
 * Nombre, teléfono, correo, habitación, idioma, nacionalidad y lo que cada uno
 * debe. Mandarlo entero a una empresa de transporte no es un descuido de estilo:
 * es entregarle la cartera de clientes de la operadora con el saldo dentro, y
 * además exactamente lo que necesita para llamarlos el año que viene por su
 * cuenta.
 */

const reserva = (over: Record<string, unknown> = {}) =>
  manifestRow({
    _id: "b1",
    booking_number: "R-001",
    voucher_code: "V-001",
    adults: 2, children: 1, infants: 0,
    balance_amount: 40, currency: "usd",
    pickup_time: "07:30",
    room_number: "412",
    internal_notes: "cliente conflictivo, no dar el número del guía",
    notes: "silla de ruedas",
    customer: {
      first_name: "Ana", last_name: "García",
      phone: "809-555-0101", whatsapp: "809-555-0101",
      email: "ana@example.com", language: "es", nationality: "ES",
    },
    pickup_hotel: { name: "Bahía Príncipe", zone: { name: "Bávaro" } },
    partner: { name: "Tour Center Cortecito" },
    ...over,
  } as never);

/** Los campos que NUNCA pueden salir de la casa, y a quién sí le tocan. */
const PROHIBIDOS: Record<PublicoDelManifiesto, string[]> = {
  interno: [],
  guia: ["email", "sold_by", "notes"],
  chofer: ["email", "sold_by", "notes", "balance", "paid", "currency", "voucher_code"],
  proveedor: [
    "email", "sold_by", "notes", "balance", "paid", "currency", "voucher_code",
    "lead_name", "phone", "room", "booking_id", "booking_number", "participants",
  ],
};

describe("el recorte del manifiesto", () => {
  it("es una lista de PERMITIDOS, no de prohibidos", () => {
    /**
     * La diferencia importa el día que `manifestRow` gane un campo nuevo —el
     * documento de identidad, la alergia, el número de vuelo—: con una lista de
     * permitidos ese campo NO sale hasta que alguien lo escriba a mano; con una
     * de prohibidos habría salido solo.
     *
     * Se comprueba estructuralmente: un campo inventado que la fila trae y que
     * nadie declaró no puede aparecer en ningún recorte de fuera.
     */
    const conCampoNuevo = { ...reserva(), pasaporte: "X1234567" } as unknown as ManifestRow;
    for (const publico of PUBLICOS_DEL_MANIFIESTO.filter((p) => p !== "interno")) {
      expect(Object.keys(recortarFila(publico, conCampoNuevo)), publico).not.toContain("pasaporte");
    }
  });

  it("le da a la operación todo lo que la fila sabe", () => {
    const fila = reserva();
    expect(Object.keys(recortarFila("interno", fila)).sort()).toEqual(Object.keys(fila).sort());
  });

  it("no le manda a nadie de fuera lo que no le toca", () => {
    const fila = reserva();
    for (const publico of PUBLICOS_DEL_MANIFIESTO) {
      const recortada = recortarFila(publico, fila);
      for (const prohibido of PROHIBIDOS[publico]) {
        expect(recortada, `${publico} no puede ver ${prohibido}`).not.toHaveProperty(prohibido);
        expect(incluye(publico, prohibido as never), `${publico}/${prohibido}`).toBe(false);
      }
    }
  });

  it("el guía SÍ lleva el saldo, porque cobra a bordo", () => {
    // Si no lo llevara, el cobro en la puerta dejaría de existir: el guía no
    // sabría a quién pedirle los 40 dólares que faltan.
    const g = recortarFila("guia", reserva());
    expect(g.balance).toBe(40);
    expect(g.currency).toBe("usd");
    expect(g.paid).toBe(false);
  });

  it("el chofer lleva nombre, habitación y teléfono, y NI UN número de dinero", () => {
    const c = recortarFila("chofer", reserva());
    // Lo que necesita para llamar a la puerta de la 412.
    expect(c.lead_name).toBe("Ana García");
    expect(c.room).toBe("412");
    expect(c.phone).toBe("809-555-0101");
    expect(c.pickup_time).toBe("07:30");
    // Un chofer ajeno cobrando en la puerta es dinero que no vuelve.
    expect(c).not.toHaveProperty("balance");
  });

  it("la oficina del proveedor NO lleva ningún nombre de cliente", () => {
    /**
     * Es la distinción entre `chofer` y `proveedor`, y es la que evita que la
     * cartera de clientes de la operadora acabe archivada en el ordenador de una
     * empresa de transporte. La oficina planifica vehículos: le hace falta
     * cuánta gente sube dónde, no cómo se llama.
     */
    const p = recortarFila("proveedor", reserva());
    expect(p).not.toHaveProperty("lead_name");
    expect(p).not.toHaveProperty("phone");
    expect(p).not.toHaveProperty("room");
    expect(p.seats).toBe(3);
    expect(p.pickup_hotel).toBe("Bahía Príncipe");
    expect(p.pickup_time).toBe("07:30");
    // La silla de ruedas sí: cambia el vehículo que tiene que mandar.
    expect(p.requirements).toContain("silla de ruedas");
  });

  it("y las notas internas no salen ni para el guía", () => {
    const fila = reserva();
    expect(fila.notes).toContain("no dar el número del guía");
    for (const publico of ["guia", "chofer", "proveedor"] as const) {
      expect(recortarFila(publico, fila), publico).not.toHaveProperty("notes");
    }
  });

  it("recorta TODAS las filas y no solo la primera", () => {
    const filas = [reserva(), reserva({ _id: "b2", booking_number: "R-002" })];
    const recortadas = recortarManifiesto("proveedor", filas);
    expect(recortadas).toHaveLength(2);
    for (const r of recortadas) expect(r).not.toHaveProperty("lead_name");
  });
});

describe("el recorte llega hasta el fondo", () => {
  it("una parada lleva reservas DENTRO, y también se recortan", () => {
    /**
     * `pickup_stops` agrupa por hotel y hora y se queda las reservas de cada
     * parada dentro. Mandar las paradas «tal cual» habría entregado por la
     * puerta de atrás justo lo que la lista blanca quita por la de delante — el
     * mismo fallo que un recorte que solo mira el primer nivel.
     */
    const paradas = pickupStops([reserva(), reserva({ _id: "b2" })]);
    expect(paradas[0].bookings.length).toBeGreaterThan(0);

    const recortadas = recortarParadas("proveedor", paradas);
    expect(recortadas[0].bookings.length).toBe(paradas[0].bookings.length);
    for (const b of recortadas[0].bookings) {
      expect(b).not.toHaveProperty("lead_name");
      expect(b).not.toHaveProperty("phone");
      expect(b).not.toHaveProperty("balance");
    }
    // Y lo que la parada sí dice se conserva: sin esto el recorte sería inútil.
    expect(recortadas[0].hotel).toBe("Bahía Príncipe");
    expect(recortadas[0].seats).toBe(6);
  });

  it("el dinero del resumen va atado al MISMO permiso que el de la fila", () => {
    /**
     * `to_collect` es la misma información sumada. Quitar `balance` de las filas
     * y dejar la cifra en la cabecera habría publicado lo mismo de una vez, y
     * encima con pinta de estar recortado.
     */
    const resumen = paxSummary([reserva()]);
    expect(resumen.to_collect).toBe(40);

    expect(recortarResumen("guia", resumen).to_collect).toBe(40);
    for (const publico of ["chofer", "proveedor"] as const) {
      const r = recortarResumen(publico, resumen);
      expect(r.to_collect, publico).toBe(0);
      expect(r.to_collect_by_currency, publico).toEqual({});
      // Y lo que sí puede ver sigue ahí: un resumen sin plazas no sirve.
      expect(r.seats, publico).toBe(3);
    }
  });
});

describe("la huella de lo que se mandó", () => {
  it("cambia cuando entra una reserva", () => {
    // El fallo que esto evita: manifiesto mandado a las 6, reserva a las 14, y
    // el chofer sale con una lista a la que le falta gente.
    const antes = huellaDeLaSalida([reserva()]);
    const despues = huellaDeLaSalida([reserva(), reserva({ _id: "b2" })]);
    expect(despues).not.toBe(antes);
  });

  it("cambia cuando se mueve una recogida", () => {
    expect(huellaDeLaSalida([reserva({ pickup_time: "08:15" })]))
      .not.toBe(huellaDeLaSalida([reserva()]));
  });

  it("cambia cuando cambia la habitación", () => {
    // El chofer llama a una puerta concreta: la habitación es trabajo suyo.
    expect(huellaDeLaSalida([reserva({ room_number: "512" })]))
      .not.toBe(huellaDeLaSalida([reserva()]));
  });

  it("NO cambia porque alguien suba al vehículo", () => {
    /**
     * El embarque se marca durante la propia salida. Si contara, cada pasajero
     * que sube mandaría un manifiesto nuevo al chofer que lo está marcando.
     */
    expect(huellaDeLaSalida([reserva({ checkin_status: "picked_up", checked_in_pax: 3 })]))
      .toBe(huellaDeLaSalida([reserva()]));
  });

  it("NO cambia porque se cobre el saldo: el cobro no mueve la ruta", () => {
    expect(huellaDeLaSalida([reserva({ balance_amount: 0 })]))
      .toBe(huellaDeLaSalida([reserva()]));
  });

  it("no depende del orden en que la base devuelva las filas", () => {
    // Sin ordenar, dos lecturas de la misma lista darían huellas distintas y
    // saldría un manifiesto nuevo en cada pasada del barrido.
    const a = [reserva(), reserva({ _id: "b2" })];
    expect(huellaDeLaSalida([...a].reverse())).toBe(huellaDeLaSalida(a));
  });
});

describe("la clave del envío", () => {
  it("separa públicos, canales y destinos", () => {
    const base = ["s1", "guia", "email", "ana@example.com", "abc123"] as const;
    const clave = claveDeEnvio(...base);
    expect(claveDeEnvio("s1", "chofer", "email", "ana@example.com", "abc123")).not.toBe(clave);
    expect(claveDeEnvio("s1", "guia", "whatsapp", "ana@example.com", "abc123")).not.toBe(clave);
    expect(claveDeEnvio("s1", "guia", "email", "otro@example.com", "abc123")).not.toBe(clave);
    expect(claveDeEnvio("s2", "guia", "email", "ana@example.com", "abc123")).not.toBe(clave);
    // Y la huella dentro: es lo que hace que una lista nueva vuelva a salir.
    expect(claveDeEnvio("s1", "guia", "email", "ana@example.com", "otra")).not.toBe(clave);
  });

  it("no distingue mayúsculas en el destino", () => {
    // El mismo buzón escrito de dos formas no son dos personas.
    expect(claveDeEnvio("s1", "guia", "email", "Ana@Example.com", "h"))
      .toBe(claveDeEnvio("s1", "guia", "email", "ana@example.com", "h"));
  });
});

describe("cuándo sale, y cuándo no", () => {
  const ahora = new Date("2026-03-10T12:00:00Z");
  const en = (horas: number) => new Date(ahora.getTime() + horas * 3_600_000).toISOString();

  it("sale lo que entra en la ventana", () => {
    expect(vetoDeEnvio({ departure_at: en(20), status: "confirmed" }, ahora)).toBeNull();
  });

  it("una salida cancelada no manda su lista de clientes a nadie", () => {
    expect(vetoDeEnvio({ departure_at: en(20), status: "cancelled" }, ahora)?.motivo)
      .toContain("cancelled");
    expect(vetoDeEnvio({ departure_at: en(20), status: "draft" }, ahora)).not.toBeNull();
  });

  it("una salida SIN FECHA no sale: lo que no se sabe no se abre", () => {
    expect(vetoDeEnvio({ departure_at: null, status: "confirmed" }, ahora)?.motivo)
      .toContain("fecha");
    expect(vetoDeEnvio({ departure_at: "mañana", status: "confirmed" }, ahora)).not.toBeNull();
  });

  it("lo que ya salió no se manda", () => {
    expect(vetoDeEnvio({ departure_at: en(-1), status: "confirmed" }, ahora)?.motivo)
      .toContain("pasó");
  });

  it("y lo que está lejos espera: la ventana es de 36 horas", () => {
    expect(VENTANA_DE_ENVIO_HORAS).toBe(36);
    // 36 y no 24 porque el barrido corre UNA VEZ AL DÍA: con 24 h la salida de
    // pasado mañana a primera hora se quedaría fuera y el proveedor no tendría
    // tiempo de asignar vehículo.
    expect(vetoDeEnvio({ departure_at: en(35), status: "confirmed" }, ahora)).toBeNull();
    expect(vetoDeEnvio({ departure_at: en(37), status: "confirmed" }, ahora)?.motivo)
      .toContain("36");
  });
});

describe("el resumen del WhatsApp", () => {
  const parada = (time: string, hotel: string, seats: number) =>
    ({ key: `${time}|${hotel}`, hotel, zone: "", time, sort: 0, seats, bookings: [] });

  it("lleva hotel, hora y cuánta gente", () => {
    const texto = paradasParaWhatsapp([parada("07:30", "Bahía Príncipe", 3)]);
    expect(texto).toContain("07:30");
    expect(texto).toContain("Bahía Príncipe");
    expect(texto).toContain("(3)");
  });

  it("y NUNCA el nombre de un cliente, ni para el chofer", () => {
    /**
     * El canal decide, no solo el público. Un WhatsApp se reenvía de un grupo a
     * otro sin pensarlo y una captura de pantalla viaja más lejos que un
     * adjunto: la lista nominal va en el PDF del correo y en ningún otro sitio.
     */
    const conReserva = pickupStops([reserva()]);
    const texto = paradasParaWhatsapp(conReserva);
    expect(texto).not.toContain("Ana");
    expect(texto).not.toContain("García");
    expect(texto).not.toContain("412");
    expect(texto).not.toContain("809-555-0101");
  });

  it("corta la lista larga en vez de mandar una pared de texto", () => {
    const muchas = Array.from({ length: 12 }, (_, i) => parada(`0${i % 9}:00`, `Hotel ${i}`, 2));
    const texto = paradasParaWhatsapp(muchas);
    expect(texto.split("\n")).toHaveLength(MAXIMO_DE_PARADAS_EN_WHATSAPP + 1);
    expect(texto).toContain("4 parada(s) más");
  });

  it("y dice algo cuando no hay recogidas", () => {
    // Un hueco vacío en la plantilla hace que `enqueueMessage` no mande el
    // mensaje: «faltan datos en la plantilla». El manifiesto de una salida en la
    // que todos llegan por su cuenta tiene que salir igual.
    expect(paradasParaWhatsapp([])).toContain("punto de encuentro");
  });
});

describe("la lista blanca no tiene agujeros", () => {
  it("todo público declara sus campos, y todos son campos de verdad", () => {
    const validos = new Set(CAMPOS_DEL_MANIFIESTO.interno);
    for (const publico of PUBLICOS_DEL_MANIFIESTO) {
      const campos = CAMPOS_DEL_MANIFIESTO[publico];
      expect(campos.length, publico).toBeGreaterThan(0);
      for (const campo of campos) expect(validos.has(campo), `${publico}/${campo}`).toBe(true);
      // Sin repetidos: un duplicado no rompe nada hoy y esconde una edición a
      // medias mañana.
      expect(new Set(campos).size, publico).toBe(campos.length);
    }
  });

  it("y ningún público de fuera ve más campos que la operación", () => {
    const interno = CAMPOS_DEL_MANIFIESTO.interno.length;
    for (const publico of PUBLICOS_DEL_MANIFIESTO.filter((p) => p !== "interno")) {
      expect(CAMPOS_DEL_MANIFIESTO[publico].length, publico).toBeLessThan(interno);
    }
  });
});
