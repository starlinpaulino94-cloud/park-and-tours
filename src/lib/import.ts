import type { AppRole } from "@/lib/auth";

/**
 * El importador, como decisión pura: leer el archivo, entender sus columnas,
 * validar cada fila y decir exactamente qué va a pasar ANTES de escribir nada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO DECIDE SI UN CLIENTE SE MUDA
 *
 * Una operadora que cambia de sistema llega con cientos de clientes, decenas de
 * productos y su lista de proveedores en Excel. Sin importador, la migración es
 * teclear una semana, y nadie se muda: es la primera pregunta de cualquier
 * demostración y la última excusa para no firmar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL ARCHIVO VIENE DEL EXCEL DE UNA PERSONA, NO DE UNA API
 *
 * Y eso cambia todo. Un CSV exportado por Excel en español trae:
 *
 *   · PUNTO Y COMA como separador, porque la coma es el decimal.
 *   · BOM al principio (`\uFEFF`), que convierte la primera cabecera en basura
 *     invisible: `nombre` deja de coincidir con `nombre` y nadie ve por qué.
 *   · Saltos de línea DENTRO de celdas entrecomilladas (una dirección, una nota).
 *   · Comillas dobladas (`""`) para escapar una comilla.
 *   · CRLF de Windows.
 *   · Cabeceras con acentos, mayúsculas y espacios de más.
 *   · Números como «1.250,50» y fechas como «31/12/2026».
 *
 * Por eso el parser se escribe aquí y se prueba, en vez de dar por bueno un
 * `split(",")` —que rompe en la primera dirección con coma— o arrastrar una
 * dependencia cuyo comportamiento con estos casos habría que probar igual.
 */

/* ------------------------------------------------------------ el parser */

export interface ParsedFile {
  headers: string[];
  rows: string[][];
  delimiter: string;
  /** Filas con distinto número de celdas que la cabecera: se avisan, no se tiran. */
  ragged: number[];
}

/**
 * Detecta el separador contando candidatos FUERA de las comillas en la primera
 * línea lógica. Contarlos a lo bruto elegiría la coma en un archivo con punto y
 * coma cuya primera celda sea «Pérez, Juan».
 */
export function detectDelimiter(text: string): string {
  const candidates = [";", ",", "\t", "|"];
  const firstLine = (() => {
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"') quoted = !quoted;
      else if (!quoted && (ch === "\n" || ch === "\r")) return text.slice(0, i);
    }
    return text;
  })();

  let best = ",";
  let bestCount = 0;
  for (const d of candidates) {
    let count = 0;
    let quoted = false;
    for (let i = 0; i < firstLine.length; i++) {
      const ch = firstLine[i];
      if (ch === '"') quoted = !quoted;
      else if (!quoted && ch === d) count++;
    }
    if (count > bestCount) { best = d; bestCount = count; }
  }
  return best;
}

/**
 * Lee un CSV/TSV completo respetando comillas, escapes y saltos internos.
 *
 * Devuelve TODAS las filas, incluidas las que no cuadran en número de celdas:
 * descartarlas en silencio es cómo se pierden veinte clientes en una
 * importación que dijo «listo».
 */
