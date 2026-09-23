import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  NOTIFY_EVENTS, buildNotification, dedupeKeyFor, audienceRolesFor, inboxFilter,
  notificationForCreate, puedeMarcar, type NotifyEventKey,
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

  it("el destinatario es un rol real del sistema, o el tour center", () => {
    /**
     * DOS DESTINOS, Y SE ESCRIBEN EN COLUMNAS DISTINTAS.
     *
     * Los seis roles van a `audience_role`, que tiene un CHECK desde 0044: un
     * valor nuevo aquí sin migración no escribe nada y el aviso se pierde en
     * silencio.
     *
     * `partner` NO es uno de ellos y por eso NO puede acabar en esa columna:
     * va por identificador, en `notification.partner_id`. Dentro de un tour
     * center todos los accesos son iguales por construcción (0073), así que
     * repartir por rango allí no significaría nada.
     */
    const roles = ["owner", "admin", "manager", "operations", "cashier", "seller"];
    for (const key of keys) {
      expect([...roles, "partner"], key).toContain(buildNotification(key, {}).audience_role);
    }
  });

  it("un aviso de socio NO alcanza a nadie por rango", () => {
    /**
     * La red de seguridad del punto anterior: aunque «partner» se colara en la
     * columna de rol, ningún rol interno lo alcanza — ni el dueño. Un aviso que
     * empieza por «te pagamos la liquidación» no se lee desde el lado que paga.
     */
    for (const role of ["owner", "admin", "manager", "operations", "cashier", "seller", "superadmin"]) {
      expect(audienceRolesFor(role), role).not.toContain("partner");
    }
  });

  it("los avisos del socio apuntan al PORTAL, no al panel", () => {
    // Un enlace a `/dashboard/...` desde la bandeja del socio es un enlace a
    // una pantalla a la que el portal le cierra la puerta: `esDeSocio` lo
    // devuelve a `/portal` y el aviso se queda sin sitio donde llevarlo.
    const deSocio = keys.filter((k) => buildNotification(k, {}).audience_role === "partner");
    expect(deSocio.length, "no hay eventos de socio en el catálogo").toBeGreaterThan(0);
    for (const key of deSocio) {
      expect(buildNotification(key, {}).link, key).toMatch(/^\/portal\//);
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
    const filtro = inboxFilter({ userId: "u1", role: "manager", esDeSocio: false }) as
      { _or: Record<string, unknown>[]; partner_id: unknown };
    expect(filtro._or[0]).toEqual({ user_id: "u1" });
    // Los avisos escritos antes de 0044 no tienen rol: siguen viéndose, porque
    // perderlos sería perder correo por cambiar de buzón.
    expect(filtro._or[1]).toEqual({ user_id: null, audience_role: null });
    expect(filtro._or[2]).toEqual({ user_id: null, audience_role: { in: ["manager", "operations", "cashier", "seller"] } });
    // Y no las copias del socio: cada hecho que importa a los dos escribe dos
    // avisos, así que dejarlas pasar duplicaría la campana.
    expect(filtro.partner_id).toBeNull();
  });
});

describe("marcar un aviso como leído", () => {
  const interno = { userId: "u1", role: "manager", esDeSocio: false };
  const socio = { userId: "u9", role: "seller", esDeSocio: true, partnerId: "s-1" };
  const otroSocio = { userId: "u8", role: "seller", esDeSocio: true, partnerId: "s-2" };

  it("el personal solo marca el suyo", () => {
    expect(puedeMarcar({ user_id: "u1" }, interno)).toBe(true);
    expect(puedeMarcar({ user_id: "u2" }, interno)).toBe(false);
  });

  it("UN AVISO DE SOCIO NO LO MARCA CUALQUIERA", () => {
    /**
     * EL AGUJERO QUE ESTO CIERRA.
     *
     * La ruta comprobaba «`user_id` nulo ⇒ es de empresa ⇒ vale». Los avisos de
     * un tour center también tienen `user_id` nulo, así que esa regla dejaba
     * que un interno —y, peor, OTRO tour center— se los marcara como leídos y
     * se los borrara de la campana antes de que él los viera.
     */
    expect(puedeMarcar({ partner_id: "s-1" }, socio)).toBe(true);
    expect(puedeMarcar({ partner_id: "s-1" }, otroSocio)).toBe(false);
    expect(puedeMarcar({ partner_id: "s-1" }, interno)).toBe(false);
  });

  it("sin ficha de socio no se marca ningún aviso de socio", () => {
    // Fallar hacia el silencio, igual que en la bandeja.
    expect(puedeMarcar({ partner_id: "s-1" }, { userId: "u7", role: "partner", esDeSocio: true })).toBe(false);
  });

  it("el aviso de empresa es del personal, no del socio", () => {
    // Quien es de un tour center ya no lo ve en su bandeja; marcarlo sería
    // poder tocar lo que no se puede leer.
    expect(puedeMarcar({ user_id: null, partner_id: null }, interno)).toBe(true);
    expect(puedeMarcar({ user_id: null, partner_id: null }, socio)).toBe(false);
  });

  it("lo personal gana: un aviso con dueño es de su dueño y de nadie más", () => {
    expect(puedeMarcar({ user_id: "u9", partner_id: "s-2" }, socio)).toBe(true);
    expect(puedeMarcar({ user_id: "u1", partner_id: "s-1" }, socio)).toBe(false);
  });
});

describe("el buzón del tour center", () => {
  it("LO SUYO Y LO DE SU EMPRESA, y nada de la operadora", () => {
    /**
     * EL FALLO QUE ESTO CIERRA, POR LOS DOS LADOS.
     *
     * Hacia dentro: el cajón de `audience_role is null` —los avisos anteriores
     * a 0044— lo alcanzaba cualquiera, y para un miembro de un tour center eso
     * es la bandeja interna de la operadora.
     *
     * Hacia fuera: los avisos dirigidos a un socio llevan `partner_id` y no
     * llevan rol, así que por rango no los habría alcanzado nunca — ni con el
     * rango más alto.
     */
    const filtro = inboxFilter({ userId: "u9", role: "seller", esDeSocio: true, partnerId: "s-1" }) as
      { _or: Record<string, unknown>[]; partner_id?: unknown };
    expect(filtro._or).toEqual([{ user_id: "u9" }, { partner_id: "s-1" }]);
    // Ni el cajón sin rol ni el de rango aparecen por ninguna parte.
    expect(JSON.stringify(filtro)).not.toContain("audience_role");
  });

  it("se reconoce por la ficha, no por el nombre del rol", () => {
    // Es el mismo criterio que `esDeSocio`: un empleado de un tour center con
    // otro rol pasaba de largo cuando el aislamiento miraba el nombre.
    const porFicha = inboxFilter({ userId: "u1", role: "seller", esDeSocio: true, partnerId: "s-1" }) as
      { _or: Record<string, unknown>[] };
    expect(porFicha._or).toEqual([{ user_id: "u1" }, { partner_id: "s-1" }]);
  });

  it("sin identificador de socio NO le toca ningún aviso de socio", () => {
    /**
     * Fallar hacia el silencio. Lo contrario —caer en el buzón interno— le
     * daría a un usuario marcado como de socio, pero sin ficha, la bandeja de
     * la operadora entera.
     */
    const filtro = inboxFilter({ userId: "u1", role: "partner", esDeSocio: true }) as
      { _or: Record<string, unknown>[] };
    expect(filtro._or).toEqual([{ user_id: "u1" }]);
    expect(JSON.stringify(filtro)).not.toContain("audience_role");
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
