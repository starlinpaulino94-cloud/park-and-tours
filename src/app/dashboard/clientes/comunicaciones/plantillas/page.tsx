"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { MESSAGE_CHANNEL, MESSAGE_TEMPLATE_KEY } from "@/lib/labels-modules";
import { ACTIVE_STATUS } from "@/lib/labels";
import { optionsFrom, LANGUAGE_OPTIONS } from "@/components/tf/options";
import { TEMPLATE_VARIABLES, TEMPLATE_TRIGGER } from "@/lib/messaging/templates";

/**
 * El texto de cada aviso.
 *
 * El sistema trae una plantilla por defecto para cada hecho, así que comunica
 * desde el primer día; lo que se escribe aquí la sustituye. Es lo que permite
 * que la empresa hable con su voz —y en el idioma de su cliente— sin tocar
 * código ni esperar a nadie.
 */
const VARIABLE_HELP = Object.entries(TEMPLATE_VARIABLES)
  .map(([key, vars]) => `${MESSAGE_TEMPLATE_KEY[key]?.label ?? key}: {{${vars.join("}} · {{")}}}`)
  .join("\n");

export default function Page() {
  return (
    <SimpleResource
      resource="message_template"
      eyebrow="Clientes"
      title="Plantillas de mensajes"
      description="El texto de cada aviso automático. Lo que no reescribas aquí sale con la plantilla que trae el sistema."
      emptyIcon="FileText"
      emptyTitle="Todavía usas las plantillas del sistema"
      emptyDescription="Escribe la tuya para cualquiera de los avisos y sustituirá a la de serie, sin tocar nada más."
      createLabel="Nueva plantilla"
      filters={[
        { name: "key", label: "Aviso", dict: MESSAGE_TEMPLATE_KEY },
        { name: "channel", label: "Canal", dict: MESSAGE_CHANNEL },
      ]}
      fields={[
        { name: "key", label: "Aviso", type: "select", required: true, options: optionsFrom(MESSAGE_TEMPLATE_KEY),
          help: "Cuándo sale: " + Object.values(TEMPLATE_TRIGGER).join(" · ") },
        { name: "channel", label: "Canal", type: "select", required: true, defaultValue: "email",
          options: optionsFrom(MESSAGE_CHANNEL) },
        { name: "language", label: "Idioma", type: "select", defaultValue: "es", options: LANGUAGE_OPTIONS },
        { name: "status", label: "Estado", type: "select", defaultValue: "active",
          options: optionsFrom(ACTIVE_STATUS) },
        { name: "offset_hours", label: "Horas de desfase", type: "number",
          help: "Respecto al hecho que lo dispara. Negativo = antes: el recordatorio de la víspera es −24." },
        { name: "subject", label: "Asunto", span: 2,
          help: "Solo para correo. WhatsApp y SMS no llevan asunto." },
        { name: "body", label: "Texto", type: "textarea", span: 2, required: true,
          help: `Variables disponibles por aviso —\n${VARIABLE_HELP}` },
        { name: "notes", label: "Notas internas", type: "textarea", span: 2 },
      ]}
      columns={[
        { key: "key", header: "Aviso", kind: "badge", dict: MESSAGE_TEMPLATE_KEY },
        { key: "channel", header: "Canal", kind: "badge", dict: MESSAGE_CHANNEL },
        { key: "language", header: "Idioma" },
        { key: "subject", header: "Asunto" },
        { key: "offset_hours", header: "Desfase", kind: "number", align: "right" },
        { key: "status", header: "Estado", kind: "badge", dict: ACTIVE_STATUS },
      ]}
    />
  );
}
