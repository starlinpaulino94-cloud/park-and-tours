import "server-only";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, type RGB } from "pdf-lib";
import {
  sanitizeForPdf, wrapText, truncate, columnPositions, cellX, type ColumnSpec,
} from "@/lib/pdf/layout";

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
const ACCENT = rgb(0.05, 0.42, 0.42);

export interface DocMeta {
  /** Nombre del documento, arriba a la derecha: VOUCHER, COTIZACIÓN… */
  kind: string;
  /** Su número: el que el cliente cita por teléfono. */
  reference?: string | null;
  company?: { name?: string | null; email?: string | null; phone?: string | null; whatsapp?: string | null; address?: string | null } | null;
  /** Pie legal o de contacto. */
  footer?: string | null;
}

export class PdfBuilder {
  private doc!: PDFDocument;
  private page!: PDFPage;
  private regular!: PDFFont;
  private bold!: PDFFont;
  private y = 0;
  private pageNumber = 0;

  private constructor(private readonly meta: DocMeta) {}

  static async create(meta: DocMeta): Promise<PdfBuilder> {
    const builder = new PdfBuilder(meta);
    builder.doc = await PDFDocument.create();
    builder.regular = await builder.doc.embedFont(StandardFonts.Helvetica);
    builder.bold = await builder.doc.embedFont(StandardFonts.HelveticaBold);
    builder.doc.setTitle(`${meta.kind}${meta.reference ? ` ${meta.reference}` : ""}`);
    builder.doc.setProducer("Park & Tours");
    builder.doc.setCreationDate(new Date());
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

  /** La cabecera que se repite en cada hoja: quién manda el papel y cuál es. */
  private drawPageHeader(): void {
    const company = this.meta.company;
    this.text(company?.name || "", MARGIN, 13, this.bold, INK);
    const kind = `${this.meta.kind}${this.meta.reference ? ` · ${this.meta.reference}` : ""}`;
    const kindWidth = this.width(kind, this.bold, 10);
    this.text(kind, A4.width - MARGIN - kindWidth, 10, this.bold, ACCENT);
    this.y -= 13;

    const contact = [company?.phone || company?.whatsapp, company?.email, company?.address]
      .filter(Boolean).join("  ·  ");
    if (contact) {
      this.text(contact, MARGIN, 8, this.regular, MUTED);
      this.y -= 10;
    }
    this.y -= 6;
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
      borderColor: ACCENT, borderWidth: 0.8, color: rgb(0.96, 0.98, 0.98),
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
    pages.forEach((page, index) => {
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