export function parseDelimited(input: string, forcedDelimiter?: string): ParsedFile {
  // El BOM fuera antes de nada: si sobrevive, la primera cabecera nunca cuadra
  // con su alias y el usuario ve «columna sin reconocer» sobre una columna que
  // está perfectamente escrita.
  const text = input.replace(/^\uFEFF/, "");
  const delimiter = forcedDelimiter || detectDelimiter(text);

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;

  const pushCell = () => { row.push(cell); cell = ""; };
  const pushRow = () => { pushCell(); rows.push(row); row = []; };

  while (i < text.length) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; } // comilla escapada
        quoted = false; i++; continue;
      }
      cell += ch; i++; continue;
    }

    if (ch === '"') { quoted = true; i++; continue; }
    if (ch === delimiter) { pushCell(); i++; continue; }
    if (ch === "\r") { i++; continue; }                 // CRLF de Windows
    if (ch === "\n") { pushRow(); i++; continue; }
    cell += ch; i++;
  }
  // La última fila, si el archivo no termina en salto de línea.
  if (cell !== "" || row.length > 0) pushRow();

  // Filas totalmente vacías: son el salto final o una separación visual, y no
  // aportan nada. Se quitan sin avisar porque no son un error del usuario.
  const clean = rows.filter((r) => r.some((c) => c.trim() !== ""));
  const headers = (clean.shift() || []).map((h) => h.trim());
  const ragged = clean
    .map((r, idx) => (r.length === headers.length ? -1 : idx))
    .filter((idx) => idx >= 0);

  return { headers, rows: clean, delimiter, ragged };
}

/* -------------------------------------------------- normalizar cabeceras */

