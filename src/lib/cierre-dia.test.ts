import { describe, it, expect } from "vitest";
import {
  cerrarDia, cuadrarCaja, esDineroEntrado, signoDe, resumirCobros, resumirOperacion,
  ventasPorCanal, TOLERANCIA_CAJA,
} from "@/lib/cierre-dia";

describe("lo que operó", () => {
  it("una salida cancelada no cuenta como operada", () => {
    const r = resumirOperacion([
      { status: "completed" }, { status: "cancelled" }, { status: "in_progress" },
    ]);
    expect(r.programadas).toBe(3);
    expect(r.operadas).toBe(2);
    expect(r.canceladas).toBe(1);
  });

  it("una salida que todavía no salió tampoco", () => {
    // «Programada» a las 6 de la tarde no es «operada»: el cierre del día lo
    // firma alguien que estuvo ahí y sabe que esa guagua no se movió.
    expect(resumirOperacion([{ status: "scheduled" }]).operadas).toBe(0);
  });

  it("sin cupo no hay ocupación, y eso NO es cero", () => {
    /**
     * Cero por ciento dice «se fueron vacías». «No se puede calcular» es otra
     * cosa, y confundirlas en una hoja firmada es afirmar algo que no se sabe.
     */
    expect(resumirOperacion([{ capacity: 0, actual_pax: 0 }]).ocupacion).toBeNull();
    expect(resumirOperacion([{ capacity: 40, actual_pax: 30 }]).ocupacion).toBe(75);
  });

  it("los pax llegan como texto desde la base y suman igual", () => {
    const r = resumirOperacion([{ booked_pax: "12", actual_pax: "10", no_show_pax: "2" }]);
    expect(r.vendido).toBe(12);
    expect(r.operado).toBe(10);
    expect(r.noShow).toBe(2);
  });
});

describe("lo que se vendió", () => {
  it("reparte por canal y ordena por importe", () => {
    const l = ventasPorCanal([
      { channel: "web", total: 100 }, { channel: "ota", total: 300 }, { channel: "web", total: 50 },
    ]);
    expect(l[0]).toEqual({ canal: "ota", documentos: 1, importe: 300 });
    expect(l[1]).toEqual({ canal: "web", documentos: 2, importe: 150 });
  });

  it("una venta sin canal no se pierde", () => {
    // Descartarla haría que el total por canales no sumara el total del día,
    // y ese descuadre es de los que se achacan al sistema para siempre.
    const l = ventasPorCanal([{ total: 80 }]);
    expect(l).toEqual([{ canal: "sin_canal", documentos: 1, importe: 80 }]);
  });

  it("dos canales empatados salen siempre en el mismo orden", () => {
    /**
     * Sin desempate, dos impresiones del MISMO día pueden traer las líneas
     * cambiadas de sitio y dejan de poder compararse línea a línea.
     */
    const uno = ventasPorCanal([{ channel: "web", total: 100 }, { channel: "ota", total: 100 }]);
    const otro = ventasPorCanal([{ channel: "ota", total: 100 }, { channel: "web", total: 100 }]);
    expect(uno.map((l) => l.canal)).toEqual(otro.map((l) => l.canal));
    expect(uno[0].canal).toBe("ota");
  });
});

