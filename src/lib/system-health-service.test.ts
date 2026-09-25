import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";
import { fakeSupabase, type FakeSupabase } from "@/test/fake-supabase";

/**
 * LA COMPROBACIÓN DE SALUD, QUE NO TENÍA NINGUNA PRUEBA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ IMPORTA MÁS QUE OTROS MÓDULOS SIN PRUEBAS
 *
 * Es el módulo que decide si alguien se entera de que algo se rompió. Un fallo
 * aquí no se nota por sí mismo: se nota como el silencio del fallo de al lado —
 * el cron que lleva tres días sin correr y nadie sabe—, o como una alarma que
 * miente y que a la tercera vez se ignora.
 *
 * Y tiene dos reglas que se contradicen con lo que hace todo lo demás:
 *
 *   · **No puede tumbar lo que mide.** Que no se pueda apuntar una ejecución no
 *     puede impedir la ejecución; que no se pueda apuntar un incidente no puede
 *     convertir un fallo en dos.
 *   · **Pero tampoco puede callarse.** Tragarse un error y contestar «no hay
 *     nada» es exactamente lo que este módulo existe para evitar.
 *
 * El equilibrio entre esas dos es todo lo que se prueba aquí.
 */

let db: FakeDb;
let sb: FakeSupabase & { rpc: (...a: unknown[]) => Promise<{ data: unknown; error: unknown }> };
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
let rpcRespuesta: { data: unknown; error: unknown } = { data: null, error: null };

vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => sb }));

import {
  startJobRun, finishJobRun, withJobRun, reportIncident, healthReport,
} from "@/lib/system-health-service";
import { JOB_EXPECTATIONS } from "@/lib/system-health";

const AHORA = new Date("2026-04-10T12:00:00Z");
const haceHoras = (h: number) => new Date(AHORA.getTime() - h * 3_600_000).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
  db = fakeDb();
  rpcCalls.length = 0;
  rpcRespuesta = { data: { auth_hook: { exists: true, security_definer: true, has_search_path: true } }, error: null };
  const base = fakeSupabase(db);
  sb = Object.assign(base, {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return rpcRespuesta;
    },
  }) as typeof sb;
  db.seed("organizations", [{ _id: "org-1", name: "E2E" }]);
});

describe("el diario de trabajos", () => {
  it("la fila se abre AL EMPEZAR, no al terminar", async () => {
    /**
     * Una fila que se queda en 'running' es la única señal posible de un trabajo
     * colgado. Escribiendo solo al terminar, un trabajo que nunca termina no deja
     * rastro y parece que sencillamente no le tocaba correr.
     */
    const id = await startJobRun("collections");
    expect(id).toBeTruthy();
    const fila = db.row("job_run", { _id: id! })!;
    expect(fila.job).toBe("collections");
    expect(fila.trigger).toBe("cron");
  });

  it("y si NO se puede apuntar, el trabajo corre igual", async () => {
    // El diario es para saber qué pasó; si falla, lo que pasa es el trabajo.
    sb.breakWrites("job_run", "sin conexión");
    await expect(startJobRun("collections")).resolves.toBeNull();
  });

  it("cerrar sin identificador no escribe nada ni revienta", async () => {
    // Es lo que ocurre cuando el arranque del diario falló: el trabajo terminó y
    // no hay fila que cerrar.
    await expect(finishJobRun(null, { status: "ok" })).resolves.toBeUndefined();
    expect(db.rows("job_run")).toEqual([]);
  });

  it("y un cierre que no se puede escribir tampoco tumba nada", async () => {
    // Sin esto, un fallo al cerrar el diario convertiría un trabajo que terminó
    // bien en una excepción.
    const id = await startJobRun("collections");
    sb.breakWrites("job_run", "se cayó");
    await expect(finishJobRun(id, { status: "ok" })).resolves.toBeUndefined();
  });
});

