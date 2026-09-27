import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  variablesIn, missingVariables, renderTemplate, renderMessage,
  normalizePhone, normalizeEmail, recipientFor, scheduledAt, isStale,
} from "@/lib/messaging/render";
import { DEFAULT_TEMPLATES, TEMPLATE_VARIABLES, defaultTemplate } from "@/lib/messaging/templates";
import { PUBLICOS_DEL_MANIFIESTO } from "@/lib/manifiesto-envio";

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

describe("las claves de plantilla que el código declara y las que la base admite", () => {
  /**
   * LA RESTRICCIÓN QUE MENTÍA DURANTE VARIAS FASES.
   *
   * `message_template_key_check` (0034) enumeraba SIETE claves. El código
   * declaraba OCHO desde que existe la plantilla de cambio de fecha: una empresa
   * que intentara reescribir el texto de «te movemos la excursión» se llevaba un
   * 23514 de PostgreSQL, y nada en la aplicación lo anticipaba — el formulario de
   * plantillas ofrecía una clave que la base rechazaba.
   *
   * No se podía ver leyendo el código, porque la lista de verdad estaba en SQL.
   * Esta guarda lee las dos y las compara: es la única forma de que la próxima
   * clave nueva no repita exactamente el mismo fallo.
   */
  const MIGRACIONES = "supabase/migrations";

  /** La última definición de la restricción, que es la que manda. */
  function clavesEnLaBase(): string[] {
    const archivos = readdirSync(MIGRACIONES).filter((f) => f.endsWith(".sql")).sort();
    let ultima: string | null = null;
    for (const archivo of archivos) {
      const sql = readFileSync(`${MIGRACIONES}/${archivo}`, "utf8");
      const m = [...sql.matchAll(
        /add\s+constraint\s+message_template_key_check\s+check\s*\(\s*key\s+in\s*\(([\s\S]*?)\)\s*\)/gi
      )];
      if (m.length > 0) ultima = m[m.length - 1][1];
    }
    if (!ultima) throw new Error("ninguna migración define message_template_key_check");
    return [...ultima.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
  }

  it("dicen exactamente lo mismo", () => {
    const enElCodigo = Object.keys(TEMPLATE_VARIABLES).sort();
    expect(clavesEnLaBase()).toEqual(enElCodigo);
  });

  /**
   * La misma lectura, para las dos restricciones que 0090 reescribe. Ninguna de
   * las dos la mira el código: PostgREST acepta la columna y solo rechazaría el
   * valor al escribirlo, así que un `check` que no admita `manifest` no rompe
   * nada hasta que un manifiesto de verdad intenta salir — en producción, de
   * madrugada, con el autobús esperando.
   */
  function valoresDeCheck(constraint: string): string[] {
    const archivos = readdirSync(MIGRACIONES).filter((f) => f.endsWith(".sql")).sort();
    let ultima: string | null = null;
    for (const archivo of archivos) {
      const sql = readFileSync(`${MIGRACIONES}/${archivo}`, "utf8");
      const m = [...sql.matchAll(
        new RegExp(`add\\s+constraint\\s+${constraint}\\s+check\\s*\\(([\\s\\S]*?)\\);`, "gi")
      )];
      if (m.length > 0) ultima = m[m.length - 1][1];
    }
    if (!ultima) throw new Error(`ninguna migración define ${constraint}`);
    return [...ultima.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
  }

  it("el manifiesto cabe como documento adjunto", () => {
    expect(valoresDeCheck("message_attachment_kind_check")).toEqual(["manifest", "quote", "voucher"]);
  });

  it("y los recortes que la base admite son EXACTAMENTE los que el código conoce", () => {
    /**
     * Si la base admitiera uno que el código no reconoce, ese adjunto no se
     * compondría nunca y nadie sabría por qué. Si el código usara uno que la base
     * no admite, la fila no se podría ni encolar.
     */
    expect(valoresDeCheck("message_attachment_scope_check")).toEqual([...PUBLICOS_DEL_MANIFIESTO].sort());
  });

  it("y toda clave declarada trae su plantilla de verdad", () => {
    // Una clave en la unión sin plantilla detrás es un desplegable que ofrece
    // algo que no existe.
    for (const key of Object.keys(TEMPLATE_VARIABLES)) {
      expect(DEFAULT_TEMPLATES.some((t) => t.key === key), key).toBe(true);
    }
  });
});

describe("el manifiesto es la única plantilla que no va a un cliente", () => {
  const manifiestos = () => DEFAULT_TEMPLATES.filter((t) => t.key === "manifest_dispatch");

  it("sale EN CUANTO SE SABE, no programado respecto a la salida", () => {
    /**
     * Con `offset_hours: -24`, el barrido diario de las 6:00 lo habría dejado
     * programado para una hora antes de la salida — cuando el chofer ya va camino
     * del primer hotel. La ventana la decide quien encola (`vetoDeEnvio`).
     */
    for (const t of manifiestos()) expect(t.offset_hours, t.channel).toBeUndefined();
  });

  it("no depende del teléfono que la empresa haya rellenado en su ficha", () => {
    /**
     * Un hueco sin rellenar NO se manda. En los demás avisos eso es correcto: un
     * cliente que recibe «escríbenos a » no sabe a dónde. Aquí el destinatario es
     * el guía o el transportista, que ya tienen el número de la oficina — y una
     * operadora que no rellenó su propio teléfono se habría quedado sin mandar
     * NINGÚN manifiesto, con el autobús saliendo igual.
     */
    for (const t of manifiestos()) {
      expect(t.body, t.channel).not.toContain("{{telefono_empresa}}");
      expect(t.subject || "", t.channel).not.toContain("{{telefono_empresa}}");
    }
    expect(TEMPLATE_VARIABLES.manifest_dispatch).not.toContain("telefono_empresa");
  });

  it("lleva lo que hace falta para operar, en los dos canales y los dos idiomas", () => {
    // Cuatro: correo y WhatsApp, español e inglés.
    expect(manifiestos()).toHaveLength(4);
    for (const t of manifiestos()) {
      for (const variable of ["{{producto}}", "{{fecha}}", "{{hora}}", "{{pax}}", "{{paradas}}"]) {
        expect(t.body, `${t.channel}/${t.language} sin ${variable}`).toContain(variable);
      }
    }
  });

  it("y el WhatsApp manda al correo por la lista, en vez de intentar llevarla", () => {
    // Un mensaje se reenvía de un grupo a otro sin pensarlo y una captura viaja
    // más lejos que un adjunto.
    for (const t of manifiestos().filter((x) => x.channel === "whatsapp")) {
      expect(t.body.toLowerCase(), t.language).toMatch(/correo|email/);
    }
  });
});
