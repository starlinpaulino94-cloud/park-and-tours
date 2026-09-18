import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  overallLevel, sortBySeverity, JOB_EXPECTATIONS, expectationFor, jobHealth, toleranceMs,
  humanAge, normalizeMessage, fingerprintOf, safeContext, safeMessage, ALLOWED_CONTEXT_KEYS,
  sortIncidents, incidentsLevel, REPEATED_IS_DOWN, type HealthCheck,
} from "@/lib/system-health";

const ahora = new Date("2026-09-18T12:00:00.000Z");
const hace = (h: number) => new Date(ahora.getTime() - h * 3_600_000).toISOString();

describe("el estado del conjunto", () => {
  it("es el PEOR de sus partes, nunca el promedio", () => {
    // Promediar diría «bien» con la base caída y nueve comprobaciones triviales
    // en verde. Una sola cosa rota basta para que el sistema no sirva.
    const checks: HealthCheck[] = [
      { key: "a", label: "A", level: "ok", detail: "" },
      { key: "b", label: "B", level: "down", detail: "" },
      { key: "c", label: "C", level: "ok", detail: "" },
    ];
    expect(overallLevel(checks)).toBe("down");
  });

  it("sin nada que comprobar no se inventa un problema", () => {
    expect(overallLevel([])).toBe("ok");
  });

  it("lo peor se enseña primero, que es el orden en que se atiende", () => {
    const orden = sortBySeverity([
      { key: "a", label: "A", level: "ok", detail: "" },
      { key: "b", label: "B", level: "degraded", detail: "" },
      { key: "c", label: "C", level: "down", detail: "" },
    ]).map((c) => c.level);
    expect(orden).toEqual(["down", "degraded", "ok"]);
  });
});

describe("los trabajos que corren solos", () => {
  const cobros = expectationFor("collections")!;

  it("no haberse ejecutado NUNCA es un fallo, no «aún no toca»", () => {
    const c = jobHealth(cobros, null, ahora);
    expect(c.level).toBe("down");
    // Y dice la consecuencia, no el nombre técnico: «collections lleva 30 h sin
    // ejecutarse» no le dice nada a quien lleva la operadora.
    expect(c.detail).toContain("recordatorios de saldo");
  });

  it("recién ejecutado está bien", () => {
    expect(jobHealth(cobros, { job: "collections", started_at: hace(5), status: "ok" }, ahora).level).toBe("ok");
  });

  it("demasiado tiempo sin correr es «con problemas», no «caído»", () => {
    // No impide vender hoy. Sin ese escalón intermedio todo sería verde o rojo,
    // y como no se pone en rojo un sistema que vende, acabaría en verde.
    const c = jobHealth(cobros, { job: "collections", started_at: hace(30), status: "ok" }, ahora);
    expect(c.level).toBe("degraded");
  });

  it("el margen evita que la pantalla se ponga roja cada madrugada", () => {
    // Un diario que corre a las 03:00 no está roto a las 03:05 porque el
    // servidor tardara en despertar. A la tercera falsa alarma nadie la mira.
    const justo = jobHealth(cobros, { job: "collections", started_at: hace(25), status: "ok" }, ahora);
    expect(justo.level).toBe("ok");
    expect(toleranceMs(cobros)).toBe(24 * 3_600_000 + 180 * 60_000);
  });

  it("si falló, lo dice con su motivo", () => {
    const c = jobHealth(
      cobros,
      { job: "collections", started_at: hace(2), status: "failed", error: "sin conexión con el proveedor" },
      ahora
    );
    expect(c.level).toBe("down");
    expect(c.detail).toContain("sin conexión con el proveedor");
  });

  it("UN TRABAJO COLGADO SE DETECTA, que es lo que un registro al terminar no puede ver", () => {
    // Empezó, nunca terminó. Si solo se escribiera al acabar, no habría fila
    // ninguna y parecería que sencillamente no le tocaba.
    const c = jobHealth(cobros, { job: "collections", started_at: hace(40), status: "running" }, ahora);
    expect(c.level).toBe("down");
    expect(c.detail).toContain("a medias");
  });

  it("pero uno que está corriendo ahora no es un fallo", () => {
    expect(
      jobHealth(cobros, { job: "collections", started_at: hace(1), status: "running" }, ahora).level
    ).toBe("ok");
  });
});

