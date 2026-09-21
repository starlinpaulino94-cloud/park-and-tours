import type { Metadata } from "next";
import { loadSurvey } from "@/lib/voice-service";
import { SURVEY_DICTIONARY, normalizeLocale, translator, formatDateFor, DEFAULT_LOCALE } from "@/lib/i18n";
import { SurveyForm } from "./_components/survey-form";

/**
 * LA ENCUESTA DE DESPUÉS DEL VIAJE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PARA QUIÉN ES
 *
 * Para alguien que acaba de llegar al hotel, cansado, con el móvil en la mano y
 * un correo abierto. No hay sesión, no hay menú y no hay nada que aprender: una
 * pregunta, once botones grandes, y quien quiera contar más, cuenta más.
 *
 * Todo lo que se le pide de más baja la tasa de respuesta, y una encuesta que
 * no contesta nadie no mide nada — que es exactamente el estado del que venimos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL IDIOMA LO PONE LA FICHA DEL CLIENTE, NO EL NAVEGADOR
 *
 * Quien reservó en inglés recibió el correo en inglés y abre este enlace desde
 * ese correo, muchas veces ya en su casa y con el teléfono en otro idioma. La
 * encuesta sigue al cliente.
 */

export const dynamic = "force-dynamic";

/**
 * No se indexa.
 *
 * Es una página personal atada a un viaje concreto: que aparezca en un
 * buscador no tiene ningún sentido y sí tiene un coste —los rastreadores
 * abrirían enlaces de encuesta de clientes reales—.
 */
export const metadata: Metadata = {
  title: "¿Cómo te fue?",
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const survey = await loadSurvey(String(token ?? ""));

  const locale = normalizeLocale(survey?.language) ?? DEFAULT_LOCALE;
  const t = translator(SURVEY_DICTIONARY, locale);

  if (!survey) {
    return <Aviso titulo={t("survey.missingTitle")} cuerpo={t("survey.missingBody")} />;
  }

  // Ya contestada o caducada: se dice y no se le enseña el formulario. Dejarle
  // puntuar otra vez para contestarle «no vale» al enviar es hacerle perder el
  // tiempo dos veces.
  if (survey.status === "answered") {
    return <Aviso titulo={t("survey.doneTitle")} cuerpo={t("survey.doneBody")} empresa={survey.companyName} />;
  }
  if (survey.status !== "pending") {
    return <Aviso titulo={t("survey.expiredTitle")} cuerpo={t("survey.expiredBody")} empresa={survey.companyName} />;
  }

  return (
    <SurveyForm
      token={survey.token}
      locale={locale}
      companyName={survey.companyName}
      productName={survey.productName}
      travelDate={survey.travelDate ? formatDateFor(locale, survey.travelDate) : ""}
      customerName={survey.customerName}
    />
  );
}

function Aviso({ titulo, cuerpo, empresa }: { titulo: string; cuerpo: string; empresa?: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
      <p className="text-muted-foreground">{cuerpo}</p>
      {empresa ? <p className="mt-6 text-sm text-muted-foreground">{empresa}</p> : null}
    </main>
  );
}