/** Sin acentos, sin signos y en minúsculas: «Teléfono móvil» → «telefono movil». */
export function normalizeHeader(header: string): string {
  return header
    .normalize("NFD").replace(/[\u0300-\u036F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/* ------------------------------------------------------------- destinos */

export type FieldType = "text" | "number" | "date" | "email" | "phone" | "list" | "enum";

export interface ImportField {
  /** Columna real de la tabla. */
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Cabeceras que se reconocen solas, ya normalizadas. */
  aliases: string[];
  /** Para `enum`: valores admitidos por la base. */
  values?: string[];
}

export interface ImportTarget {
  key: string;
  label: string;
  /** Recurso del ERP (y por tanto tabla y permisos). */
  resource: string;
  description: string;
  minRole: AppRole;
  /** Métrica del plan que consume, si tiene techo. */
  limitMetric?: "max_products" | null;
  fields: ImportField[];
  /** Campos con los que se detecta que la fila YA existe. */
  dedupeBy: string[][];
}

const f = (
  name: string, label: string, type: FieldType,
  aliases: string[], extra: Partial<ImportField> = {}
): ImportField => ({ name, label, type, aliases: aliases.map(normalizeHeader), ...extra });

/**
 * Lo que se puede importar hoy, en el orden en que una operadora lo necesita:
 * primero su gente, después su catálogo, después con quién trabaja.
 *
 * Las reservas históricas NO están, y es deliberado: una reserva necesita
 * cliente, producto, salida con cupo y estado de cobro, y una importación que
 * los invente deja el sistema mintiendo sobre su propia disponibilidad. Entran
 * cuando el resto esté importado y se pueda cruzar de verdad.
 */
export const IMPORT_TARGETS: ImportTarget[] = [
  {
    key: "customer",
    label: "Clientes",
    resource: "customer",
    description: "Tu cartera: nombre, contacto, idioma y procedencia.",
    minRole: "seller",
    fields: [
      f("first_name", "Nombre", "text", ["nombre", "first name", "nombres", "cliente"], { required: true }),
      f("last_name", "Apellido", "text", ["apellido", "apellidos", "last name", "surname"]),
      f("email", "Correo", "email", ["correo", "email", "e mail", "correo electronico"]),
      f("phone", "Teléfono", "phone", ["telefono", "phone", "tel", "movil", "celular", "telefono movil"]),
      f("whatsapp", "WhatsApp", "phone", ["whatsapp", "wasap", "whats app"]),
      f("document_id", "Documento", "text", ["documento", "cedula", "pasaporte", "dni", "identificacion", "document id"]),
      f("nationality", "Nacionalidad", "text", ["nacionalidad", "nationality"]),
      f("country", "País", "text", ["pais", "country"]),
      f("language", "Idioma", "text", ["idioma", "language", "lengua"]),
      f("address", "Dirección", "text", ["direccion", "address", "domicilio"]),
      f("birth_date", "Fecha de nacimiento", "date", ["fecha de nacimiento", "nacimiento", "birth date", "fecha nacimiento"]),
      f("tags", "Etiquetas", "list", ["etiquetas", "tags", "categorias"]),
      f("notes", "Notas", "text", ["notas", "observaciones", "notes", "comentarios"]),
    ],
    // Dos reglas, en orden: el correo identifica sin ambigüedad; sin correo, el
    // teléfono. Un nombre repetido NO es un duplicado —hay muchos Juan Pérez—.
    dedupeBy: [["email"], ["phone"]],
  },
  {
    key: "product",
    label: "Productos y tours",
    resource: "product",
    description: "Tu catálogo: nombre, duración, cupo y precio base.",
    minRole: "manager",
    limitMetric: "max_products",
    fields: [
      f("name", "Nombre", "text", ["nombre", "producto", "tour", "excursion", "name", "servicio"], { required: true }),
      f("code", "Código", "text", ["codigo", "code", "sku", "referencia"]),
      f("short_description", "Descripción corta", "text", ["descripcion corta", "resumen", "short description"]),
      f("description", "Descripción", "text", ["descripcion", "description", "detalle"]),
      f("location", "Ubicación", "text", ["ubicacion", "lugar", "location", "destino"]),
      f("meeting_point", "Punto de encuentro", "text", ["punto de encuentro", "meeting point", "encuentro"]),
      f("duration_hours", "Duración (horas)", "number", ["duracion", "duracion horas", "horas", "duration"]),
      f("default_capacity", "Cupo", "number", ["cupo", "capacidad", "capacity", "plazas", "pax"]),
      f("min_age", "Edad mínima", "number", ["edad minima", "min age", "edad"]),
      f("base_price", "Precio", "number", ["precio", "price", "precio base", "tarifa", "pvp"]),
      f("base_cost", "Costo", "number", ["costo", "coste", "cost", "precio de costo"]),
      f("currency", "Moneda", "enum", ["moneda", "currency", "divisa"],
        { values: ["usd", "dop", "eur", "mxn", "cop", "brl"] }),
      f("inclusions", "Incluye", "text", ["incluye", "inclusiones", "inclusions"]),
      f("exclusions", "No incluye", "text", ["no incluye", "exclusiones", "exclusions"]),
    ],
    // El código es la identidad cuando existe; si no, el nombre, que en un
    // catálogo propio sí es único (a diferencia del nombre de una persona).
    dedupeBy: [["code"], ["name"]],
  },
  {
    key: "supplier",
    label: "Proveedores",
    resource: "supplier",
    description: "Con quién operas: transporte, guías, restaurantes, hoteles.",
    minRole: "manager",
    fields: [
      f("name", "Nombre", "text", ["nombre", "proveedor", "supplier", "razon social", "empresa"], { required: true }),
      f("tax_id", "RNC / Cédula", "text", ["rnc", "cedula", "tax id", "identificacion fiscal", "nif"]),
      f("contact_name", "Contacto", "text", ["contacto", "persona de contacto", "contact"]),
      f("email", "Correo", "email", ["correo", "email", "e mail"]),
      f("phone", "Teléfono", "phone", ["telefono", "phone", "tel", "celular"]),
      f("address", "Dirección", "text", ["direccion", "address"]),
      f("payment_terms_days", "Días de crédito", "number", ["dias de credito", "credito", "plazo", "payment terms"]),
      f("currency", "Moneda", "enum", ["moneda", "currency"],
        { values: ["usd", "dop", "eur", "mxn", "cop", "brl"] }),
      f("notes", "Notas", "text", ["notas", "observaciones", "notes"]),
    ],
    dedupeBy: [["tax_id"], ["email"], ["name"]],
  },
  {
    key: "hotel",
    label: "Hoteles y puntos de recogida",
    resource: "hotel",
    description: "Alojamientos con su punto y su margen de recogida.",
    minRole: "operations",
    fields: [
      f("name", "Nombre", "text", ["nombre", "hotel", "alojamiento", "name"], { required: true }),
      f("address", "Dirección", "text", ["direccion", "address", "ubicacion"]),
      f("phone", "Teléfono", "phone", ["telefono", "phone", "tel"]),
      f("pickup_point", "Punto de recogida", "text", ["punto de recogida", "pickup", "recogida", "lobby"]),
      f("pickup_offset_min", "Margen de recogida (min)", "number", ["margen", "minutos", "offset", "antelacion"]),
      f("notes", "Notas", "text", ["notas", "observaciones", "notes"]),
    ],
    dedupeBy: [["name"]],
  },
];

export const targetByKey = (key: string): ImportTarget | undefined =>
  IMPORT_TARGETS.find((t) => t.key === key);

/* ------------------------------------------------------ mapeo automático */

/** Columna del archivo → campo del sistema. `null` = se ignora esa columna. */
export type Mapping = Record<number, string | null>;

/**
 * Propone el mapeo leyendo las cabeceras.
 *
 * Exacto primero y por prefijo después: «telefono 1» cae en teléfono, pero
 * «telefono» no roba la columna de «whatsapp» porque el alias exacto gana. Un
 * campo ya asignado no se reasigna: con dos columnas de teléfono, la primera se
 * queda el campo y la segunda se ignora, que es mejor que pisar la buena.
 */
export function autoMap(headers: string[], target: ImportTarget): Mapping {
  const mapping: Mapping = {};
  const taken = new Set<string>();
  const normalized = headers.map(normalizeHeader);

  for (const pass of ["exact", "prefix"] as const) {
    normalized.forEach((header, index) => {
      if (mapping[index]) return;
      if (!header) { mapping[index] = null; return; }
      for (const field of target.fields) {
        if (taken.has(field.name)) continue;
        const hit = pass === "exact"
          ? field.aliases.includes(header)
          : field.aliases.some((a) => header.startsWith(a) || a.startsWith(header));
        if (hit) { mapping[index] = field.name; taken.add(field.name); return; }
      }
    });
  }
  normalized.forEach((_, index) => { if (mapping[index] === undefined) mapping[index] = null; });
  return mapping;
}

/* --------------------------------------------------------- conversiones */

/**
 * Número escrito por una persona: «1.250,50», «$ 1,250.50», «1250».
 *
 * La ambigüedad real es `1.250`: ¿mil doscientos cincuenta, o uno coma
 * veinticinco? Se resuelve por posición —si el separador está a tres dígitos
 * del final y no hay otro separador después, es de miles—, que acierta en el
 * formato de cualquier hoja de cálculo de la región.
 */
export function parseNumber(raw: string): number | null {
  const clean = raw.replace(/[^\d.,-]/g, "").trim();
  if (!clean) return null;

  const lastComma = clean.lastIndexOf(",");
  const lastDot = clean.lastIndexOf(".");
  let normalized: string;

  if (lastComma >= 0 && lastDot >= 0) {
    // El que va después es el decimal; el otro es de miles.
    normalized = lastComma > lastDot
      ? clean.replace(/\./g, "").replace(",", ".")
      : clean.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const decimals = clean.length - lastComma - 1;
    normalized = decimals === 3 ? clean.replace(/,/g, "") : clean.replace(",", ".");
  } else if (lastDot >= 0) {
    const decimals = clean.length - lastDot - 1;
    normalized = decimals === 3 && clean.split(".").length === 2 && !clean.startsWith("0.")
      ? clean.replace(/\./g, "")
      : clean;
  } else {
    normalized = clean;
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * Fecha escrita por una persona. En esta región el formato es DÍA/MES/AÑO, y
 * leer «03/04/2026» como 4 de marzo le cambia el cumpleaños a medio archivo.
 * El formato ISO (`2026-04-03`) se reconoce aparte porque no es ambiguo.
 */
export function parseDate(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (iso) return buildDate(+iso[1], +iso[2], +iso[3]);

  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(value);
  if (dmy) {
    const year = +dmy[3] < 100 ? 2000 + +dmy[3] : +dmy[3];
    return buildDate(year, +dmy[2], +dmy[1]);
  }
  return null;
}

function buildDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Rebote del propio Date: el 31 de febrero se convierte en marzo, y aceptarlo
  // guardaría una fecha que el usuario no escribió.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/** Solo dígitos y un `+` inicial: el mismo número escrito de cinco maneras. */
export function normalizePhone(raw: string): string {
  const clean = raw.trim().replace(/[^\d+]/g, "");
  return clean.startsWith("+") ? "+" + clean.slice(1).replace(/\+/g, "") : clean.replace(/\+/g, "");
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* --------------------------------------------------------- la validación */

export interface RowIssue {
  /** Fila del ARCHIVO tal como la ve el usuario: la 1 es la cabecera. */
  line: number;
  field?: string;
  message: string;
  severity: "error" | "warning";
}

export interface PreparedRow {
  line: number;
  values: Record<string, unknown>;
  issues: RowIssue[];
  /** Clave con la que se busca si ya existe. */
  dedupe: { field: string; value: string } | null;
}

export interface Prepared {
  rows: PreparedRow[];
  /** Filas sin un solo error: las únicas que se escriben. */
  valid: PreparedRow[];
  issues: RowIssue[];
  mappedFields: string[];
}

/**
 * Convierte y valida el archivo entero SIN tocar la base.
 *
 * Una fila con un error no se escribe y no impide que las demás entren: en un
 * archivo de trescientos clientes siempre hay tres con el correo mal, y
 * rechazar el archivo completo por eso obliga a un ciclo de corrección a ciegas.
 * Lo que sí se rechaza entero es el archivo sin los campos obligatorios
 * mapeados, porque ahí no hay nada que salvar.
 */
export function prepareRows(
  parsed: ParsedFile,
  mapping: Mapping,
  target: ImportTarget
): Prepared {
  const issues: RowIssue[] = [];
  const byName = new Map(target.fields.map((f) => [f.name, f]));
  const mappedFields = Object.values(mapping).filter((v): v is string => !!v);

  for (const field of target.fields) {
    if (field.required && !mappedFields.includes(field.name)) {
      issues.push({
        line: 1,
        field: field.name,
        severity: "error",
        message: `Falta la columna obligatoria «${field.label}». Asígnala arriba para continuar.`,
      });
    }
  }

  // Duplicados DENTRO del propio archivo: dos filas con el mismo correo. Se
  // avisa en la segunda; escribir las dos crearía el duplicado que el cruce
  // contra la base pretende evitar.
  const seen = new Map<string, number>();
  const rows: PreparedRow[] = [];

  parsed.rows.forEach((cells, index) => {
    const line = index + 2; // +1 por la cabecera, +1 porque el usuario cuenta desde 1
    const values: Record<string, unknown> = {};
    const rowIssues: RowIssue[] = [];

    if (cells.length !== parsed.headers.length) {
      rowIssues.push({
        line, severity: "warning",
        message: `La fila tiene ${cells.length} columnas y la cabecera ${parsed.headers.length}. ` +
          `Revisa si falta un separador o sobra una coma.`,
      });
    }

    for (const [indexRaw, fieldName] of Object.entries(mapping)) {
      if (!fieldName) continue;
      const field = byName.get(fieldName);
      if (!field) continue;
      const raw = (cells[Number(indexRaw)] ?? "").trim();

      if (!raw) {
        if (field.required) {
          rowIssues.push({ line, field: field.name, severity: "error",
            message: `${field.label} está vacío y es obligatorio.` });
        }
        continue;
      }

      switch (field.type) {
        case "number": {
          const value = parseNumber(raw);
          if (value === null) {
            rowIssues.push({ line, field: field.name, severity: "error",
              message: `${field.label}: «${raw}» no es un número.` });
          } else values[field.name] = value;
          break;
        }
        case "date": {
          const value = parseDate(raw);
          if (value === null) {
            rowIssues.push({ line, field: field.name, severity: "error",
              message: `${field.label}: «${raw}» no es una fecha. Usa DD/MM/AAAA.` });
          } else values[field.name] = value;
          break;
        }
        case "email": {
          const value = normalizeEmail(raw);
          if (!EMAIL_RE.test(value)) {
            rowIssues.push({ line, field: field.name, severity: "error",
              message: `${field.label}: «${raw}» no parece un correo válido.` });
          } else values[field.name] = value;
          break;
        }
        case "phone":
          values[field.name] = normalizePhone(raw);
          break;
        case "list":
          values[field.name] = raw.split(/[;,|]/).map((s) => s.trim()).filter(Boolean);
          break;
        case "enum": {
          const value = raw.toLowerCase();
          if (field.values && !field.values.includes(value)) {
            rowIssues.push({ line, field: field.name, severity: "error",
              message: `${field.label}: «${raw}» no es válido. Usa uno de: ${field.values.join(", ")}.` });
          } else values[field.name] = value;
          break;
        }
        default:
          values[field.name] = raw;
      }
    }

    // La clave de duplicado: la primera regla cuyo campo venga con valor.
    let dedupe: PreparedRow["dedupe"] = null;
    for (const rule of target.dedupeBy) {
      const field = rule[0];
      const value = values[field];
      if (typeof value === "string" && value.trim()) { dedupe = { field, value }; break; }
    }

    if (dedupe) {
      const key = `${dedupe.field}:${dedupe.value.toLowerCase()}`;
      const previous = seen.get(key);
      if (previous !== undefined) {
        rowIssues.push({ line, field: dedupe.field, severity: "warning",
          message: `Repetida en el archivo: la fila ${previous} ya trae ${dedupe.field} «${dedupe.value}». Se omite.` });
      } else {
        seen.set(key, line);
      }
    }

    rows.push({ line, values, issues: rowIssues, dedupe });
  });

  const headerBlocked = issues.some((i) => i.severity === "error");
  const valid = headerBlocked
    ? []
    : rows.filter((r) => !r.issues.some((i) => i.severity === "error")
        && !r.issues.some((i) => i.message.startsWith("Repetida en el archivo")));

  return {
    rows,
    valid,
    issues: [...issues, ...rows.flatMap((r) => r.issues)],
    mappedFields,
  };
}

/** Cuenta corta para la pantalla: qué va a pasar si se confirma. */
export interface ImportSummary {
  total: number;
  create: number;
  update: number;
  skipped: number;
  errors: number;
  warnings: number;
}

export function summarize(prepared: Prepared, existingKeys: Set<string>): ImportSummary {
  let create = 0;
  let update = 0;
  for (const row of prepared.valid) {
    const key = row.dedupe ? `${row.dedupe.field}:${row.dedupe.value.toLowerCase()}` : null;
    if (key && existingKeys.has(key)) update++; else create++;
  }
  const errors = prepared.issues.filter((i) => i.severity === "error").length;
  return {
    total: prepared.rows.length,
    create,
    update,
    skipped: prepared.rows.length - prepared.valid.length,
    errors,
    warnings: prepared.issues.filter((i) => i.severity === "warning").length,
  };
}

/** El archivo de ejemplo de cada destino, para que nadie adivine las columnas. */
export function sampleCsv(target: ImportTarget): string {
  const headers = target.fields.map((f) => f.label);
  const example = target.fields.map((field) => {
    switch (field.type) {
      case "number": return field.name.includes("price") || field.name.includes("cost") ? "1500.00" : "10";
      case "date": return "31/12/1990";
      case "email": return "cliente@ejemplo.com";
      case "phone": return "+1 809 555 0101";
      case "enum": return field.values?.[0] ?? "";
      case "list": return "vip;repetidor";
      default: return field.required ? "Obligatorio" : "";
    }
  });
  return [headers.join(","), example.join(",")].join("\n");
}
