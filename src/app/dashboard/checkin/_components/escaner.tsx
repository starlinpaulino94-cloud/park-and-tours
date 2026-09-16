"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/tf/icon";

/**
 * ESCANEAR EL VOUCHER CON LA CÁMARA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACÍA FALTA
 *
 * El voucher lleva su QR impreso desde el kit de documentos, y hasta ahora
 * NADIE podía leerlo: el guía tenía que mirar el papel y teclear el código a
 * mano, en la puerta del bus, con cuarenta personas esperando y el sol en la
 * pantalla. Un QR que nadie escanea es un adorno caro.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS LECTORES, Y NINGUNO OBLIGATORIO
 *
 *  · Si el navegador trae `BarcodeDetector` —Android y Chrome de escritorio— se
 *    usa ese: lo resuelve el sistema, gasta menos batería y lee mejor de lejos.
 *  · Si no —hoy, iPhone— se carga `jsQR` BAJO DEMANDA y se decodifica cada
 *    cuadro en un lienzo. Solo pesa cuando alguien abre el escáner, así que
 *    quien nunca lo usa no paga por él.
 *
 * Y si la cámara falla o se deniega el permiso, el campo de texto sigue ahí:
 * escanear ACELERA el check-in, nunca es el único camino. Un guía en la playa
 * con el permiso mal dado no se puede quedar sin poder embarcar a nadie.
 */

/** El tipo nativo no está en las definiciones estándar todavía. */
interface DetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

type Estado = "idle" | "starting" | "scanning" | "denied" | "unsupported";

const MENSAJE: Record<Estado, string> = {
  idle: "",
  starting: "Abriendo la cámara…",
  scanning: "Apunta al QR del voucher",
  denied: "No diste permiso a la cámara. Puedes escribir el código a mano.",
  unsupported: "Este dispositivo no permite escanear. Escribe el código a mano.",
};

export function EscanerQR({ onCode }: { onCode: (code: string) => void }) {
  const [estado, setEstado] = useState<Estado>("idle");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<number | null>(null);
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  const stop = useCallback(() => {
    if (loopRef.current !== null) {
      window.clearTimeout(loopRef.current);
      loopRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setEstado("idle");
  }, []);

  // Si la pantalla se cierra con la cámara abierta, se apaga: dejarla encendida
  // se come la batería del teléfono con el que queda media jornada por delante.
  useEffect(() => stop, [stop]);

  const emitir = useCallback((valor: string) => {
    const code = valor.trim();
    if (!code) return;
    // El mismo código dos veces seguidas es el mismo papel todavía delante de
    // la cámara, no un segundo pasajero.
    const ahora = Date.now();
    if (lastRef.current.code === code && ahora - lastRef.current.at < 3000) return;
    lastRef.current = { code, at: ahora };
    // Una vibración corta: en la puerta del bus no se oye nada y no se mira la
    // pantalla, así que el aviso tiene que ser algo que se siente.
    navigator.vibrate?.(60);
    onCode(code);
  }, [onCode]);

  const start = useCallback(async () => {
    setEstado("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // La trasera: la frontal apunta a la cara del guía.
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      const Native = (window as unknown as { BarcodeDetector?: new (o: unknown) => DetectorLike }).BarcodeDetector;
      const detector: DetectorLike | null = Native ? new Native({ formats: ["qr_code"] }) : null;
      const jsQR = detector ? null : (await import("jsqr")).default;

      setEstado("scanning");

      const tick = async () => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || !streamRef.current) return;

        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          try {
            if (detector) {
              const found = await detector.detect(video);
              if (found[0]?.rawValue) emitir(found[0].rawValue);
            } else if (jsQR) {
              const width = video.videoWidth;
              const height = video.videoHeight;
              if (width && height) {
                canvas.width = width;
                canvas.height = height;
                const context = canvas.getContext("2d", { willReadFrequently: true });
                if (context) {
                  context.drawImage(video, 0, 0, width, height);
                  const image = context.getImageData(0, 0, width, height);
                  const result = jsQR(image.data, width, height, { inversionAttempts: "dontInvert" });
                  if (result?.data) emitir(result.data);
                }
              }
            }
          } catch {
            // Un cuadro que no se pudo leer no es un error: se intenta el
            // siguiente. Cortar aquí apagaría el escáner por una sombra.
          }
        }
        // Cinco cuadros por segundo: suficiente para que se sienta instantáneo y
        // poco para que el teléfono no se caliente en una mañana de trabajo.
        loopRef.current = window.setTimeout(tick, 200);
      };
      void tick();
    } catch (err) {
      const name = (err as { name?: string })?.name || "";
      setEstado(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unsupported");
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, [emitir]);

  const activo = estado === "starting" || estado === "scanning";

  return (
    <div className="space-y-2">
      {!activo ? (
        <Button variant="outline" onClick={start} className="gap-1.5">
          <Icon name="ScanLine" className="size-4" /> Escanear QR
        </Button>
      ) : (
        <Button variant="outline" onClick={stop} className="gap-1.5">
          <Icon name="X" className="size-4" /> Cerrar cámara
        </Button>
      )}

      {activo && (
        <div className="relative overflow-hidden rounded-xl border border-border bg-black">
          <video ref={videoRef} playsInline muted className="aspect-[4/3] w-full object-cover" />
          {/* La mira: sin ella nadie sabe a qué distancia poner el papel. */}
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="size-40 rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
          <canvas ref={canvasRef} className="hidden" />
        </div>
      )}

      {MENSAJE[estado] && (
        <p className={`text-xs ${estado === "denied" || estado === "unsupported" ? "text-amber-600" : "text-muted-foreground"}`}>
          {MENSAJE[estado]}
        </p>
      )}
    </div>
  );
}
