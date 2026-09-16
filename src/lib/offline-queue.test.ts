import { describe, it, expect, beforeEach } from "vitest";
import {
  readQueue, enqueue, removeFromQueue, updateQueued, shouldRetry, queueSummary,
  newCheckinKey, QUEUE_STORAGE_KEY, MAX_QUEUED, type KeyValueStore, type QueuedCheckin,
} from "@/lib/offline-queue";

/**
 * Esta cola es lo único que hay entre el guía y perder el embarque de cuarenta
 * personas, así que las pruebas van contra los momentos en que un teléfono se
 * porta mal: almacenamiento corrupto, almacenamiento lleno, y respuestas del
 * servidor que no mejoran por reintentar.
 */

class FakeStore implements KeyValueStore {
  data = new Map<string, string>();
  fail = false;
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.fail) throw new Error("QuotaExceededError");
    this.data.set(key, value);
  }
}

const item = (key: string, over: Partial<QueuedCheckin> = {}): QueuedCheckin => ({
  key, bookingId: `b-${key}`, label: `RES-${key}`, body: { pax: 2 }, at: Date.now(), tries: 0, ...over,
});

let store: FakeStore;
beforeEach(() => { store = new FakeStore(); });

describe("guardar y sacar", () => {
  it("lo que entra, sale", () => {
    enqueue(store, item("a"));
    enqueue(store, item("b"));
    expect(readQueue(store).map((q) => q.key)).toEqual(["a", "b"]);
  });

  it("la misma clave no se duplica: es el mismo embarque", () => {
    enqueue(store, item("a", { tries: 0 }));
    enqueue(store, item("a", { tries: 3 }));
    const queue = readQueue(store);
    expect(queue).toHaveLength(1);
    expect(queue[0].tries).toBe(3);
  });

  it("sacar uno deja los demás", () => {
    enqueue(store, item("a"));
    enqueue(store, item("b"));
    expect(removeFromQueue(store, "a").map((q) => q.key)).toEqual(["b"]);
  });

  it("anotar el intento no pierde el resto", () => {
    enqueue(store, item("a"));
    updateQueued(store, "a", { tries: 2, lastError: "sin red" });
    expect(readQueue(store)[0]).toMatchObject({ key: "a", tries: 2, lastError: "sin red", bookingId: "b-a" });
  });
});

describe("cuando el teléfono se porta mal", () => {
  it("un contenido corrupto se lee como cola vacía, no revienta", () => {
    /**
     * Reventar aquí dejaría al guía sin pantalla de check-in por un dato
     * ilegible. Perder la cola es malo; quedarse sin poder embarcar es peor.
     */
    store.data.set(QUEUE_STORAGE_KEY, "{no es json");
    expect(readQueue(store)).toEqual([]);
    store.data.set(QUEUE_STORAGE_KEY, '{"no":"un arreglo"}');
    expect(readQueue(store)).toEqual([]);
  });

  it("las entradas sin forma se descartan una a una", () => {
    store.data.set(QUEUE_STORAGE_KEY, JSON.stringify([{ key: "a", bookingId: "b" }, null, { roto: true }]));
    expect(readQueue(store).map((q) => q.key)).toEqual(["a"]);
  });

  it("el almacenamiento lleno no rompe la pantalla", () => {
    // Pasa en modo privado y con el disco lleno. La petición ya se intentó por
    // red; lo que no puede pasar es que la pantalla se caiga.
    store.fail = true;
    expect(() => enqueue(store, item("a"))).not.toThrow();
  });

  it("con la cola al tope se descarta lo más viejo, no lo recién hecho", () => {
    for (let i = 0; i < MAX_QUEUED + 5; i++) enqueue(store, item(`k${i}`));
    const queue = readQueue(store);
    expect(queue).toHaveLength(MAX_QUEUED);
    // Lo último que hizo el guía sigue ahí; lo que se perdió es lo más viejo.
    expect(queue[queue.length - 1].key).toBe(`k${MAX_QUEUED + 4}`);
    expect(queue[0].key).toBe("k5");
  });
});

describe("qué se reintenta", () => {
  it("lo que es de la red, sí", () => {
    expect(shouldRetry(0)).toBe(true);      // sin conexión o tiempo agotado
    expect(shouldRetry(500)).toBe(true);
    expect(shouldRetry(502)).toBe(true);
  });

  it("lo que el servidor entendió y rechazó, no", () => {
    // Un 409 «ya tiene check-in con otra clave» o un 403 no mejoran con el
    // tiempo: reintentar es gastar batería para recibir el mismo no cien veces.
    expect(shouldRetry(409)).toBe(false);
    expect(shouldRetry(403)).toBe(false);
    expect(shouldRetry(400)).toBe(false);
    expect(shouldRetry(402)).toBe(false);
  });

  it("el 429 sí, porque es «ahora no, más tarde»", () => {
    expect(shouldRetry(429)).toBe(true);
  });
});

describe("lo que se le dice al guía", () => {
  it("sin cola y con red, no se dice nada", () => {
    expect(queueSummary([], true)).toBe("");
  });

  it("sin red y sin cola, se le dice que puede seguir", () => {
    // Es la mitad del valor: saber que puede seguir trabajando.
    expect(queueSummary([], false)).toMatch(/puedes seguir/i);
  });

  it("con cola dice cuántos y dónde están", () => {
    expect(queueSummary([item("a")], false)).toMatch(/1 embarque guardado en este teléfono/);
    expect(queueSummary([item("a"), item("b")], false)).toMatch(/2 embarques guardados/);
    expect(queueSummary([item("a")], true)).toMatch(/Enviando 1 embarque/);
  });
});

describe("la clave del embarque", () => {
  it("no se repite", () => {
    const claves = new Set(Array.from({ length: 200 }, () => newCheckinKey()));
    expect(claves.size).toBe(200);
  });

  it("se reconoce a simple vista en la bitácora", () => {
    expect(newCheckinKey().startsWith("ci_")).toBe(true);
  });
});
