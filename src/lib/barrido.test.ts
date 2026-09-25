import { describe, it, expect } from "vitest";
import { barrer, ventana, atascado, avisoDeTope, PAGINA, TOPE } from "@/lib/barrido";

/**
 * Lo que prueba este fichero es el fallo que causó la ola: un trabajo que lee
 * con un tope fijo trata una parte y tira el resto sin decirlo, y tira SIEMPRE
 * LA MISMA parte.
 *
 * Por eso casi ninguna prueba mira «cuántas filas se trataron». Miran QUÉ
 * filas: un barrido que trata 1 000 de 2 500 y uno que las trata todas se
 * distinguen por la lista, no por el número.
 */

/** Una base de mentira: filas ordenadas, y una ventana como la de PostgREST. */
function tabla(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `f${String(i).padStart(4, "0")}` }));
}

describe("ventana", () => {
  it("en recorrido AVANZA con lo visto", () => {
    expect(ventana("recorrido", 0, 500)).toEqual({ desde: 0, hasta: 499 });
    expect(ventana("recorrido", 500, 500)).toEqual({ desde: 500, hasta: 999 });
  });

  it("en drenaje pide SIEMPRE la primera página", () => {
    // Lo ya tratado sale del filtro: avanzar aquí se saltaría tantas filas
    // como se llevaran tratadas.
    expect(ventana("drenaje", 0, 500)).toEqual({ desde: 0, hasta: 499 });
    expect(ventana("drenaje", 500, 500)).toEqual({ desde: 0, hasta: 499 });
    expect(ventana("drenaje", 5000, 500)).toEqual({ desde: 0, hasta: 499 });
  });
});

describe("atascado", () => {
  it("dos vueltas con las mismas filas es un atasco", () => {
    expect(atascado(["a", "b"], ["a", "b"])).toBe(true);
    expect(atascado(["a", "b"], ["b", "a"])).toBe(true);
  });

  it("la misma CANTIDAD con otras filas no es un atasco", () => {
    expect(atascado(["a", "b"], ["c", "d"])).toBe(false);
    expect(atascado(["a", "b"], ["a", "c"])).toBe(false);
  });

  it("la primera vuelta nunca está atascada", () => {
    expect(atascado([], ["a"])).toBe(false);
  });

  it("sin vuelta anterior no hay atasco, ni aunque la actual venga vacía", () => {
    // `every` sobre una lista vacía es verdadero, así que sin la comprobación
    // de la vuelta anterior esto diría «atascado» en el caso en el que hay
    // menos información que en ninguno. No haber mirado todavía no es prueba
    // de nada: es lo que dice la función, y por eso se prueba.
    expect(atascado([], [])).toBe(false);
  });
});

describe("barrer · recorrido", () => {
  it("trata TODAS las filas, no la primera página", async () => {
    const filas = tabla(2500);
    const tratadas: string[] = [];
    const resumen = await barrer({
      etiqueta: "prueba", modo: "recorrido", idDe: (f: { id: string }) => f.id,
      leer: async (desde, hasta) => filas.slice(desde, hasta + 1),
      tratar: async (lote) => { for (const f of lote) tratadas.push(f.id); },
      pagina: 500,
    });
    // La prueba que importa: la lista entera, y sin repetidas.
    expect(tratadas).toEqual(filas.map((f) => f.id));
    expect(new Set(tratadas).size).toBe(2500);
    expect(resumen.truncado).toBe(false);
    expect(resumen.vistas).toBe(2500);
  });

  it("una página justa no cuesta una lectura de más", async () => {
    const filas = tabla(500);
    let lecturas = 0;
    await barrer({
      etiqueta: "prueba", modo: "recorrido", idDe: (f: { id: string }) => f.id,
      leer: async (desde, hasta) => { lecturas++; return filas.slice(desde, hasta + 1); },
      tratar: async () => {},
      pagina: 500,
    });
    // Justo 500 filas: la vuelta corta es la señal de final, pero 500 no es
    // corta. Una lectura más es el precio, y está bien pagarlo.
    expect(lecturas).toBe(2);
  });

  it("se planta en el techo y lo DICE", async () => {
    const filas = tabla(3000);
    const resumen = await barrer({
      etiqueta: "prueba", modo: "recorrido", idDe: (f: { id: string }) => f.id,
      leer: async (desde, hasta) => filas.slice(desde, hasta + 1),
      tratar: async () => {},
      pagina: 100, tope: 500,
    });
    expect(resumen.truncado).toBe(true);
    expect(resumen.vistas).toBe(500);
    // Y es lo único que cambia respecto de antes: antes también se quedaba
    // corto, pero nadie se enteraba.
    expect(avisoDeTope("prueba", resumen)).toContain("techo");
  });
});