describe("el envoltorio de un trabajo", () => {
  it("lo cierra en 'ok' con su resumen", async () => {
    const r = await withJobRun("collections", async () => ({ result: 7, summary: { avisos: 7 } }));
    expect(r).toBe(7);
    const fila = db.rows("job_run")[0];
    expect(fila.status).toBe("ok");
    expect(fila.summary).toEqual({ avisos: 7 });
    expect(fila.finished_at).toBeTruthy();
  });

  it("UN TRABAJO QUE REVIENTA DEJA SU FILA CERRADA, no en marcha para siempre", async () => {
    /**
     * Es el punto entero del envoltorio. 'running' significa «colgado», y una fila
     * que se queda ahí porque el trabajo lanzó confunde las dos cosas — y confundir
     * «falló» con «colgado» hace inútiles las dos.
     */
    await expect(
      withJobRun("collections", async () => { throw new Error("la base dijo no"); })
    ).rejects.toThrow("la base dijo no");

    const fila = db.rows("job_run")[0];
    expect(fila.status).toBe("failed");
    expect(String(fila.error)).toContain("la base dijo no");
    expect(fila.finished_at).toBeTruthy();
  });

  it("y además apunta el incidente, sin tragarse el error original", async () => {
    // Las dos cosas: el incidente para que alguien se entere, y el `throw` para
    // que quien llamó sepa que no se hizo.
    await expect(
      withJobRun("dispatch-messages", async () => { throw new Error("se cayó el proveedor"); })
    ).rejects.toThrow();
    expect(rpcCalls.map((c) => c.fn)).toContain("report_incident");
    expect(String(rpcCalls[0].args.p_source)).toBe("cron:dispatch-messages");
  });
});

describe("el registro de incidentes", () => {
  it("NUNCA lanza, aunque la base diga que no", async () => {
    /**
     * Un registro de incidentes que hace fallar la petición que intentaba
     * registrar convierte un fallo en dos, y el segundo tapa al primero.
     */
    rpcRespuesta = { data: null, error: { message: "función ausente" } };
    await expect(reportIncident({ source: "cron:x", error: new Error("algo") }))
      .resolves.toBeUndefined();
  });

  it("agrupa por huella, que es lo que evita mil filas del mismo fallo", async () => {
    await reportIncident({ source: "cron:x", error: new Error("timeout") });
    await reportIncident({ source: "cron:x", error: new Error("timeout") });
    const huellas = rpcCalls.map((c) => c.args.p_fingerprint);
    expect(huellas[0]).toBe(huellas[1]);

    // Y una fuente distinta es otro incidente, no el mismo repetido.
    await reportIncident({ source: "cron:y", error: new Error("timeout") });
    expect(rpcCalls[2].args.p_fingerprint).not.toBe(huellas[0]);

    /**
     * Y EL MENSAJE TAMBIÉN CUENTA, que es la mitad que faltaba.
     *
     * Agrupando solo por fuente, los dos fallos distintos de un mismo cron —«se
     * cayó el proveedor de correo» y «la reserva 4412 no tiene cliente»— se
     * apilarían en un incidente con el texto del primero y el contador subiendo.
     * El segundo no existiría: se vería como «esto ya lo sabemos» y nadie lo
     * miraría.
     */
    await reportIncident({ source: "cron:x", error: new Error("otra cosa distinta") });
    expect(rpcCalls[3].args.p_fingerprint, "dos fallos distintos del mismo cron se agrupan como uno")
      .not.toBe(huellas[0]);
  });
});

