import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  verifyMembegoToken, membegoSignature, verifyMembegoWebhook, mapMembegoRole,
  canLinkCompanies, parseMembegoEvent, clienteFromPayload, membresiaFromPayload, splitNombre,
  EVENTOS_ATENDIDOS, atiendeEvento, estadoDeMembresia, camposDeMembresia,
} from "@/lib/membego";

/**
 * VECTOR OFICIAL del contrato de MembeGo (docs/INTEGRACIONES.md de ese repo):
 * con el secreto literal `secreto-de-prueba`, este payload produce exactamente
 * este token. El contrato lo publica para que el satélite se autoverifique sin
 * depender de MembeGo: si esta suite lo rechaza, el fallo es NUESTRO.
 */
const SECRETO = "secreto-de-prueba";
const TOKEN_OFICIAL =
  "eyJzdWIiOiI2MjNkNjQyYy1hZTVmLTQ0NWEtOTllYi0yMjBiNTVlYjBlMWMiLCJlbWFpbCI6ImR1ZW5vQGVqZW1wbG8uY29tIiwicm9sIjoiQURNSU5fRU1QUkVTQSIsImNvbXBhbnlJZCI6ImNtcmUxaHo1NzAwMDBqcDA0YWQ1aTByb2kiLCJleHAiOjE5MDAwMDAwMDB9." +
  "02d8a44d97acc2b4eee1804fbb0a78b351adee9ad8018c335888fe08ac8bc326";
/** Antes del exp del vector (17 de marzo de 2030). */
const ANTES_DE_EXP = new Date("2029-01-01T00:00:00Z");

function firmar(payload: Record<string, unknown>, secreto = SECRETO): string {
  const cuerpo = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const firma = createHmac("sha256", secreto).update(cuerpo, "utf8").digest("hex");
  return `${cuerpo}.${firma}`;
}

describe("el token SSO de MembeGo", () => {
  it("acepta el vector oficial del contrato", () => {
    const datos = verifyMembegoToken(TOKEN_OFICIAL, SECRETO, ANTES_DE_EXP);
    expect(datos).toMatchObject({
      sub: "623d642c-ae5f-445a-99eb-220b55eb0e1c",
      email: "dueno@ejemplo.com",
      rol: "ADMIN_EMPRESA",
      companyId: "cmre1hz570000jp04ad5i0roi",
      exp: 1900000000,
    });
  });

  it("un token vencido no abre nada", () => {
    expect(verifyMembegoToken(TOKEN_OFICIAL, SECRETO, new Date("2031-01-01T00:00:00Z"))).toBeNull();
  });

  it("con otro secreto, la firma no cuadra", () => {
    expect(verifyMembegoToken(TOKEN_OFICIAL, "otro-secreto", ANTES_DE_EXP)).toBeNull();
  });

  it("una firma manipulada se rechaza aunque tenga la longitud correcta", () => {
    const dot = TOKEN_OFICIAL.lastIndexOf(".");
    const firma = TOKEN_OFICIAL.slice(dot + 1);
    const alterada = (firma[0] === "0" ? "1" : "0") + firma.slice(1);
    expect(verifyMembegoToken(TOKEN_OFICIAL.slice(0, dot + 1) + alterada, SECRETO, ANTES_DE_EXP)).toBeNull();
  });

  it("un JWT de tres partes falla limpio: esto no es un JWT", () => {
    expect(verifyMembegoToken(`cabecera.${TOKEN_OFICIAL}`, SECRETO, ANTES_DE_EXP)).toBeNull();
  });

  it("sin sub o sin companyId no hay a quién abrirle sesión", () => {
    const exp = 1900000000;
    expect(verifyMembegoToken(firmar({ email: "a@b.c", companyId: "cmp", exp }), SECRETO, ANTES_DE_EXP)).toBeNull();
    expect(verifyMembegoToken(firmar({ sub: "u1", exp }), SECRETO, ANTES_DE_EXP)).toBeNull();
  });

  it("el jti viaja cuando viene: es lo que permite el canje único", () => {
    const datos = verifyMembegoToken(
      firmar({ sub: "u1", companyId: "cmp", exp: 1900000000, jti: "tok-1" }),
      SECRETO, ANTES_DE_EXP
    );
    expect(datos?.jti).toBe("tok-1");
  });

  it("token o secreto vacíos no verifican jamás", () => {
    expect(verifyMembegoToken(null, SECRETO)).toBeNull();
    expect(verifyMembegoToken(TOKEN_OFICIAL, "")).toBeNull();
    expect(verifyMembegoToken("sin-punto", SECRETO)).toBeNull();
  });
});

