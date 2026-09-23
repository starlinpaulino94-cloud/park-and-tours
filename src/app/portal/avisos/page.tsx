"use client";

import { BandejaDeAvisos } from "@/components/tf/bandeja-avisos";

/**
 * LOS AVISOS DEL TOUR CENTER.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE NO EXISTÍA
 *
 * `notification.partner_id` está en la tabla desde 0009 y nadie la escribía ni
 * la leía. Al socio no se le contaba nada de sus propias ventas: ni que la
 * reserva quedó confirmada, ni que le movieron la fecha y la recogida, ni que
 * se la cancelaron, ni que le emitieron la liquidación, ni que se la pagaron.
 * Se enteraba llamando —o por el turista, que sí recibía sus avisos—, que es
 * exactamente lo que este portal vino a sustituir.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y ES LA MISMA PANTALLA QUE LA DEL PANEL, A PROPÓSITO
 *
 * Quien decide qué hay dentro es el servidor: `inboxFilter` mira al actor y le
 * da el buzón de su tour center o el de la operadora. Dos pantallas iguales se
 * habrían separado el día que alguien arreglara el contador en una sola.
 */
export default function PortalAvisosPage() {
  return (
    <BandejaDeAvisos vacio="Aquí aparecen los avisos de tus reservas: confirmaciones, cambios de fecha, cancelaciones y tus liquidaciones." />
  );
}
