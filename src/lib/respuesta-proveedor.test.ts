import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";
import { fakeSupabase, type FakeSupabase } from "@/test/fake-supabase";

/**
 * QUE EL PROVEEDOR CONTESTE, POR LOS DOS CAMINOS.
 *
 * Lo que se prueba aquí es lo que pasa EN LA BASE y en la bitácora, no que se
 * llame a nada: si el enlace se guarda en claro, si una respuesta fuera de
 * plazo entra igual, si el rechazo avisa, si el barrido acepta por su cuenta lo
 * que nadie pactó.
 *
 * Lo que NO se prueba aquí es la función de Postgres que gasta el enlace: eso
 * vive en `supabase/tests/supplier_acceptance.test.sql`, porque su razón de ser
 * —que las dos escrituras pasen juntas o ninguna— no existe fuera de una
 * transacción de verdad. Aquí se comprueba que se la llama bien.
 */

let db: FakeDb;
let sb: FakeSupabase;
let rpc: ReturnType<typeof vi.fn>;

const auditar = vi.fn();
const avisar = vi.fn();

vi.mock("@/lib/audit", () => ({ writeAudit: (...a: unknown[]) => auditar(...a) }));
vi.mock("@/lib/notify-service", () => ({ notify: (...a: unknown[]) => avisar(...a) }));
vi.mock("@/lib/supabase/service", () => ({
  supabaseService: () => new Proxy(sb as object, {
    get(target, prop) {
      if (prop === "rpc") return rpc;
      return Reflect.get(target, prop);
    },
  }),
}));

import {
  emitirEnlaceDeRespuesta, abrirEnlace, responderConEnlace,
  responderDesdeElPortal, barrerVencimientos,
} from "@/lib/respuesta-proveedor";
import { hashDeEnlace } from "@/lib/enlace-proveedor";

const ORG = "org-1";
const PROV = "prov-1";
const AHORA = new Date("2026-07-15T12:00:00.000Z");

function base() {
  const d = fakeDb({
    organizations: [{ _id: ORG, name: "Operadora" }],
    supplier: [
      { _id: PROV, organization_id: ORG, name: "Transporte Bávaro", on_deadline_expiry: "alert" },
      { _id: "prov-2", organization_id: ORG, name: "Guaguas del Este", on_deadline_expiry: "tacit" },
    ],
    product: [{ _id: "p-1", organization_id: ORG, name: "Isla Saona" }],
    departure: [{
      _id: "d-1", organization_id: ORG, product: "p-1",
      departure_at: "2026-07-16T07:00:00.000Z", meeting_point: "Lobby",
    }],
    departure_resource: [{
      _id: "dr-1", organization_id: ORG, supplier: PROV, departure: "d-1",
      service_date: "2026-07-16T07:00:00.000Z", resource_role: "vehicle", pax_assigned: 40,
      status: "confirmed", acceptance: "pending",
      acceptance_deadline: "2026-07-16T07:00:00.000Z",
      responded_at: null, responded_via: null, response_note: null, confirmation_number: null,
      cost: 900, notes: "el chofer llegó tarde dos veces",
    }],
    pickup_route: [],
    supplier_response_token: [],
  });
  return d;
}

/**
 * Cambiar la fila POR EL SERVICIO, no tocando lo que devuelve `db.rows`.
 *
 * `rows()` entrega COPIAS, así que escribir en ellas no cambia nada y la prueba
 * pasa sin haber probado el caso —y además pasa por el motivo contrario al que
 * se cree—. Costó cuatro pruebas verdes que no lo estaban.
 */
const cambiar = (datos: Record<string, unknown>, tabla = "departure_resource", id = "dr-1") =>
  db.tenantUpdate(ORG, tabla, id, datos);

beforeEach(() => {
  db = base();
  sb = fakeSupabase(db);
  rpc = vi.fn(async () => ({ data: { ok: true, resource_kind: "departure_resource", resource_id: "dr-1", answer: "accepted", confirmation_number: "CNF-2607-ABCDEF" }, error: null }));
  auditar.mockClear();
  avisar.mockClear();
});