describe("barrer · drenaje", () => {
  it("vacía la cola entera aunque las filas desaparezcan al tratarlas", async () => {
    let cola = tabla(1200);
    const tratadas: string[] = [];
    const resumen = await barrer({
      etiqueta: "cola", modo: "drenaje", idDe: (f: { id: string }) => f.id,
      leer: async (desde, hasta) => cola.slice(desde, hasta + 1),
      tratar: async (lote) => {
        for (const f of lote) tratadas.push(f.id);
        const ids = new Set(lote.map((f) => f.id));
        cola = cola.filter((f) => !ids.has(f.id));
      },
      pagina: 500,
    });
    expect(tratadas.length).toBe(1200);
    expect(new Set(tratadas).size).toBe(1200);
    expect(cola).toHaveLength(0);
    expect(resumen.truncado).toBe(false);
  });

  it("un drenaje que NO saca las filas se para y avisa, en vez de dar vueltas hasta el techo", async () => {
    // Es lo que pasa cuando la escritura falla en todas: la fila se queda en
    // el filtro y vuelve. Sin esta salida, el cron gastaría veinte mil
    // lecturas sobre las mismas quinientas y terminaría diciendo «truncado»,
    // que es la explicación equivocada del problema equivocado.
    const cola = tabla(500);
    let lecturas = 0;
    const resumen = await barrer({
      etiqueta: "cola", modo: "drenaje", idDe: (f: { id: string }) => f.id,
      leer: async (desde, hasta) => { lecturas++; return cola.slice(desde, hasta + 1); },
      tratar: async () => {},
      pagina: 500, tope: 20_000,
    });
    expect(resumen.atascado).toBe(true);
    expect(resumen.truncado).toBe(false);
    expect(lecturas).toBe(2);
    expect(avisoDeTope("cola", resumen)).toContain("atascó");
  });
});

describe("los modos no son intercambiables", () => {
  it("un RECORRIDO hecho en modo drenaje da vueltas sobre las mismas filas", async () => {
    // Esta prueba está aquí para que el día que alguien cambie un modo por el
    // otro «porque da igual», vea escrito qué es lo que pasa.
    const filas = tabla(1000);
    const tratadas: string[] = [];
    const resumen = await barrer({
      etiqueta: "mal", modo: "drenaje", idDe: (f: { id: string }) => f.id,
      leer: async (desde, hasta) => filas.slice(desde, hasta + 1),
      tratar: async (lote) => { for (const f of lote) tratadas.push(f.id); },
      pagina: 500,
    });
    // Trató las primeras 500 dos veces y las otras 500 ninguna.
    expect(new Set(tratadas).size).toBe(500);
    expect(resumen.atascado).toBe(true);
  });

  it("un DRENAJE hecho en modo recorrido se salta filas", async () => {
    let cola = tabla(1000);
    const tratadas: string[] = [];
    await barrer({
      etiqueta: "mal", modo: "recorrido", idDe: (f: { id: string }) => f.id,
      leer: async (desde, hasta) => cola.slice(desde, hasta + 1),
      tratar: async (lote) => {
        for (const f of lote) tratadas.push(f.id);
        const ids = new Set(lote.map((f) => f.id));
        cola = cola.filter((f) => !ids.has(f.id));
      },
      pagina: 500,
    });
    // Tratadas las 500 primeras; las 500 restantes se bajaron al hueco que
    // dejaron, y la ventana ya había avanzado por encima de ellas.
    expect(tratadas).toHaveLength(500);
    expect(cola).toHaveLength(500);
  });
});

describe("los números por defecto", () => {
  it("la página es más pequeña que el techo, y por mucho", () => {
    // Si la página fuera del tamaño del techo, el barrido sería otra vez un
    // `limit` con más pasos.
    expect(PAGINA).toBeLessThan(TOPE / 10);
  });

  it("el techo es MUY superior a los topes que sustituyó", () => {
    // Los de antes iban de 1 000 a 3 000. El nuevo tiene que ser un número que
    // una operadora sana no toque nunca, para que tocarlo signifique algo.
    expect(TOPE).toBeGreaterThanOrEqual(20_000);
  });
});
