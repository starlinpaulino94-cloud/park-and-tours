import "server-only";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, type RGB } from "pdf-lib";
import {
  sanitizeForPdf, wrapText, truncate, columnPositions, cellX, type ColumnSpec,
} from "@/lib/pdf/layout";
import { toRgb, DEFAULT_BRAND_COLOR, type DocumentBrand } from "@/lib/branding";
import type { FetchedLogo } from "@/lib/pdf/logo";

/**
 * El constructor de documentos imprimibles.
 *
 * Un voucher, una cotización y un manifiesto son tres documentos distintos con
 * la misma anatomía: cabecera con la empresa, bloques de dato y valor, tablas y
 * un pie. Se dibujan aquí para que los tres salgan con la misma tipografía y los
 * mismos márgenes —el cliente recibe papeles de la misma empresa— y para que el
 * salto de página se resuelva UNA vez: una cotización de un grupo de 40 personas
 * no cabe en una hoja, y una lista de pasajeros cortada a mitad de página es
 * inservible en la puerta del autobús.
 *
 * Se usan las fuentes estándar del formato (Helvetica) en vez de incrustar una:
 * evita 300 KB por documento y un binario en el repositorio. El precio es que
 * solo escriben Latin-1, y de eso se ocupa `sanitizeForPdf`.
 */

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 48;

/** Una paleta sobria: el documento se imprime en blanco y negro la mitad de las veces. */
const INK = rgb(0.07, 0.11, 0.13);
const MUTED = rgb(0.42, 0.47, 0.49);
const LINE = rgb(0.82, 0.85, 0.86);

/**
 * El acento ya NO es una constante (0055).
 *
 * Era `rgb(0.05, 0.42, 0.42)` quemado, así que todas las empresas entregaban
 * documentos del mismo verde. Ahora sale del color de marca, que `branding.ts`
 * valida antes de que llegue aquí: un color inválido se convierte en NaN, y un
 * PDF con un color NaN no se abre.
 */
const accentOf = (brand?: DocumentBrand | null) => {
  const { r, g, b } = toRgb(brand?.color || DEFAULT_BRAND_COLOR);
  return rgb(r, g, b);
};

/** Alto del logo en la cabecera. Ancho proporcional, con tope. */
const LOGO_HEIGHT = 30;
const LOGO_MAX_WIDTH = 140;

export interface DocMeta {
  /** Nombre del documento, arriba a la derecha: VOUCHER, COTIZACIÓN… */
  kind: string;
  /** Su número: el que el cliente cita por teléfono. */
  reference?: string | null;
  company?: { name?: string | null; email?: string | null; phone?: string | null; whatsapp?: string | null; address?: string | null } | null;
  /** Pie legal o de contacto. */
  footer?: string | null;
  /**
   * La marca resuelta de la empresa (0055): color, logo y textos legales.
   *
   * Cuando viene, manda sobre `company`: trae el nombre, el contacto y el RNC ya
   * armados por `documentBrand`, y el color con el que se pinta el documento.
   */
  brand?: DocumentBrand | null;
  /** El logo ya descargado. Lo trae quien llama, porque bajarlo puede fallar. */
  logo?: FetchedLogo | null;
}

export class PdfBuilder {
  private doc!: PDFDocument;
  private page!: PDFPage;
  private regular!: PDFFont;
  private bold!: PDFFont;
  private y = 0;
  private pageNumber = 0;
  private accent = accentOf(null);
  private logoImage: import("pdf-lib").PDFImage | null = null;

  private constructor(private readonly meta: DocMeta) {}