describe("la firma del webhook", () => {
  it("verifica sobre el cuerpo crudo exacto", () => {
    const cuerpo = '{"id":"evt_1","tipo":"cliente.registrado","companyId":"cmp_1","payload":{}}';
    expect(verifyMembegoWebhook(cuerpo, membegoSignature(SECRETO, cuerpo), SECRETO)).toBe(true);
  });

  it("re-serializar el JSON rompe la firma — por eso se firma el crudo", () => {
    const cuerpo = '{"a": 1, "b": 2}';
    const reserializado = JSON.stringify(JSON.parse(cuerpo));
    expect(reserializado).not.toBe(cuerpo);
    expect(verifyMembegoWebhook(reserializado, membegoSignature(SECRETO, cuerpo), SECRETO)).toBe(false);
  });

  it("sin cabecera o sin secreto, no pasa", () => {
    expect(verifyMembegoWebhook("{}", null, SECRETO)).toBe(false);
    expect(verifyMembegoWebhook("{}", "abc", "")).toBe(false);
  });
});

describe("el mapa de roles", () => {
  it("cada rol del contrato tiene destino", () => {
    expect(mapMembegoRole("ADMINISTRADOR")).toBe("admin");
    expect(mapMembegoRole("ADMIN_EMPRESA")).toBe("admin");
    expect(mapMembegoRole("GERENTE")).toBe("manager");
    expect(mapMembegoRole("SUPERVISOR")).toBe("operations");
    expect(mapMembegoRole("CAJERO")).toBe("cashier");
    expect(mapMembegoRole("RECEPCION")).toBe("cashier");
    expect(mapMembegoRole("EMPLEADO")).toBe("seller");
    expect(mapMembegoRole("MARKETING")).toBe("seller");
  });

  it("SUPERADMIN de MembeGo se acota a admin de la organización, nunca al superadmin local", () => {
    expect(mapMembegoRole("SUPERADMIN")).toBe("admin");
  });

  it("un rol desconocido cae al MÍNIMO, nunca al máximo — regla literal del contrato", () => {
    expect(mapMembegoRole("ROL_QUE_INVENTEN_MANANA")).toBe("seller");
    expect(mapMembegoRole(null)).toBe("seller");
    expect(mapMembegoRole("")).toBe("seller");
  });

  it("solo los roles de administración pueden vincular empresas", () => {
    expect(canLinkCompanies("ADMIN_EMPRESA")).toBe(true);
    expect(canLinkCompanies("ADMINISTRADOR")).toBe(true);
    expect(canLinkCompanies("SUPERADMIN")).toBe(true);
    expect(canLinkCompanies("GERENTE")).toBe(false);
    expect(canLinkCompanies("CAJERO")).toBe(false);
    expect(canLinkCompanies(null)).toBe(false);
  });
});

describe("el sobre del evento", () => {
  it("lee las claves clásicas del contrato", () => {
    const evento = parseMembegoEvent(JSON.stringify({
      id: "evt_1", tipo: "cliente.registrado", companyId: "cmp_1",
      payload: { clienteId: "cli_1" }, emitidoEn: "2026-08-03T19:40:12.345Z",
    }));
    expect(evento).toMatchObject({ id: "evt_1", tipo: "cliente.registrado", companyId: "cmp_1" });
    expect(evento?.payload.clienteId).toBe("cli_1");
  });

  it("cae al sobre v2 el día que retiren el legado", () => {
    const evento = parseMembegoEvent(JSON.stringify({
      eventId: "evt_2", eventType: "customer.registered", companyId: "cmp_1",
      data: { clienteId: "cli_2" }, occurredAt: "2026-08-03T19:40:12.345Z",
    }));
    expect(evento).toMatchObject({ id: "evt_2", tipo: "customer.registered" });
    expect(evento?.emitidoEn).toBe("2026-08-03T19:40:12.345Z");
  });

  it("un cuerpo sin id, tipo o empresa no es un evento", () => {
    expect(parseMembegoEvent("{}")).toBeNull();
    expect(parseMembegoEvent("no es json")).toBeNull();
    expect(parseMembegoEvent(JSON.stringify({ id: "e", tipo: "t" }))).toBeNull();
  });

  it("la ficha del cliente tolera los nulos que el contrato permite", () => {
    const ficha = clienteFromPayload({
      clienteId: "cli_1",
      cliente: { nombre: "Juan Pérez", email: null, telefono: "8095551234" },
    });
    expect(ficha).toEqual({ clienteId: "cli_1", nombre: "Juan Pérez", email: null, telefono: "8095551234" });
  });

  it("la membresía sale del payload cuando el tipo la trae", () => {
    const membresia = membresiaFromPayload({
      membresia: { id: "mem_1", planId: "pln_1", plan: "Plan Gold", esDePago: true, vigenteHasta: "2026-09-03T19:40:12.345Z" },
    });
    expect(membresia).toMatchObject({ id: "mem_1", planId: "pln_1", esDePago: true });
    expect(membresiaFromPayload({ compra: {} })).toBeNull();
  });
});