describe("emitir el enlace de un clic", () => {
  it("EN LA BASE QUEDA EL HASH, NUNCA EL ENLACE", async () => {
    /**
     * Es la diferencia con el token de la encuesta, que sí se guarda a secas.
     * Si esta tabla se filtra entera —una copia de seguridad, un volcado mal
     * guardado— los enlaces que contiene no sirven para nada.
     */
    const { url } = await emitirEnlaceDeRespuesta(ORG, "departure_resource", "dr-1", AHORA);
    const token = url.split("/").pop()!;
    const guardadas = db.rows("supplier_response_token");
    expect(guardadas).toHaveLength(1);
    expect(JSON.stringify(guardadas), "el enlace está guardado en claro")
      .not.toContain(decodeURIComponent(token));
    expect(guardadas[0].token_hash).toBe(hashDeEnlace(decodeURIComponent(token)));
  });

  it("y caduca CON LA SALIDA", async () => {
    const { expiresAt } = await emitirEnlaceDeRespuesta(ORG, "departure_resource", "dr-1", AHORA);
    // El plazo de la fila es la hora de la salida; un enlace que la sobreviva
    // sirve para aceptar el martes lo que pasó el lunes.
    expect(expiresAt).toBe("2026-07-16T07:00:00.000Z");
  });

  it("UN SERVICIO, UN ENLACE VIVO", async () => {
    /**
     * Si se manda otro por WhatsApp porque el correo no llegó, el primero deja
     * de valer en ese momento. Con dos vivos, «de un solo uso» dejaría de ser
     * verdad por la vía de tener dos usos.
     */
    const primero = await emitirEnlaceDeRespuesta(ORG, "departure_resource", "dr-1", AHORA);
    await emitirEnlaceDeRespuesta(ORG, "departure_resource", "dr-1", AHORA);
    const hashPrimero = hashDeEnlace(decodeURIComponent(primero.url.split("/").pop()!));
    const viejo = db.rows("supplier_response_token").find((t) => t.token_hash === hashPrimero);
    expect(viejo?.revoked_at, "el enlace anterior sigue vivo").toBeTruthy();
    const vivos = db.rows("supplier_response_token").filter((t) => !t.revoked_at && !t.used_at);
    expect(vivos).toHaveLength(1);
  });

  it("no se emite para lo que no está esperando respuesta", async () => {
    await cambiar({ acceptance: "accepted" });
    await expect(emitirEnlaceDeRespuesta(ORG, "departure_resource", "dr-1", AHORA)).rejects.toThrow();
    expect(db.rows("supplier_response_token")).toHaveLength(0);
  });
});