describe("todos los trabajos programados están vigilados", () => {
  /**
   * LA GUARDA QUE IMPORTA DE ESTE MÓDULO.
   *
   * Un cron nuevo se añade en `vercel.json` y empieza a correr sin que nadie
   * más se entere. Si no está declarado aquí, la pantalla de estado no lo mira
   * — y un trabajo que nadie mira es exactamente el que se rompe en silencio,
   * que es el problema que esta ola vino a resolver.
   */
  const vercel = JSON.parse(
    readFileSync(path.resolve(__dirname, "../../vercel.json"), "utf8")
  ) as { crons?: { path: string }[] };

  const programados = (vercel.crons ?? []).map((c) => c.path.replace("/api/cron/", ""));

  it("cada cron de vercel.json tiene su expectativa declarada", () => {
    const declarados = new Set(JOB_EXPECTATIONS.map((e) => e.job));
    const sinVigilar = programados.filter((j) => !declarados.has(j));
    expect(sinVigilar, "hay trabajos programados que nadie vigila").toEqual([]);
  });

  it("y no se vigila nada que ya no exista", () => {
    // Un trabajo que se quitó de vercel.json y sigue declarado aquí pondría la
    // pantalla en rojo para siempre por algo que nadie va a arreglar.
    const enVercel = new Set(programados);
    const fantasmas = JOB_EXPECTATIONS.map((e) => e.job).filter((j) => !enVercel.has(j));
    expect(fantasmas, "se vigilan trabajos que ya no están programados").toEqual([]);
  });

  it("y CADA UNO deja rastro al correr", () => {
    /**
     * Declarar la expectativa no sirve de nada si el trabajo no se apunta: la
     * pantalla diría «nunca se ha ejecutado» de algo que corre cada noche, y a
     * la tercera falsa alarma nadie la mira.
     *
     * Las dos mitades tienen que ir juntas, y por eso se comprueban juntas.
     */
    const sinRastro = programados.filter((job) => {
      const file = path.resolve(__dirname, `../app/api/cron/${job}/route.ts`);
      const src = readFileSync(file, "utf8");
      return !/startJobRun\(/.test(src) || !/finishJobRun\(/.test(src);
    });
    expect(sinRastro, "trabajos programados que corren sin dejar rastro").toEqual([]);
  });

  it("y apuntan el fallo cuando revientan", () => {
    // Un cron que falla en silencio es el caso que esta ola vino a resolver: se
    // sabe cuando un cliente dice que nunca le llegó su voucher.
    const mudos = programados.filter((job) => {
      const src = readFileSync(path.resolve(__dirname, `../app/api/cron/${job}/route.ts`), "utf8");
      return !/reportIncident\(/.test(src);
    });
    expect(mudos, "trabajos que fallan sin apuntar el incidente").toEqual([]);
  });

  it("cada uno dice qué se rompe si no corre", () => {
    for (const e of JOB_EXPECTATIONS) {
      expect(e.consequence.length, `${e.job} sin consecuencia`).toBeGreaterThan(20);
      expect(e.graceMinutes, `${e.job} sin margen`).toBeGreaterThan(0);
    }
  });
});

describe("la huella: qué errores son EL MISMO", () => {
  it("dos veces el mismo fallo sobre filas distintas son UN incidente", () => {
    // Sin esto, mil ocurrencias son mil filas y la pantalla es ilegible justo
    // el día que hay que leerla.
    const a = fingerprintOf("/api/orders", "No se pudo guardar la reserva 3f2a6b18-1111-4c2d-9e55-aaaaaaaaaaaa");
    const b = fingerprintOf("/api/orders", "No se pudo guardar la reserva 99887766-2222-4c2d-9e55-bbbbbbbbbbbb");
    expect(a).toBe(b);
  });

  it("pero dos fallos distintos NO se mezclan", () => {
    expect(fingerprintOf("/api/orders", "No se pudo guardar la reserva"))
      .not.toBe(fingerprintOf("/api/orders", "No se pudo cobrar el pago"));
  });

  it("ni el mismo fallo en dos sitios distintos", () => {
    expect(fingerprintOf("/api/orders", "tiempo agotado"))
      .not.toBe(fingerprintOf("/api/payments", "tiempo agotado"));
  });

  it("se borra todo lo que cambia entre ocurrencias", () => {
    expect(normalizeMessage("fila 3f2a6b18-1111-4c2d-9e55-aaaaaaaaaaaa")).toBe("fila <id>");
    expect(normalizeMessage("el 2026-09-18T03:00:00 falló")).toBe("el <fecha> falló");
    expect(normalizeMessage('columna "email" no existe')).toBe("columna <valor> no existe");
    expect(normalizeMessage("importe 12.345,60 rechazado")).toBe("importe <n> rechazado");
  });

  it("un mensaje larguísimo agrupa igual, por su principio", () => {
    const largo = "fallo al conectar " + "x".repeat(400);
    expect(fingerprintOf("s", largo)).toBe(fingerprintOf("s", largo + " y algo más"));
  });
});

describe("que no se cuele nada que no deba quedar escrito", () => {
  it("el contexto solo admite claves técnicas conocidas", () => {
    // Al revés de lo habitual: permitir lo conocido, no prohibir lo peligroso.
    // Una lista de prohibidos siempre se queda corta.
    const limpio = safeContext({
      method: "POST", status: 500,
      customer_email: "juan@ejemplo.do", nombre_cliente: "Juan Pérez", token: "secreto",
    });
    expect(limpio).toEqual({ method: "POST", status: 500 });
  });

  it("un correo no acaba escrito en un registro técnico", () => {
    expect(safeMessage("no se pudo avisar a juan.perez@ejemplo.do")).toBe("no se pudo avisar a <correo>");
  });

  it("sin mensaje no se guarda una fila vacía", () => {
    expect(safeMessage(null)).toBe("Error sin mensaje");
    expect(safeMessage(new Error("algo"))).toBe("algo");
  });

  it("la lista de claves permitidas no incluye nada personal", () => {
    for (const k of ALLOWED_CONTEXT_KEYS) {
      expect(k).not.toMatch(/mail|name|nombre|phone|tel|doc|address|token|key|password/i);
    }
  });
});

describe("los incidentes, ordenados como se atienden", () => {
  const fila = (o: Partial<Parameters<typeof sortIncidents>[0][number]> = {}) => ({
    fingerprint: "f", level: "error", occurrences: 1,
    last_seen_at: hace(1), status: "open", ...o,
  });

  it("las veces pesan MÁS que la fecha", () => {
    // Un fallo que ocurrió trescientas veces esta mañana importa más que uno que
    // ocurrió una vez hace diez minutos; ordenar por fecha lo enterraría.
    const orden = sortIncidents([
      fila({ fingerprint: "reciente", occurrences: 1, last_seen_at: hace(0.1) }),
      fila({ fingerprint: "repetido", occurrences: 300, last_seen_at: hace(3) }),
    ]).map((r) => r.fingerprint);
    expect(orden).toEqual(["repetido", "reciente"]);
  });

  it("lo resuelto va al final", () => {
    const orden = sortIncidents([
      fila({ fingerprint: "resuelto", status: "resolved", occurrences: 900 }),
      fila({ fingerprint: "abierto", status: "open", occurrences: 1 }),
    ]).map((r) => r.fingerprint);
    expect(orden).toEqual(["abierto", "resuelto"]);
  });

  it("un error abierto no tumba el sistema: lo deja «con problemas»", () => {
    expect(incidentsLevel([fila({ occurrences: 2 })])).toBe("degraded");
  });

  it("lo que sí lo tumba es que se esté repitiendo AHORA", () => {
    expect(incidentsLevel([fila({ occurrences: REPEATED_IS_DOWN })])).toBe("down");
  });

  it("un aviso no despierta a nadie", () => {
    expect(incidentsLevel([fila({ level: "warning", occurrences: 9999 })])).toBe("ok");
  });

  it("lo resuelto no cuenta", () => {
    expect(incidentsLevel([fila({ status: "resolved", occurrences: 9999 })])).toBe("ok");
  });
});

describe("la antigüedad se dice como la diría una persona", () => {
  it("aproximada a propósito: el minuto exacto no decide nada", () => {
    expect(humanAge(30_000)).toBe("menos de un minuto");
    expect(humanAge(20 * 60_000)).toBe("20 min");
    expect(humanAge(5 * 3_600_000)).toBe("5 h");
    expect(humanAge(72 * 3_600_000)).toBe("3 días");
  });
});
