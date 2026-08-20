// src/app/layout.tsx
import React from "react";
import type { Metadata } from "next";
import { Fraunces, Manrope, Space_Grotesk, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ScriptExecutor } from "@/components/ScriptExecutor";
import { DevToolsHandler } from "@/components/DevToolsHandler";
import { GlobalErrorCatcher } from "@/components/GlobalErrorCatcher";
import { TemporalLinkBanner } from "@/components/TemporalLinkBanner";
import { Toaster } from "@/components/ui/sonner";

const display = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});
const body = Manrope({ variable: "--font-body", subsets: ["latin"], weight: ["300", "400", "500", "600", "700", "800"] });
// Dedicated face for figures: money, counts, percentages. Geometric lining
// digits of uniform width, so amounts stay aligned and read far lighter than
// the Fraunces display serif that used to render them.
const numeric = Space_Grotesk({ variable: "--font-num", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
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
      <body className={`${display.variable} ${body.variable} ${numeric.variable} ${mono.variable} antialiased`}>
        <GlobalErrorCatcher />
        <ScriptExecutor />
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
