// src/app/layout.tsx
import React from "react";
import type { Metadata } from "next";
import { Fraunces, Manrope, Space_Grotesk, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { DevToolsHandler } from "@/components/DevToolsHandler";
import { GlobalErrorCatcher } from "@/components/GlobalErrorCatcher";
import { TemporalLinkBanner } from "@/components/TemporalLinkBanner";
import { Toaster } from "@/components/ui/sonner";

const display = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});
const body = Manrope({ variable: "--font-manrope", subsets: ["latin"], weight: ["300", "400", "500", "600", "700", "800"] });
// Full Space Grotesk, used by `.tf-num` when a whole string is a figure
// (e.g. "RD$67,000" — the currency letters should match the digits).
const grotesk = Space_Grotesk({ variable: "--font-grotesk", subsets: ["latin"], weight: ["400", "500", "600", "700"] });

// Space Grotesk restricted to figures and signs, i.e. the codepoints:
//   # $ % ( ) + , - . / 0-9 : < = > ¢ £ ¤ ¥ ° ± ² ³ µ · ¹ ¼ ½ ¾ × ÷ – — ‰ ′ ″ ⁄ € ↑ ↓ − ∕
// Letters are deliberately excluded, so the browser falls through to the next
// family in the stack for them: prose keeps Manrope, headings keep Fraunces.
// This font sits FIRST in every stack (see --font-sans / --font-display in
// globals.css), so all numbers and signs across the app render in it with no
// per-element class needed.
// NOTE: the unicode-range must be an inline literal — Next's font loader
// rejects values it cannot statically evaluate ("Font loader values must be
// explicitly written literals").
const figures = localFont({
  src: "./fonts/space-grotesk-latin-var.woff2",
  variable: "--font-figures",
  weight: "300 700",
  display: "swap",
  // MUST stay false. Next would otherwise emit a metric-adjusted fallback face
  // that carries NO unicode-range, so it would match every character and
  // hijack all body text instead of just the digits.
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0023-0025, U+0028-0029, U+002B-003A, U+003C-003E, U+00A2-00A5, U+00B0-00B7, U+00B9-00BE, U+00D7, U+00F7, U+2013-2014, U+2030, U+2032-2033, U+2044, U+20AC, U+2191, U+2193, U+2212, U+2215",
    },
  ],
});

const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "TourFlow — Sistema integral de gestión turística",
  description:
    "ERP, OMS y motor de reservas para parques, excursiones, tour centers y agencias. Multiempresa, multicanal y multidivisa.",
};

// SUPER IMPORTANT: NOT EDIT THE FOLLOWING 2 LINES TO FORCE NEXT.JS TO RENDER DYNAMICALLY
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body
        className={`${figures.variable} ${display.variable} ${body.variable} ${grotesk.variable} ${mono.variable} antialiased`}
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
