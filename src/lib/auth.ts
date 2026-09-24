/**
 * El rol de quien entra.
 *
 * El tipo y su rango viven en `roles.ts`, que es puro y lo puede importar
 * cualquiera. Aquí se reexporta porque medio código lo pide por este nombre y
 * mover ciento y pico importaciones para ganar un fichero menos no arregla
 * nada — lo que había que arreglar es que el RANGO estuviera en tres sitios.
 */
export type { AppRole } from "@/lib/roles";
