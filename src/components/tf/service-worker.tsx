"use client";

import { useEffect } from "react";

/**
 * REGISTRA EL TRABAJADOR DE SERVICIO.
 *
 * Va montado dentro del panel y no en la raíz a propósito: lo que tiene que
 * seguir funcionando sin señal es la operación —la pantalla de check-in y los
 * datos del día—, no la página pública ni el login, que sin red no pueden hacer
 * nada útil de todos modos.
 *
 * Si el navegador no lo admite o el registro falla, no pasa nada: el sistema
 * funciona igual con conexión. Esto AÑADE la posibilidad de trabajar sin ella;
 * no es un requisito para nada.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    // En desarrollo estorba: guarda versiones de páginas que cambian cada vez
    // que se guarda un archivo.
    if (process.env.NODE_ENV !== "production") return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("[sw] no se pudo registrar:", err);
      });
    };
    // Después de la carga: registrar durante el arranque compite por la red con
    // lo que el usuario está esperando ver.
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
