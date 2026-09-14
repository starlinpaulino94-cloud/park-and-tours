import { describe, it, expect } from "vitest";
import {
  variablesIn, missingVariables, renderTemplate, renderMessage,
  normalizePhone, normalizeEmail, recipientFor, scheduledAt, isStale,
} from "@/lib/messaging/render";
import { DEFAULT_TEMPLATES, TEMPLATE_VARIABLES, defaultTemplate } from "@/lib/messaging/templates";

describe("mensajería — composición de la plantilla", () => {
  it("encuentra las variables, con o sin espacios, sin repetir", () => {
    expect(variablesIn("Hola {{cliente}}, {{ cliente }} tu tour {{producto}}"))
      .toEqual(["cliente", "producto"]);
  });

  it("sustituye lo que conoce", () => {
    expect(renderTemplate("Hola {{cliente}}", { cliente: "Ana" })).toBe("Hola Ana");
    expect(renderTemplate("{{pax}} pax", { pax: 4 })).toBe("4 pax");
  });

  it("un hueco que no se conoce se deja a la vista, no desaparece", () => {
    // Borrarlo daría "tu tour sale a las ." y nadie notaría el fallo hasta que
    // el cliente llamara preguntando la hora.
    expect(renderTemplate("sale a las {{hora}}.", {})).toBe("sale a las {{hora}}.");
  });

  it("una cadena vacía cuenta como ausente", () => {
    // "tu guía es " no es mejor que "tu guía es {{guia}}".
    expect(missingVariables("guía: {{guia}}", { guia: "  " })).toEqual(["guia"]);
    expect(missingVariables("guía: {{guia}}", { guia: "Luis" })).toEqual([]);
  });

  it("el cero sí es un valor", () => {
    // Un saldo de 0 es exactamente lo que el cliente necesita leer.
    expect(missingVariables("saldo {{saldo}}", { saldo: 0 })).toEqual([]);
    expect(renderTemplate("saldo {{saldo}}", { saldo: 0 })).toBe("saldo 0");
  });

  it("compone asunto y cuerpo y dice qué faltó en ambos", () => {
    const out = renderMessage(
      { subject: "Reserva {{reserva}}", body: "Hola {{cliente}}, sale a las {{hora}}" },
      { reserva: "RSV-1", cliente: "Ana" }
    );
    expect(out.subject).toBe("Reserva RSV-1");
    expect(out.body).toBe("Hola Ana, sale a las {{hora}}");
    expect(out.missing).toEqual(["hora"]);
  });
});

describe("mensajería — a quién se escribe", () => {
  it("normaliza los teléfonos como se teclean de verdad", () => {
    expect(normalizePhone("809-555-0101")).toBe("+18095550101");
    expect(normalizePhone("(809) 555 0101")).toBe("+18095550101");
    expect(normalizePhone("+1 809 555 0101")).toBe("+18095550101");
    expect(normalizePhone("18095550101")).toBe("+18095550101");
  });

  it("lo que no es un teléfono no se manda", () => {
    // Encolar un número inválido solo produce un error del proveedor más tarde.
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("preguntar")).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("1234567890123456789")).toBeNull();
  });

  it("respeta un prefijo internacional ya escrito", () => {
    expect(normalizePhone("+34 600 123 456")).toBe("+34600123456");
  });

  it("valida la forma del correo, no el buzón", () => {
    expect(normalizeEmail("  ANA@Example.COM ")).toBe("ana@example.com");
    expect(normalizeEmail("ana@example")).toBeNull();
    expect(normalizeEmail("sin arroba")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });

  it("cada canal usa su dirección", () => {
    const contact = { email: "ana@example.com", phone: "809-555-0101", whatsapp: "829-555-0202" };
    expect(recipientFor("email", contact)).toBe("ana@example.com");
    expect(recipientFor("whatsapp", contact)).toBe("+18295550202");
    expect(recipientFor("sms", contact)).toBe("+18095550101");
  });

  it("sin WhatsApp declarado se usa el teléfono: en la práctica es el mismo aparato", () => {
    expect(recipientFor("whatsapp", { phone: "809-555-0101" })).toBe("+18095550101");
  });

  it("sin por dónde escribir, la respuesta es que no hay destinatario", () => {
    expect(recipientFor("email", { phone: "809-555-0101" })).toBeNull();
    expect(recipientFor("whatsapp", { email: "ana@example.com" })).toBeNull();
  });
});