describe("el informe de salud", () => {
  const checkDe = (informe: Awaited<ReturnType<typeof healthReport>>, key: string) =>
    informe.checks.find((c) => c.key === key);

  it("un trabajo que corrió hace un rato sale en verde", async () => {
    db.seed("job_run", [
      { _id: "r1", job: "collections", organization_id: null, status: "ok", started_at: haceHoras(2) },
    ]);
    const informe = await healthReport();
    expect(checkDe(informe, "job:collections")!.level).toBe("ok");
  });

  it("y uno que no ha corrido nunca sale en rojo con su consecuencia", async () => {
    const informe = await healthReport();
    const check = checkDe(informe, "job:collections")!;
    expect(check.level).toBe("down");
    expect(check.detail).toContain("Nunca se ha ejecutado");
  });

  it("SI EL DIARIO NO SE PUEDE LEER, LO DICE — no acusa a los cinco trabajos", async () => {
    /**
     * EL FALLO QUE ESTA PRUEBA EXISTE PARA FIJAR.
     *
     * `lastRuns` destructuraba solo `data` y tiraba `error`. PostgREST no lanza:
     * devuelve `{ data: null, error }`, así que la promesa se resolvía, el mapa
     * salía vacío y `jobHealth` leía eso como «nunca se ha ejecutado» — en rojo,
     * para TODOS los trabajos esperados—. Un fallo al leer una tabla se convertía
     * en cinco diagnósticos inventados sobre cinco crons que estaban bien, y el
     * informe entero en `down`.
     *
     * «No lo sé» y «no corrió» llevan a sitios distintos: la primera se arregla
     * mirando la base; la segunda, despertando a alguien de madrugada.
     */
    sb.breakReads("job_run", "relation does not exist");
    const informe = await healthReport();

    const diario = checkDe(informe, "jobs")!;
    expect(diario, "no hay comprobación del diario").toBeTruthy();
    expect(diario.level).toBe("down");
    expect(diario.detail).toContain("No se pudo leer");
    expect(diario.detail).toContain("No se sabe");

    // Y NINGÚN trabajo se declara muerto por un error de lectura.
    for (const e of JOB_EXPECTATIONS) {
      expect(checkDe(informe, `job:${e.job}`), `${e.job} se dio por muerto`).toBeUndefined();
    }
  });

  it("una comprobación en rojo NO tumba a las demás", async () => {
    /**
     * Si preguntar por los incidentes falla, eso es una comprobación en rojo — no
     * un 500 que deja sin saber si la base está viva, que es justo lo que se
     * pregunta cuando algo va mal.
     */
    sb.breakReads("system_incident", "se cayó");
    const informe = await healthReport();
    expect(checkDe(informe, "incidents")!.level).toBe("down");
    expect(checkDe(informe, "db")!.level).toBe("ok");
    expect(checkDe(informe, "auth_hook")!.level).toBe("ok");
  });

  it("el enganche del token sin SECURITY DEFINER es rojo: nadie obtendría sesión", async () => {
    // Es la pregunta que este sistema ya falló una vez, y por eso se comprueba
    // aparte de «¿responde la base?».
    rpcRespuesta = { data: { auth_hook: { exists: true, security_definer: false, has_search_path: true } }, error: null };
    const informe = await healthReport();
    expect(checkDe(informe, "auth_hook")!.level).toBe("down");
  });

  it("LAS PORCIONES POR EMPRESA NO CUENTAN como ejecución del trabajo", async () => {
    /**
     * `recordOrgSlice` escribe filas con `organization_id`: son lo que el trabajo
     * hizo PARA una empresa, no que el trabajo corriera. Contándolas, un cron
     * parado desde hace días parecería reciente en cuanto una empresa cualquiera
     * tuviera una porción apuntada.
     */
    db.seed("job_run", [
      { _id: "r-org", job: "collections", organization_id: "org-1", status: "ok", started_at: haceHoras(1) },
    ]);
    const informe = await healthReport();
    expect(checkDe(informe, "job:collections")!.detail).toContain("Nunca se ha ejecutado");
  });

  it("y el informe dice cuándo se miró", async () => {
    // Un informe sin hora no se puede comparar con el de hace un rato, que es
    // como se ve si algo está empeorando.
    const informe = await healthReport();
    expect(informe.checked_at).toBe(AHORA.toISOString());
  });
});