  static async create(meta: DocMeta): Promise<PdfBuilder> {
    const builder = new PdfBuilder(meta);
    builder.doc = await PDFDocument.create();
    builder.regular = await builder.doc.embedFont(StandardFonts.Helvetica);
    builder.bold = await builder.doc.embedFont(StandardFonts.HelveticaBold);
    builder.doc.setTitle(`${meta.kind}${meta.reference ? ` ${meta.reference}` : ""}`);
    builder.doc.setProducer("Park & Tours");
    builder.doc.setCreationDate(new Date());
    builder.accent = accentOf(meta.brand);

    // El logo se incrusta UNA vez y se reutiliza en cada hoja: un manifiesto de
    // tres páginas con el logo embebido tres veces pesa el triple sin mejorar
    // nada. Si falla, el documento sale con el nombre en texto — que es como
    // salía antes de todo esto.
    if (meta.logo) {
      try {
        builder.logoImage = meta.logo.kind === "png"
          ? await builder.doc.embedPng(meta.logo.bytes)
          : await builder.doc.embedJpg(meta.logo.bytes);
      } catch (err) {
        console.warn("[pdf] el logo no se pudo incrustar:", (err as Error).message);
      }
    }

    builder.newPage();
    return builder;
  }

  get contentWidth(): number {
    return A4.width - MARGIN * 2;
  }

  get left(): number {
    return MARGIN;
  }

  private newPage(): void {
    this.page = this.doc.addPage([A4.width, A4.height]);
    this.pageNumber += 1;
    this.y = A4.height - MARGIN;
    this.drawPageHeader();
  }

  /**
   * Reserva vertical. Si no queda, abre página.
   *
   * Todo lo que dibuja pasa por aquí: es la única forma de que un bloque no se
   * parta por la mitad sin tener que pensarlo en cada documento.
   */
  private reserve(height: number): void {
    if (this.y - height < MARGIN + 28) this.newPage();
  }

  private width(text: string, font: PDFFont, size: number): number {
    return font.widthOfTextAtSize(sanitizeForPdf(text), size);
  }

  private text(value: string, x: number, size: number, font: PDFFont, color: RGB): void {
    this.page.drawText(sanitizeForPdf(value), { x, y: this.y, size, font, color });
  }

  /**
   * La cabecera que se repite en cada hoja: quién manda el papel y cuál es.
   *
   * Con logo, el bloque de la empresa se desplaza a su derecha y la cabecera
   * crece hasta el alto del logo. Sin logo queda exactamente como estaba: una
   * empresa que no ha subido el suyo no debe notar ningún cambio.
   */
  private drawPageHeader(): void {
    const brand = this.meta.brand;
    const company = this.meta.company;
    const top = this.y;

    let textLeft = MARGIN;
    if (this.logoImage) {
      const scale = Math.min(
        LOGO_HEIGHT / this.logoImage.height,
        LOGO_MAX_WIDTH / this.logoImage.width
      );
      const w = this.logoImage.width * scale;
      const h = this.logoImage.height * scale;
      this.page.drawImage(this.logoImage, { x: MARGIN, y: top - h + 2, width: w, height: h });
      textLeft = MARGIN + w + 12;
    }

    const name = brand?.name ?? company?.name ?? "";
    this.page.drawText(sanitizeForPdf(name), { x: textLeft, y: top, size: 13, font: this.bold, color: INK });

    const kind = `${this.meta.kind}${this.meta.reference ? ` · ${this.meta.reference}` : ""}`;
    const kindWidth = this.width(kind, this.bold, 10);
    this.page.drawText(sanitizeForPdf(kind), {
      x: A4.width - MARGIN - kindWidth, y: top, size: 10, font: this.bold, color: this.accent,
    });

    let line = top - 11;
    // La razón social solo cuando aporta: repetir el mismo nombre dos veces es
    // ruido en un documento que ya va apretado.
    if (brand?.legalName) {
      this.page.drawText(sanitizeForPdf(brand.legalName), { x: textLeft, y: line, size: 8, font: this.regular, color: MUTED });
      line -= 9;
    }

    const contact = brand
      ? brand.contact
      : [company?.phone || company?.whatsapp, company?.email, company?.address].filter(Boolean).join("  ·  ");
    if (contact) {
      this.page.drawText(sanitizeForPdf(contact), { x: textLeft, y: line, size: 8, font: this.regular, color: MUTED });
      line -= 9;
    }
    if (brand?.taxLine) {
      this.page.drawText(sanitizeForPdf(brand.taxLine), { x: textLeft, y: line, size: 8, font: this.regular, color: MUTED });
      line -= 9;
    }

    // La cabecera acaba donde acabe lo más alto: el logo o el bloque de texto.
    // Tomar solo uno de los dos hacía que el título del documento se comiera la
    // primera línea cuando el otro era más largo.
    this.y = Math.min(line, top - (this.logoImage ? LOGO_HEIGHT : 0)) - 4;
    this.rule();
    this.y -= 14;
  }