describe("abrir el enlace", () => {
  async function conEnlace() {
    const { url } = await emitirEnlaceDeRespuesta(ORG, "departure_resource", "dr-1", AHORA);
    auditar.mockClear();
    return decodeURIComponent(url.split("/").pop()!);
  }

  it("se ANOTA cada apertura, incluida la de un enlace que no existe", async () => {
    /**
     * El intento fallido es el que más dice: cuarenta aperturas de un enlace
     * inexistente desde la misma dirección son alguien probando. Una auditoría
     * que solo apunta los aciertos no sirve para verlo.
     */
    await abrirEnlace("esto-no-existe", AHORA);
    expect(auditar).toHaveBeenCalledTimes(1);
    expect(auditar.mock.calls[0][0]).toMatchObject({
      action: "supplier.link.open", severity: "warning",
    });
  });

  it("y el recuento sube aunque el enlace ya no sirva", async () => {
    const token = await conEnlace();
    await db.tenantUpdate(ORG, "supplier_response_token",
      String(db.rows("supplier_response_token")[0]._id), { revoked_at: AHORA.toISOString() });
    const vista = await abrirEnlace(token, AHORA);
    expect(vista.ok).toBe(false);
    expect(vista.motivo).toBe("revoked");
    // Si solo contara las válidas, un enlace revocado abierto cien veces se
    // vería igual que uno que nadie tocó.
    expect(db.rows("supplier_response_token")[0].opened_count).toBe(1);
  });

  it("ABRIR NO ES USAR", async () => {
    // El robot que previsualiza el enlace en WhatsApp lo abre. Si eso lo
    // gastara, el proveedor recibiría un enlace ya quemado.
    const token = await conEnlace();
    await abrirEnlace(token, AHORA);
    await abrirEnlace(token, AHORA);
    expect(db.rows("supplier_response_token")[0].used_at).toBeFalsy();
    expect(db.rows("supplier_response_token")[0].opened_count).toBe(2);
  });

  it("NI UN DATO DE PASAJERO, Y NADA DE LO QUE SE LE PAGA", async () => {
    const token = await conEnlace();
    const vista = await abrirEnlace(token, AHORA);
    const texto = JSON.stringify(vista);
    expect(texto).toContain("Isla Saona");
    expect(texto, "el coste de su línea no es de esta pantalla").not.toContain("900");
    expect(texto, "las notas internas tampoco").not.toContain("llegó tarde");
  });

  it("un enlace de un servicio reasignado NO vale", async () => {
    const token = await conEnlace();
    await cambiar({ supplier: "prov-2" });
    const vista = await abrirEnlace(token, AHORA);
    expect(vista.motivo).toBe("reassigned");
  });

  it("y pasado el plazo se dice, enseñando el servicio igual", async () => {
    const token = await conEnlace();
    const tarde = new Date("2026-07-16T08:00:00.000Z");
    const vista = await abrirEnlace(token, tarde);
    expect(vista.ok).toBe(false);
    expect(vista.motivo).toBe("expired");
  });
});

describe("contestar desde el portal", () => {
  it("acepta, con su número de confirmación", async () => {
    const hecho = await responderDesdeElPortal(
      ORG, PROV, "departure_resource", "dr-1", "accepted", null, "u-1", AHORA
    );
    expect(hecho.ok).toBe(true);
    expect(hecho.confirmation_number).toMatch(/^CNF-/);
    const fila = db.rows("departure_resource")[0];
    expect(fila.acceptance).toBe("accepted");
    expect(fila.responded_via).toBe("portal");
    expect(fila.responded_by).toBe("u-1");
  });

  it("EL RECHAZO NO EMITE NÚMERO", async () => {
    // Un número de confirmación con un rechazo sería un papel que dice que hay
    // conformidad de lo que nadie aceptó.
    const hecho = await responderDesdeElPortal(
      ORG, PROV, "departure_resource", "dr-1", "rejected", "se me dañó la guagua", "u-1", AHORA
    );
    expect(hecho.ok).toBe(true);
    expect(hecho.confirmation_number).toBeNull();
    expect(db.rows("departure_resource")[0].confirmation_number).toBeNull();
  });

  it("y el rechazo AVISA a la casa; la aceptación no", async () => {
    /**
     * Un aviso por cada servicio aceptado convertiría la campana en ruido y a
     * la semana nadie la abre. El rechazo es lo que deja a alguien sin guagua
     * esta tarde.
     */
    await responderDesdeElPortal(ORG, PROV, "departure_resource", "dr-1", "rejected", null, null, AHORA);
    expect(avisar).toHaveBeenCalledTimes(1);
    expect(avisar.mock.calls[0][0]).toMatchObject({ event: "supplier_service_rejected" });

    avisar.mockClear();
    await cambiar({ acceptance: "pending" });
    await responderDesdeElPortal(ORG, PROV, "departure_resource", "dr-1", "accepted", null, null, AHORA);
    expect(avisar).not.toHaveBeenCalled();
  });

  it("EL DE AL LADO NO CONTESTA POR ÉL", async () => {
    const hecho = await responderDesdeElPortal(
      ORG, "prov-2", "departure_resource", "dr-1", "accepted", null, null, AHORA
    );
    expect(hecho.ok).toBe(false);
    expect(db.rows("departure_resource")[0].acceptance).toBe("pending");
  });

  it("y dos veces no son dos respuestas", async () => {
    await responderDesdeElPortal(ORG, PROV, "departure_resource", "dr-1", "accepted", null, null, AHORA);
    const numero = db.rows("departure_resource")[0].confirmation_number;
    const otra = await responderDesdeElPortal(
      ORG, PROV, "departure_resource", "dr-1", "rejected", null, null, AHORA
    );
    expect(otra.ok).toBe(false);
    expect(otra.motivo).toBe("already_answered");
    // Y el número no cambió: el segundo clic no reescribe nada.
    expect(db.rows("departure_resource")[0].confirmation_number).toBe(numero);
  });

  it("contestar por el portal MATA el enlace que se le mandó", async () => {
    await emitirEnlaceDeRespuesta(ORG, "departure_resource", "dr-1", AHORA);
    await responderDesdeElPortal(ORG, PROV, "departure_resource", "dr-1", "accepted", null, null, AHORA);
    expect(db.rows("supplier_response_token")[0].revoked_at).toBeTruthy();
  });
});

