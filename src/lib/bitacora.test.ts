import { describe, it, expect } from "vitest";
import { ACCION, moduloDe, resumirPorModulo, type EventoBitacora } from "@/lib/bitacora";

const ev = (p: Partial<EventoBitacora>): EventoBitacora => ({ _id: "x", action: "record_created", ...p });

describe("a qué módulo pertenece cada cosa", () => {
  it("agrupa por la entidad, que es como lo lee quien firma", () => {
    // «Caja» reúne la apertura, el cierre y cada movimiento aunque sean
    // acciones distintas: es un módulo, no tres.
    expect(moduloDe(ev({ entity_type: "cash_session", action: "cash_session_opened" }))).toBe("Caja");
    expect(moduloDe(ev({ entity_type: "cash_movement", action: "cash_movement_registered" }))).toBe("Caja");
    expect(moduloDe(ev({ entity_type: "cash_count", action: "record_created" }))).toBe("Caja");
  });

  it("lo que llega sin entidad se agrupa por el canal", () => {
    // Un webhook no escribe sobre una tabla del negocio; si cayera en «Otros»,
    // el módulo que más ruido puede hacer sería justo el invisible.
    expect(moduloDe(ev({ action: "octo_booking_confirmed" }))).toBe("Canal OTA");
    expect(moduloDe(ev({ action: "stripe_event_processed" }))).toBe("Suscripción");
    expect(moduloDe(ev({ action: "impersonation_started" }))).toBe("Soporte");
  });

  it("nunca devuelve vacío", () => {
    // Una celda en blanco en un reporte impreso parece un error del sistema.
    expect(moduloDe(ev({ action: "algo_nuevo_que_nadie_mapeó" }))).toBe("Otros");
    expect(moduloDe(ev({ entity_type: "", action: "x" }))).toBe("Otros");
    expect(moduloDe(ev({ entity_type: "tabla_del_futuro", action: "x" }))).toBe("Otros");
  });
});

describe("el resumen por módulo", () => {
  it("ordena por volumen, de más a menos", () => {
    const r = resumirPorModulo([
      ev({ entity_type: "booking" }), ev({ entity_type: "booking" }), ev({ entity_type: "booking" }),
      ev({ entity_type: "payment" }),
    ]);
    expect(r.map((x) => x.modulo)).toEqual(["Reservas", "Cobros"]);
    expect(r[0].total).toBe(3);
  });

  it("a igualdad de total, orden estable", () => {
    /**
     * ──────────────────────────────────────────────────────────────────────
     * POR QUÉ IMPORTA UN DESEMPATE
     *
     * Sin él, dos módulos con el mismo número salen en orden distinto cada vez
     * que se pinta. Dos impresiones del MISMO período dejan de poder
     * compararse línea a línea, y quien revisa cree que algo cambió.
     */
    const eventos = [ev({ entity_type: "payment" }), ev({ entity_type: "booking" })];
    const a = resumirPorModulo(eventos).map((x) => x.modulo);
    const b = resumirPorModulo([...eventos].reverse()).map((x) => x.modulo);
    expect(a).toEqual(b);
    expect(a).toEqual(["Cobros", "Reservas"]); // alfabético en español
  });

  it("cuenta aparte lo que pide atención", () => {
    // Es lo primero que se mira: no cuántas cosas pasaron, sino cuántas
    // pasaron mal.
    const r = resumirPorModulo([
      ev({ entity_type: "cash_movement", severity: "warning" }),
      ev({ entity_type: "cash_movement", severity: "info" }),
      ev({ entity_type: "cash_movement", severity: "critical" }),
    ]);
    expect(r[0]).toEqual({ modulo: "Caja", total: 3, atencion: 2 });
  });

  it("sin eventos no inventa filas", () => {
    expect(resumirPorModulo([])).toEqual([]);
  });
});

describe("las etiquetas", () => {
  it("las tres del CRUD genérico están, porque son la mayoría de la bitácora", () => {
    expect(ACCION.record_created).toBe("Registro creado");
    expect(ACCION.record_updated).toBe("Registro editado");
    expect(ACCION.record_deleted).toBe("Registro eliminado");
  });

  it("toda acción que el código escribe tiene su texto en castellano", () => {
    /**
     * Esta es la guarda de verdad: si mañana alguien añade un `writeAudit` con
     * una acción nueva y no la traduce, el reporte impreso enseñaría
     * `octo_hold_extended` en una hoja que va a un archivador.
     */
    const { readFileSync, readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const ROOT = process.cwd();

    const acciones = new Set<string>();
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const full = path.join(dir, f);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });

    for (const dir of ["src/app/api", "src/lib"]) {
      for (const file of walk(path.join(ROOT, dir))) {
        if (!/\.tsx?$/.test(file) || file.endsWith(".test.ts")) continue;
        const src = readFileSync(file, "utf8");
        // Solo lo que va DENTRO de un writeAudit: `action:` también es el
        // nombre de un campo en otras tablas (una acción correctiva de una
        // incidencia, por ejemplo), y ésas no salen en la bitácora.
        for (const llamada of src.matchAll(/writeAudit\(\{[\s\S]{0,600}?\}\)/g)) {
          const m = /action:\s*"([a-z0-9_]+)"/.exec(llamada[0]);
          if (m) acciones.add(m[1]);
        }
      }
    }

    const sinTraducir = [...acciones].filter((a) => !ACCION[a]).sort();
    expect(sinTraducir, "acciones que saldrían en el papel con su nombre técnico").toEqual([]);
  });
});
