import type { Metadata } from "next";
import { abrirEnlace, MENSAJE_DEL_ENLACE } from "@/lib/respuesta-proveedor";
import { RespuestaForm } from "./_components/respuesta-form";

/**
 * EL SERVICIO, PARA CONFIRMARLO DE UN CLIC.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PARA QUIÉN ES
 *
 * Para un transportista con cuatro guaguas que recibe un WhatsApp a las siete
 * de la tarde. No hay sesión, no hay menú y no hay nada que aprender: qué
 * servicio es, cuándo, dónde, cuánta gente, y dos botones.
 *
 * Todo lo que se le pida de más acaba en que conteste por WhatsApp y alguien de
 * la casa lo escriba a mano — que es de donde venimos y donde se pierden las
 * confirmaciones.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ABRIR NO ES USAR
 *
 * Esta página se pinta en el servidor, y pintarla ANOTA la apertura (0087).
 * Eso incluye al robot que previsualiza el enlace en WhatsApp: cuenta como
 * apertura y no como uso. El enlace se gasta al CONTESTAR, no al mirar, que es
 * la única forma de que una previsualización no le queme la respuesta a nadie.
 */

export const dynamic = "force-dynamic";

/**
 * No se indexa.
 *
 * Es una credencial en una dirección. Que un buscador la recorra sería repartir
 * enlaces de confirmación por internet.
 */
export const metadata: Metadata = {
  title: "Confirma tu servicio",
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const vista = await abrirEnlace(String(token ?? ""));

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-6 px-4 py-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Confirma tu servicio</h1>
        <p className="text-sm text-muted-foreground">
          Dinos si puedes prestarlo. Con eso nos basta: no hace falta que entres a ningún sitio.
        </p>
      </header>

      {vista.servicio ? (
        <section className="rounded-lg border bg-card p-4 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <Dato termino="Excursión" valor={vista.servicio.producto} />
            <Dato termino="Cuándo" valor={cuando(vista.servicio.service_date)} />
            <Dato termino="Punto de encuentro" valor={vista.servicio.punto_de_encuentro} />
            <Dato termino="Pasajeros" valor={vista.servicio.pax ? String(vista.servicio.pax) : null} />
            <Dato termino="Lo que se te pide" valor={vista.servicio.detalle} />
          </dl>
          {vista.servicio.confirmation_number ? (
            <p className="mt-4 rounded-md bg-muted p-3">
              Número de confirmación:{" "}
              <span className="font-mono font-semibold">{vista.servicio.confirmation_number}</span>
            </p>
          ) : null}
        </section>
      ) : null}

      {vista.ok ? (
        <RespuestaForm token={String(token ?? "")} />
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          {MENSAJE_DEL_ENLACE[vista.motivo ?? "not_found"]}
        </p>
      )}

      {/*
        Ni un nombre de cliente, ni un teléfono, ni una habitación. Esta página
        se abre SIN CONTRASEÑA: enseña lo justo para decidir si se acepta. Los
        datos de cada parada están en la hoja de ruta, que sí exige entrar.
      */}
      <p className="text-xs text-muted-foreground">
        Los datos de cada pasajero están en la hoja de ruta del día, no aquí.
      </p>
    </main>
  );
}

function Dato({ termino, valor }: { termino: string; valor: string | null }) {
  return (
    <>
      <dt className="text-muted-foreground">{termino}</dt>
      <dd className="font-medium">{valor || "—"}</dd>
    </>
  );
}

function cuando(fecha: string | null): string | null {
  if (!fecha) return null;
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("es-DO", { dateStyle: "full", timeStyle: "short" });
}
