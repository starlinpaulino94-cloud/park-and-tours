// src/app/layout.tsx
import React from "react";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
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
/**
 * ────────────────────────────────────────────────────────────────────────────
 * Y SE SIRVEN DESDE AQUÍ, NO DESDE GOOGLE.
 *
 * `next/font/google` no es una etiqueta `<link>`: DESCARGA la tipografía
 * durante el `build` y luego parsea el CSS que le devuelven. O sea que cada
 * compilación —y cada despliegue— dependía de que fonts.googleapis.com
 * contestara, y contestara bien.
 *
 * El 29-sep eso tumbó el CI con este error, que no menciona la red por ningún
 * lado:
 *
 *     src/app/layout.tsx
 *     An error occurred in `next/font`.
 *     TypeError: Cannot read properties of null (reading '1')
 *         at …/@next/font/dist/google/loader.js:122:78
 *
 * Ese `null` es la expresión regular que parsea el CSS de Google sin casar:
 * llegó algo que no era el CSS esperado. Un fallo de red disfrazado de fallo
 * de tipos, en un fichero que nadie había tocado.
 *
 * Con los ficheros dentro del repositorio, el build no sale a Internet. Es la
 * diferencia entre «compila» y «compila si un tercero está de buenas».
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE **NO** CAMBIA, Y CONVIENE NO PROMETER DE MÁS
 *
 * Los BYTES que descarga el navegador son EXACTAMENTE LOS MISMOS. Medido, no
 * supuesto: pidiéndole a Google los seis pesos sueltos
 * (`wght@300;400;500;600;700;800`) devuelve, para el subconjunto latino, el
 * mismo y único fichero variable de 24 836 bytes que está aquí guardado —
 * `xn7gYHE41ni1AdIRggexSg.woff2`—. No había seis ficheros que ahorrar.
 *
 * Lo que cambia es de DÓNDE y CUÁNDO salen: de este repositorio al compilar,
 * en vez de de un servidor ajeno.
 *
 * Son los mismos binarios que servía Google (Manrope v20 y Geist Mono v6,
 * subconjunto latino, eje de peso completo), así que el dibujo en pantalla es
 * idéntico: mismas métricas, mismo interletraje, mismos pesos.
 *
 * La única diferencia real es el respaldo mientras carga: con Google, Next
 * conoce las métricas exactas de cada familia y ajusta la fuente de respaldo
 * para que el texto no salte al cambiar. Aquí eso se aproxima con Arial, que
 * es lo que `next/font/local` sabe hacer. Para la monoespaciada se desactiva a
 * propósito: aproximar una monoespaciada con Arial desplaza más de lo que
 * corrige, y su respaldo es el monoespaciado del sistema.
 */
const body = localFont({
  src: "./fonts/manrope-latin-variable.woff2",
  variable: "--font-manrope",
  // El fichero es VARIABLE y cubre el eje entero de Manrope. Declarar aquí el
  // rango —y no los seis pesos de antes— es lo que deja que `font-weight: 550`
  // o cualquier valor intermedio se dibuje de verdad en vez de redondearse.
  weight: "200 800",
  style: "normal",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

const mono = localFont({
  src: "./fonts/geist-mono-latin-variable.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  style: "normal",
  display: "swap",
  fallback: ["ui-monospace", "monospace"],
  // Ver arriba: Arial no es un respaldo razonable para una monoespaciada.
  adjustFontFallback: false,
});

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