describe("contestar con el enlace", () => {
  it("se llama a la función de Postgres con el HASH, no con el enlace", async () => {
    await responderConEnlace("un-enlace-cualquiera", "accepted", null);
    expect(rpc).toHaveBeenCalledWith("respond_to_supplier_service", expect.objectContaining({
      p_token_hash: hashDeEnlace("un-enlace-cualquiera"),
      p_answer: "accepted",
    }));
    const args = rpc.mock.calls[0][1] as Record<string, string>;
    expect(JSON.stringify(args)).not.toContain("un-enlace-cualquiera");
  });

  it("y un enlace vacío ni llega a preguntar", async () => {
    const hecho = await responderConEnlace("   ", "accepted", null);
    expect(hecho).toEqual({ ok: false, motivo: "not_found" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("el motivo que devuelve la función se respeta", async () => {
    rpc.mockResolvedValueOnce({ data: { ok: false, reason: "already_used" }, error: null });
    expect(await responderConEnlace("x", "accepted", null)).toEqual({ ok: false, motivo: "already_used" });
  });
});

describe("el plazo que vence", () => {
  const TARDE = new Date("2026-07-16T09:00:00.000Z");

  it("por defecto se marca VENCIDO y se avisa: nadie acepta por nadie", async () => {
    const barrido = await barrerVencimientos(ORG, TARDE);
    expect(barrido).toEqual({ vencidos: 1, aceptadosPorSilencio: 0 });
    const fila = db.rows("departure_resource")[0];
    expect(fila.acceptance).toBe("expired");
    expect(fila.confirmation_number, "un vencimiento no emite conformidad").toBeNull();
    expect(avisar.mock.calls[0][0]).toMatchObject({ event: "supplier_service_expired" });
  });

  it("y quien tenga pactado el silencio, acepta — con rastro de que nadie contestó", async () => {
    await cambiar({ supplier: "prov-2" });   // su política es «tacit»
    const barrido = await barrerVencimientos(ORG, TARDE);
    expect(barrido).toEqual({ vencidos: 0, aceptadosPorSilencio: 1 });
    const fila = db.rows("departure_resource")[0];
    expect(fila.acceptance).toBe("accepted");
    expect(fila.responded_via, "parecería que contestó él").toBe("tacito");
    expect(avisar.mock.calls[0][0]).toMatchObject({ event: "supplier_service_tacit" });
  });

  it("no toca lo que todavía está en plazo", async () => {
    const barrido = await barrerVencimientos(ORG, AHORA);
    expect(barrido).toEqual({ vencidos: 0, aceptadosPorSilencio: 0 });
    expect(db.rows("departure_resource")[0].acceptance).toBe("pending");
  });

  it("y correrlo dos veces no avisa dos veces", async () => {
    await barrerVencimientos(ORG, TARDE);
    avisar.mockClear();
    const segundo = await barrerVencimientos(ORG, TARDE);
    expect(segundo).toEqual({ vencidos: 0, aceptadosPorSilencio: 0 });
    expect(avisar).not.toHaveBeenCalled();
  });
});