describe("mensajería — cuándo sale", () => {
  const now = new Date("2026-03-10T12:00:00Z");

  it("un recordatorio de 24 h sale la víspera", () => {
    expect(scheduledAt("2026-03-15T08:00:00Z", -24, now).toISOString())
      .toBe("2026-03-14T08:00:00.000Z");
  });

  it("si esa hora ya pasó, sale ya: el aviso sigue sirviendo", () => {
    // La reserva entró hoy para el tour de mañana: programarlo ayer lo dejaría
    // en la cola para siempre.
    expect(scheduledAt("2026-03-11T08:00:00Z", -24, now).getTime()).toBe(now.getTime());
  });

  it("sin fecha ni desfase, sale ya", () => {
    expect(scheduledAt(null, null, now).getTime()).toBe(now.getTime());
    expect(scheduledAt("no es una fecha", -24, now).getTime()).toBe(now.getTime());
  });

  it("un recordatorio caduca cuando el tour ya salió", () => {
    // Recordarle a alguien un tour al que ya fue no avisa: molesta.
    expect(isStale("2026-03-10T08:00:00Z", -24, now)).toBe(true);
    expect(isStale("2026-03-11T08:00:00Z", -24, now)).toBe(false);
  });

  it("un mensaje posterior al hecho aguanta un día", () => {
    expect(isStale("2026-03-10T06:00:00Z", 4, now)).toBe(false);
    expect(isStale("2026-03-08T06:00:00Z", 4, now)).toBe(true);
  });
});

describe("mensajería — plantillas por defecto", () => {
  it("el sistema comunica desde el primer día", () => {
    // Un módulo que exige escribir siete plantillas antes del primer correo no
    // se usa: la empresa lo deja para después y sigue avisando por WhatsApp.
    expect(defaultTemplate("booking_confirmation", "email")).toBeTruthy();
    expect(defaultTemplate("pre_tour_reminder", "whatsapp")).toBeTruthy();
  });

  it("sin versión en otro idioma cae a la española antes que no mandar nada", () => {
    expect(defaultTemplate("booking_confirmation", "email", "fr")?.language).toBe("es");
  });

  it("toda variable usada está declarada en el catálogo del editor", () => {
    // Si no, el editor no la ofrece y nadie sabe que existe.
    for (const t of DEFAULT_TEMPLATES) {
      const declared = new Set(TEMPLATE_VARIABLES[t.key]);
      const used = variablesIn(`${t.subject ?? ""}\n${t.body}`);
      const undeclared = used.filter((v) => !declared.has(v));
      expect(undeclared, `${t.key}/${t.channel} usa variables sin declarar`).toEqual([]);
    }
  });

  it("los mensajes de WhatsApp no llevan asunto y son cortos", () => {
    // Se leen en la pantalla de bloqueo; un correo entero ahí no se lee.
    for (const t of DEFAULT_TEMPLATES.filter((x) => x.channel === "whatsapp")) {
      expect(t.subject, `${t.key} no debe llevar asunto`).toBeUndefined();
      expect(t.body.length, `${t.key} es demasiado largo para WhatsApp`).toBeLessThan(400);
    }
  });

  it("el recordatorio pre-tour dice lo único que importa la víspera", () => {
    // La hora y el sitio de recogida: no un 'gracias por su compra'.
    for (const t of DEFAULT_TEMPLATES.filter((x) => x.key === "pre_tour_reminder")) {
      expect(t.body).toContain("{{hora_recogida}}");
      expect(t.body).toContain("{{lugar_recogida}}");
      expect(t.offset_hours).toBe(-24);
    }
  });
});