describe("el corte del nombre", () => {
  it("primera palabra nombre, el resto apellido", () => {
    expect(splitNombre("Juan Pérez")).toEqual({ first: "Juan", last: "Pérez" });
    expect(splitNombre("Ana María de la Cruz")).toEqual({ first: "Ana", last: "María de la Cruz" });
    expect(splitNombre("Cher")).toEqual({ first: "Cher", last: null });
    expect(splitNombre("  ")).toEqual({ first: null, last: null });
  });
});

/**
 * LOS EVENTOS QUE CIERRAN UN CICLO.
 *
 * MembeGo reenvía once tipos; este satélite atendía siete. Los cuatro que
 * faltaban no rompían nada —llegaban, respondían 200 y se archivaban como
 * `ignored`—, y por eso el fallo era invisible: el espejo decía «Plan Oro» de
 * una membresía cancelada y «Juan, 809-555-0100» de alguien que cambió de
 * número hace un mes, con toda la seguridad de un dato escrito a propósito.
 *
 * Estas pruebas vigilan la CAUSA, no el síntoma: que la lista siga completa y
 * que la baja no borre lo que no viene en su payload.
 */
describe("los once eventos que MembeGo reenvía", () => {
  /**
   * La lista de `EVENTOS_REENVIADOS` del `nucleo.ts` de MembeGo, copiada aquí
   * porque vive en otro repositorio. Si allá añaden uno, esta prueba no puede
   * enterarse sola — pero sí impide que alguien recorte los que ya se atienden,
   * que es como se perdieron los cuatro la primera vez.
   */
  const REENVIADOS = [
    "cliente.registrado", "cliente.actualizado", "cliente.eliminado",
    "cliente.primera_visita", "cliente.visita",
    "cliente.compro_servicio", "cliente.primera_compra",
    "membresia.activada", "membresia.cancelada", "membresia.vencida",
    "referido.convirtio",
  ];

  it("se atienden TODOS, no solo los del alta", () => {
    for (const tipo of REENVIADOS) {
      expect(atiendeEvento(tipo), `${tipo} llegaría y no haría nada`).toBe(true);
    }
    expect([...EVENTOS_ATENDIDOS].sort()).toEqual([...REENVIADOS].sort());
  });

  it("un tipo desconocido no se atiende, pero tampoco es un error", () => {
    // El webhook responde 200 y lo archiva: devolver error por un evento nuevo
    // mandaría a la DEAD_LETTER de MembeGo a quien hace lo correcto.
    expect(atiendeEvento("promocion.creada")).toBe(false);
    expect(atiendeEvento("")).toBe(false);
  });
});

describe("el estado de la membresía en el espejo", () => {
  it("los tres eventos de membresía dicen un estado distinto", () => {
    expect(estadoDeMembresia("membresia.activada")).toBe("active");
    expect(estadoDeMembresia("membresia.cancelada")).toBe("cancelled");
    expect(estadoDeMembresia("membresia.vencida")).toBe("expired");
  });

  it("un evento que no es de membresía no toca el estado", () => {
    // Null y no "active": una visita no puede revivir una membresía cancelada.
    expect(estadoDeMembresia("cliente.visita")).toBeNull();
    expect(estadoDeMembresia("cliente.registrado")).toBeNull();
  });
});

describe("los campos de la membresía que se escriben", () => {
  const ALTA = {
    membresia: {
      id: "mem_1", planId: "plan_oro", plan: "Plan Oro",
      esDePago: true, vigenteHasta: "2027-01-01T00:00:00.000Z",
    },
  };
  /** Lo que MembeGo manda de verdad al cancelar: la membresía, no la ficha. */
  const BAJA = { membresia: { id: "mem_1", planId: "plan_oro", estado: "CANCELADA" } };

  it("el alta escribe las cinco", () => {
    expect(camposDeMembresia(membresiaFromPayload(ALTA))).toEqual({
      membership_id: "mem_1",
      plan_id: "plan_oro",
      plan_name: "Plan Oro",
      membership_paid: true,
      membership_valid_until: "2027-01-01T00:00:00.000Z",
    });
  });

  it("LA BAJA NO BORRA EL NOMBRE DEL PLAN NI LA VIGENCIA", () => {
    // El fallo que esto impide: en un upsert, una clave ausente conserva su
    // valor y una clave en null lo pisa. Escribir los nulls de este payload
    // dejaría el espejo diciendo «cancelada» sin poder decir CUÁL.
    const campos = camposDeMembresia(membresiaFromPayload(BAJA));
    expect(campos).toEqual({ membership_id: "mem_1", plan_id: "plan_oro" });
    expect(campos).not.toHaveProperty("plan_name");
    expect(campos).not.toHaveProperty("membership_valid_until");
    expect(campos).not.toHaveProperty("membership_paid");
  });

  it("sin bloque de membresía no se escribe ningún campo suyo", () => {
    // Una visita no habla de la membresía: su upsert no puede tocarla.
    expect(camposDeMembresia(membresiaFromPayload({ clienteId: "c1" }))).toEqual({});
    expect(camposDeMembresia(null)).toEqual({});
  });
});
