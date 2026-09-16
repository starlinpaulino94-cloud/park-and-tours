import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  NOTIFY_EVENTS, buildNotification, dedupeKeyFor, audienceRolesFor, inboxFilter,
  notificationForCreate, type NotifyEventKey,
} from "@/lib/notify";

const ROOT = path.resolve(__dirname, "../..");
const keys = Object.keys(NOTIFY_EVENTS) as NotifyEventKey[];

/**
 * La campana solo sirve mientras se pueda confiar en ella. Estas pruebas
 * defienden las tres cosas que la rompen: un aviso que no se entiende, un aviso
 * que no lleva a ninguna parte y un aviso que le llega a quien no le importa.
 */

describe("el catálogo", () => {
  it("cada aviso se entiende sin datos, que es como llega la mitad", () => {
    // Un aviso escrito con plantillas se queda en «Nueva reserva undefined» en
    // cuanto falta un campo, y eso es exactamente lo que ve quien lo lee.
    for (const key of keys) {
      const built = buildNotification(key, {});
      expect(built.title, key).not.toMatch(/undefined|null|NaN/);
      expect(built.message, key).not.toMatch(/undefined|null|NaN/);
      expect(built.title.length, `${key}: título vacío`).toBeGreaterThan(3);
    }
  });

  it("cada aviso lleva a una pantalla que existe", () => {
    /**
     * Un enlace roto en un aviso es peor que no poner enlace: quien lo pulsa
     * cae en un 404 justo cuando el sistema le acaba de decir que algo pasó.
     * Se comprueba contra el árbol de rutas, así que renombrar una pantalla
     * rompe esta prueba antes que la bandeja de un cliente.
     */
    for (const key of keys) {
      const link = buildNotification(key, {}).link.split("?")[0];
      const page = path.join(ROOT, "src/app", link, "page.tsx");
      expect(existsSync(page), `${key}: ${link} no existe como pantalla`).toBe(true);
    }
  });

  it("el tipo es uno de los que la base acepta", () => {
    // La columna tiene un CHECK: un tipo nuevo aquí y sin migración no escribe
    // nada, y el aviso se pierde en silencio.
    const permitidos = ["info", "booking", "payment", "operation", "alert", "settlement"];
    for (const key of keys) {
      expect(permitidos, key).toContain(buildNotification(key, {}).notification_type);
    }
  });

  it("el destinatario es un rol real del sistema", () => {
    const roles = ["owner", "admin", "manager", "operations", "cashier", "seller"];
    for (const key of keys) {
      expect(roles, key).toContain(buildNotification(key, {}).audience_role);
    }
  });

  it("los datos se escriben en el texto cuando los hay", () => {
    const built = buildNotification("booking_created", {
      referencia: "BK-1024", producto: "Isla Saona", fecha: "20/09/2026", pax: 4,
    });
    expect(built.title).toContain("BK-1024");
    expect(built.message).toContain("Isla Saona");
    expect(built.message).toContain("4");
  });

  it("el dinero sale con su moneda y dos decimales", () => {
    // «Reembolso de 1250.5» no dice de qué moneda, y en una operadora que cobra
    // en dólares y pesos esa diferencia es de sesenta a uno.
    const built = buildNotification("payment_refunded", { monto: 1250.5, moneda: "dop" });
    expect(built.title).toContain("DOP");
    expect(built.title).toMatch(/1[.,]250[.,]50/);
  });
});

describe("no repetirse", () => {
  it("la misma entidad y el mismo evento dan la misma clave", () => {
    // Es lo que impide que el cron diario deje siete copias de cada deuda.
    expect(dedupeKeyFor("receivable_overdue", { entityId: "r1" }))
      .toBe(dedupeKeyFor("receivable_overdue", { entityId: "r1" }));
  });

  it("distinta entidad, distinta clave", () => {
    expect(dedupeKeyFor("receivable_overdue", { entityId: "r1" }))
      .not.toBe(dedupeKeyFor("receivable_overdue", { entityId: "r2" }));
  });

  it("la semilla separa lo que no tiene entidad", () => {
    // El aviso del plan se repite una vez al mes por métrica, no una sola vez
    // en la vida de la empresa.
    expect(dedupeKeyFor("plan_limit_near", { seed: "max_users:2026-09" }))
      .not.toBe(dedupeKeyFor("plan_limit_near", { seed: "max_users:2026-10" }));
  });

  it("el mismo aviso a dos personas no se pisa", () => {
    expect(dedupeKeyFor("quote_accepted", { entityId: "q1", userId: "u1" }))
      .not.toBe(dedupeKeyFor("quote_accepted", { entityId: "q1", userId: "u2" }));
  });
});

describe("a quién le llega", () => {
  it("el dueño alcanza todos los destinos", () => {
    expect(audienceRolesFor("owner")).toContain("seller");
    expect(audienceRolesFor("owner")).toContain("owner");
  });

  it("un vendedor no ve lo que es del gerente", () => {
    // El descuadre de caja de anoche no es asunto del vendedor, y llenarle la
    // bandeja de lo que no puede resolver es cómo se deja de mirar la campana.
    const suyos = audienceRolesFor("seller");
    expect(suyos).toEqual(["seller"]);
    expect(suyos).not.toContain("manager");
  });

  it("caja y operaciones tienen el mismo alcance, como en el resto del sistema", () => {
    expect(audienceRolesFor("cashier")).toEqual(audienceRolesFor("operations"));
  });

  it("un rol desconocido no se lleva nada", () => {
    // Fallar hacia el silencio: un rol nuevo mal escrito no puede convertirse
    // en «lo ve todo».
    expect(audienceRolesFor("marciano")).toEqual([]);
  });

  it("el buzón trae lo propio, lo sin rol y lo de su alcance", () => {
    const filtro = inboxFilter("u1", "manager") as { _or: Record<string, unknown>[] };
    expect(filtro._or[0]).toEqual({ user_id: "u1" });
    // Los avisos escritos antes de 0044 no tienen rol: siguen viéndose, porque
    // perderlos sería perder correo por cambiar de buzón.
    expect(filtro._or[1]).toEqual({ user_id: null, audience_role: null });
    expect(filtro._or[2]).toEqual({ user_id: null, audience_role: { in: ["manager", "operations", "cashier", "seller"] } });
  });
});

describe("los avisos del ERP genérico", () => {
  it("un incidente avisa, con su gravedad y su lugar", () => {
    const aviso = notificationForCreate("incident", {
      _id: "i1", title: "Caída en la piscina", severity: "high", location: "Zona norte",
    })!;
    expect(aviso.event).toBe("incident_opened");
    expect(aviso.entityId).toBe("i1");
    const built = buildNotification(aviso.event, aviso.vars);
    expect(built.title).toContain("Caída en la piscina");
    expect(built.message).toContain("Zona norte");
  });

  it("todo lo demás no avisa: un aviso por fila creada vacía la campana de sentido", () => {
    for (const table of ["customer", "booking", "product", "task", "payment"]) {
      expect(notificationForCreate(table, { _id: "x" }), table).toBeNull();
    }
  });
});