describe("lo que se cobró", () => {
  it("solo un cobro COMPLETADO es dinero que llegó", () => {
    /**
     * Es la misma regla que ya usa el panel (migración 0023). Escribir aquí
     * otra —«todo lo que no esté rechazado»— haría que el cierre del martes y
     * el panel del martes dieran cifras distintas del mismo día, y no habría
     * forma de saber cuál creer.
     *
     * `authorized` no entra: la tarjeta está autorizada, el dinero no está. Y
     * en una caja que se cuenta a mano, lo que no está no se puede contar.
     */
    expect(esDineroEntrado("completed")).toBe(true);
    for (const estado of ["pending", "authorized", "rejected", "cancelled", "refunded", "partially_refunded"]) {
      expect(esDineroEntrado(estado), estado).toBe(false);
    }
  });

  it("una devolución RESTA en vez de sumar", () => {
    /**
     * Un reembolso es una fila de cobro más, con tipo `refund`. Sumarla como
     * si fuera una entrada hace que el día en que se devuelve dinero parezca
     * el día en que más entró.
     */
    expect(signoDe("refund")).toBe(-1);
    expect(signoDe("credit_note")).toBe(-1);
    expect(signoDe("payment")).toBe(1);
    expect(signoDe(null)).toBe(1);

    const r = resumirCobros([
      { method: "cash", amount: 1000, status: "completed", payment_type: "payment" },
      { method: "cash", amount: 250, status: "completed", payment_type: "refund" },
    ]);
    expect(r.efectivo).toBe(750);
    expect(r.total).toBe(750);
  });

  it("los descartados se cuentan, para que el papel no mienta por omisión", () => {
    const r = resumirCobros([
      { method: "cash", amount: 100, status: "completed" },
      { method: "cash", amount: 500, status: "rejected" },
    ]);
    expect(r.total).toBe(100);
    expect(r.descartados).toBe(1);
  });

  it("el efectivo se separa, porque es lo único que se puede contar", () => {
    const r = resumirCobros([
      { method: "cash", amount: 100, status: "completed" },
      { method: "card", amount: 400, status: "completed" },
    ]);
    expect(r.total).toBe(500);
    expect(r.efectivo).toBe(100);
  });
});

describe("el cuadre de caja", () => {
  it("al contado se le resta el fondo de apertura", () => {
    /**
     * EL ERROR QUE ESTA PRUEBA IMPIDE: sin restar el fondo, TODA caja que abra
     * con dinero parece tener un sobrante exactamente igual a su fondo. Un
     * aviso que sale todos los días se aprende a ignorar, y el día que el
     * descuadre es real nadie lo mira.
     */
    const c = cuadrarCaja(5000, [{ status: "closed", counted_cash: 7000, opening_amount: 2000 }]);
    expect(c.contado).toBe(5000);
    expect(c.diferencia).toBe(0);
    expect(c.veredicto).toBe("cuadra");
  });

  it("nombra si falta o si sobra, no solo que no cuadra", () => {
    expect(cuadrarCaja(5000, [{ status: "closed", counted_cash: 4500 }]).veredicto).toBe("falta");
    expect(cuadrarCaja(5000, [{ status: "closed", counted_cash: 5600 }]).veredicto).toBe("sobra");
  });

  it("un peso de diferencia no es un hallazgo; cien sí", () => {
    expect(TOLERANCIA_CAJA).toBe(1);
    expect(cuadrarCaja(5000, [{ status: "closed", counted_cash: 4999 }]).veredicto).toBe("cuadra");
    expect(cuadrarCaja(5000, [{ status: "closed", counted_cash: 4900 }]).veredicto).toBe("falta");
  });

  it("sin ninguna caja cerrada no se declara cuadre", () => {
    // Decir «cuadra» porque nadie contó nada es peor que no decir nada.
    const c = cuadrarCaja(5000, [{ status: "open" }]);
    expect(c.veredicto).toBe("sin_cierre");
    expect(c.abiertas).toBe(1);
  });

  it("una caja abierta deja el cuadre provisional aunque otra haya cerrado", () => {
    const c = cuadrarCaja(1000, [
      { status: "closed", counted_cash: 1000 }, { status: "open" },
    ]);
    expect(c.veredicto).toBe("cuadra");
    expect(c.abiertas).toBe(1);
  });
});

