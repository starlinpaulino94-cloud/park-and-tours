// src/app/layout.tsx
import React from "react";
import type { Metadata, Viewport } from "next";
import { Manrope, Geist_Mono } from "next/font/google";
import "./globals.css";
import { DevToolsHandler } from "@/components/DevToolsHandler";
import { GlobalErrorCatcher } from "@/components/GlobalErrorCatcher";
import { TemporalLinkBanner } from "@/components/TemporalLinkBanner";
import { Toaster } from "@/components/ui/sonner";

/**
 * UNA FAMILIA, NO CUATRO.
 *
 * Antes se descargaban Fraunces (serif de titulares), Manrope, Space Grotesk
 * entera y una Space Grotesk recortada a las cifras. El serif cargaba la vista
 * en pantallas que se miran ocho horas al día —el punto de venta, los
 * listados—, que no son una portada de revista.
 *
 * Ahora la jerarquía la hacen el tamaño y el peso. Las cifras se alinean con
 * `font-variant-numeric: tabular-nums` (ver `.tf-num` en globals.css), que es
 * una propiedad CSS y no una descarga: el mismo resultado en columnas de
 * importes, con tres fuentes menos viajando por la red.
 *
 * La monoespaciada se queda, y es una excepción deliberada: los códigos de
 * reserva, las matrículas y los NCF se leen en columna, y una proporcional
 * rompe justo la alineación para la que existen esas celdas.
 */
const body = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "TourFlow — Sistema integral de gestión turística",
  description:
    "ERP, OMS y motor de reservas para parques, excursiones, tour centers y agencias. Multiempresa, multicanal y multidivisa.",
  // El manifiesto convierte esto en una aplicación que se instala en el
  // teléfono del guía y abre directamente en el check-in. Sin él, el sistema
  // solo existe dentro de un navegador con pestañas.
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Park&Tours", statusBarStyle: "default" },
  icons: { icon: "/icono.svg", apple: "/icono.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0f766e",
  // Se deja hacer zoom: quien trabaja al sol con un papel en la mano a veces
  // necesita agrandar, y bloquearlo es una barrera de accesibilidad real.
  initialScale: 1,
  width: "device-width",
};

// SUPER IMPORTANT: NOT EDIT THE FOLLOWING 2 LINES TO FORCE NEXT.JS TO RENDER DYNAMICALLY
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body
        className={`${body.variable} ${mono.variable} antialiased`}
      >
        <GlobalErrorCatcher />
        <DevToolsHandler />
        {/* Development-preview only banner. Kept outside the page wrapper so it never covers content. */}
        <TemporalLinkBanner />
        <div className="min-h-screen flex flex-col">
          <main className="flex-1">{children}</main>
        </div>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
