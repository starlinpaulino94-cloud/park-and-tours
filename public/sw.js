/**
 * EL TRABAJADOR DE SERVICIO: que el check-in siga en pie sin señal.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ PROBLEMA RESUELVE
 *
 * El guía embarca donde no hay red. Sin esto, abrir la pantalla de check-in sin
 * señal da el dinosaurio del navegador: ni la lista del día, ni el buscador, ni
 * nada. Lo que pasaba de verdad es que se marcaba en papel y alguien lo pasaba
 * al sistema por la tarde, cuando el manifiesto ya no servía para nada.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TRES ESTRATEGIAS, UNA POR TIPO DE COSA
 *
 *  · LO ESTÁTICO de Next (`/_next/static/…`) lleva un hash en el nombre: nunca
 *    cambia de contenido, así que se sirve de la caché sin preguntar.
 *  · LAS PANTALLAS se piden a la red primero y se guarda la copia. Sin red, se
 *    sirve la última copia: el guía ve la pantalla que abrió esta mañana.
 *  · LOS DATOS DEL DÍA (la lista de hoy y la búsqueda de vouchers) igual, red
 *    primero y copia guardada. Una lista de hace dos horas es infinitamente más
 *    útil que ninguna lista.
 *
 * Lo que NO se toca: cualquier cosa que no sea GET. Un check-in, un cobro o una
 * anulación no se guardan aquí ni se responden desde la caché — contestar «ya
 * está» a una escritura que no llegó al servidor sería mentir sobre dinero. Lo
 * que se hace sin señal lo guarda la aplicación en su cola, con su clave, y lo
 * manda cuando vuelve la red.
 */

const VERSION = "v1";
const SHELL = `pt-shell-${VERSION}`;
const DATA = `pt-data-${VERSION}`;

/** Lo que vale la pena conservar sin señal, y nada más. */
const DATA_PATHS = ["/api/checkin/lookup", "/api/erp/booking", "/api/erp/departure"];

self.addEventListener("install", (event) => {
  // Entra en servicio en cuanto está listo: el guía no va a cerrar todas las
  // pestañas para estrenar una versión nueva.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Las cachés de versiones anteriores se borran: si no, el teléfono acumula
    // una copia del sistema por cada despliegue.
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => !key.endsWith(VERSION)).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(cacheName)).put(request, response.clone());
  return response;
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    // Solo se guarda lo que salió bien: cachear un 500 serviría ese error
    // durante horas.
    if (response.ok) (await caches.open(cacheName)).put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Solo GET. Una escritura jamás se responde desde la caché.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, SHELL));
    return;
  }

  if (DATA_PATHS.some((path) => url.pathname.startsWith(path))) {
    event.respondWith(networkFirst(request, DATA));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        return await networkFirst(request, SHELL);
      } catch (error) {
        // Ni red ni copia de ESTA pantalla: se intenta la del check-in, que es
        // la que el guía necesita cuando se queda sin señal.
        const fallback = await caches.match("/dashboard/checkin");
        if (fallback) return fallback;
        throw error;
      }
    })());
  }
});