describe("el documento del día", () => {
  const entradas = {
    fecha: "2026-09-22",
    salidas: [{ status: "completed", capacity: 40, booked_pax: 30, actual_pax: 28, no_show_pax: 2 }],
    ventas: [{ channel: "web", total: 1200 }],
    cobros: [
      { method: "cash", amount: 800, status: "completed" },
      { method: "card", amount: 400, status: "completed" },
    ],
    sesionesCaja: [{ status: "closed", counted_cash: 1100, opening_amount: 300 }],
    incidencias: [{ severity: "critical" }, { severity: "low" }],
  };

  it("junta las cuatro secciones con sus totales", () => {
    const d = cerrarDia(entradas);
    expect(d.operacion.operado).toBe(28);
    expect(d.ventas.total).toBe(1200);
    expect(d.cobros.total).toBe(1200);
    expect(d.caja.veredicto).toBe("cuadra");
    expect(d.incidencias).toEqual({ total: 2, graves: 1 });
  });

  it("los avisos dicen qué mirar antes de firmar", () => {
    const d = cerrarDia(entradas);
    expect(d.avisos.join(" ")).toContain("no se presentaron");
    expect(d.avisos.join(" ")).toContain("graves");
  });

  it("un descuadre de efectivo sale el PRIMERO de los avisos", () => {
    /**
     * Es el hallazgo del día. Enterrado entre «2 no-show» y «1 incidencia» es
     * lo mismo que no decirlo.
     */
    const d = cerrarDia({
      ...entradas,
      sesionesCaja: [{ status: "closed", counted_cash: 600, opening_amount: 300 }],
    });
    expect(d.avisos[0]).toContain("Falta efectivo");
  });

  it("efectivo cobrado sin ninguna caja contada se dice, y se dice primero", () => {
    /**
     * No hay descuadre porque no hay con qué comparar — y eso es PEOR que un
     * descuadre. Callarlo deja una hoja firmada que da por contado lo que
     * nadie contó.
     */
    const d = cerrarDia({ ...entradas, sesionesCaja: [] });
    expect(d.caja.veredicto).toBe("sin_cierre");
    expect(d.avisos[0]).toContain("ninguna caja se cerró");
  });

  it("un día sin nada no revienta y no inventa avisos", () => {
    const d = cerrarDia({
      fecha: "2026-09-22", salidas: [], ventas: [], cobros: [], sesionesCaja: [], incidencias: [],
    });
    expect(d.ventas.total).toBe(0);
    expect(d.operacion.ocupacion).toBeNull();
    expect(d.avisos).toEqual([]);
  });
});

describe("el cierre no puede contradecir al panel", () => {
  it("cuenta el dinero con la MISMA regla que la vista financiera", async () => {
    /**
     * LA GUARDA QUE NACE DE HABERLO HECHO MAL.
     *
     * La primera versión de este módulo contaba «todo lo que no esté
     * rechazado». La vista de la migración 0023 cuenta solo `completed` y
     * RESTA `refund` y `credit_note`. Con las dos reglas conviviendo, el cierre
     * del martes y el panel del martes daban cifras distintas del mismo día, y
     * no hay forma de saber cuál creer.
     *
     * Esto lee la migración y comprueba que sigue diciendo lo mismo que el
     * dominio. Si mañana alguien cambia la vista, esta prueba lo trae aquí.
     */
    const { readFileSync, readdirSync } = await import("node:fs");
    const dir = "supabase/migrations";
    const sql = readdirSync(dir)
      .filter((f) => f.startsWith("0023") && f.endsWith(".sql"))
      .map((f) => readFileSync(`${dir}/${f}`, "utf8"))
      .join("\n");

    expect(sql, "la vista financiera ya no filtra por estado completado")
      .toMatch(/status\s*=\s*'completed'/);
    expect(sql, "la vista financiera ya no resta las devoluciones")
      .toMatch(/payment_type in \('refund','credit_note'\) then -/);

    // Y el dominio dice lo mismo.
    expect(esDineroEntrado("completed")).toBe(true);
    expect(esDineroEntrado("authorized")).toBe(false);
    expect(signoDe("refund")).toBe(-1);
    expect(signoDe("credit_note")).toBe(-1);
  });
});