  rule(): void {
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: A4.width - MARGIN, y: this.y },
      thickness: 0.7,
      color: LINE,
    });
  }

  gap(height = 10): void {
    this.y -= height;
  }

  heading(text: string, size = 16): void {
    this.reserve(size + 12);
    this.text(text, MARGIN, size, this.bold, INK);
    this.y -= size + 6;
  }

  /** Rótulo pequeño en versales: separa secciones sin gastar una línea grande. */
  eyebrow(text: string): void {
    this.reserve(18);
    this.text(text.toUpperCase(), MARGIN, 7.5, this.bold, MUTED);
    this.y -= 12;
  }

  paragraph(text: string, size = 9.5, color: RGB = INK): void {
    const lines = wrapText(text, this.contentWidth, (t) => this.width(t, this.regular, size));
    for (const line of lines) {
      this.reserve(size + 4);
      this.text(line, MARGIN, size, this.regular, color);
      this.y -= size + 3.5;
    }
  }

  /**
   * Fila de dato y valor.
   *
   * El valor se alinea a la derecha y el rótulo a la izquierda porque así se
   * leen en columna aunque los textos midan cosas distintas: es el formato de un
   * recibo, no el de una frase.
   */
  row(label: string, value: string, opts: { strong?: boolean } = {}): void {
    const size = opts.strong ? 11 : 9.5;
    this.reserve(size + 8);
    this.text(label, MARGIN, 9, this.regular, MUTED);
    const font = opts.strong ? this.bold : this.regular;
    const valueWidth = this.width(value, font, size);
    this.text(value, A4.width - MARGIN - valueWidth, size, font, INK);
    this.y -= size + 6;
  }

  /** Bloque con título y texto libre; se salta si no hay contenido. */
  block(title: string, body?: string | null): void {
    if (!body || !String(body).trim()) return;
    this.eyebrow(title);
    this.paragraph(String(body));
    this.gap(6);
  }

  /**
   * Tabla con cabecera que se repite al saltar de página.
   *
   * Sin repetirla, la segunda hoja de un manifiesto son columnas de números sin
   * nombre, y alguien acaba contando pasajeros con el dedo.
   */
  table(
    columns: (ColumnSpec & { header: string })[],
    rows: string[][],
    opts: { size?: number } = {}
  ): void {
    const size = opts.size ?? 8.5;
    const positions = columnPositions(columns, MARGIN, this.contentWidth);

    const drawHeader = () => {
      this.reserve(size + 14);
      columns.forEach((column, i) => {
        const position = positions[i];
        const text = sanitizeForPdf(column.header.toUpperCase());
        const width = this.width(text, this.bold, 7.5);
        this.page.drawText(text, {
          x: cellX(position, width), y: this.y, size: 7.5, font: this.bold, color: MUTED,
        });
      });
      this.y -= size + 4;
      this.rule();
      this.y -= 8;
    };

    drawHeader();
    let page = this.pageNumber;

    for (const row of rows) {
      this.reserve(size + 7);
      // Saltó de página: la cabecera vuelve arriba.
      if (this.pageNumber !== page) { drawHeader(); page = this.pageNumber; }
      row.forEach((cell, i) => {
        const position = positions[i];
        const text = truncate(cell ?? "", position.width - 8, (t) => this.width(t, this.regular, size));
        const width = this.width(text, this.regular, size);
        this.page.drawText(text, {
          x: cellX(position, width), y: this.y, size, font: this.regular, color: INK,
        });
      });
      this.y -= size + 6;
    }
  }

  /** Recuadro de aviso: lo que el cliente NO puede pasar por alto. */
  notice(text: string): void {
    const size = 9;
    const lines = wrapText(text, this.contentWidth - 20, (t) => this.width(t, this.regular, size));
    const height = lines.length * (size + 3.5) + 16;
    this.reserve(height);
    this.page.drawRectangle({
      x: MARGIN, y: this.y - height + 12, width: this.contentWidth, height,
      borderColor: this.accent, borderWidth: 0.8, color: rgb(0.96, 0.98, 0.98),
    });
    this.y -= 4;
    for (const line of lines) {
      this.text(line, MARGIN + 10, size, this.regular, INK);
      this.y -= size + 3.5;
    }
    this.y -= 12;
  }

  /** Imagen PNG (el QR del voucher), anclada a la derecha del bloque actual. */
  async image(png: Uint8Array, size: number, opts: { alignRight?: boolean } = {}): Promise<void> {
    const embedded = await this.doc.embedPng(png);
    this.reserve(size + 8);
    const x = opts.alignRight ? A4.width - MARGIN - size : MARGIN;
    this.page.drawImage(embedded, { x, y: this.y - size + 10, width: size, height: size });
    this.y -= size;
  }

  /**
   * Cierra el documento numerando las páginas.
   *
   * Se hace al final porque hasta aquí no se sabe cuántas hay, y un manifiesto
   * sin "hoja 2 de 3" pierde una hoja sin que nadie lo note.
   */
  async finish(): Promise<Uint8Array> {
    const pages = this.doc.getPages();
    // El pie legal de la empresa —registro mercantil, leyenda de turismo— va a
    // la IZQUIERDA y la numeración a la derecha: son dos cosas distintas y
    // juntarlas en una sola línea hacía que la más larga empujara a la otra
    // fuera de la página.
    // Se recorta al ancho REAL disponible —lo que queda a la izquierda de la
    // numeración— y no a un número de caracteres: un pie con muchas mayúsculas
    // ocupa mucho más que uno del mismo largo en minúsculas, y se solaparían.
    const reserved = this.regular.widthOfTextAtSize("Página 99 de 99", 7.5) + 24;
    const legal = this.meta.brand?.footer
      ? truncate(this.meta.brand.footer, this.contentWidth - reserved, (t) =>
          this.regular.widthOfTextAtSize(sanitizeForPdf(t), 7))
      : null;

    pages.forEach((page, index) => {
      if (legal) {
        page.drawText(legal, {
          x: MARGIN, y: MARGIN - 14, size: 7, font: this.regular, color: MUTED,
        });
      }
      const label = sanitizeForPdf(
        `${this.meta.footer ? `${this.meta.footer}  ·  ` : ""}Página ${index + 1} de ${pages.length}`
      );
      const width = this.regular.widthOfTextAtSize(label, 7.5);
      page.drawText(label, {
        x: A4.width - MARGIN - width, y: MARGIN - 14, size: 7.5, font: this.regular, color: MUTED,
      });
    });
    return this.doc.save();
  }
}

/** Respuesta HTTP de un PDF, con el nombre con el que se guarda. */
export function pdfResponse(bytes: Uint8Array, filename: string, inline = true): Response {
  const safe = filename.replace(/[^\w.\-]+/g, "-").replace(/-+/g, "-");
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      // `inline` para verlo en el navegador; `attachment` para descargarlo.
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safe}"`,
      // Un documento con importes no puede quedarse cacheado entre usuarios.
      "Cache-Control": "private, no-store",
    },
  });
}
