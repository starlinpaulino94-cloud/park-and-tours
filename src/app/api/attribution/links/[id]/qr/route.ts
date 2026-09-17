import { NextRequest } from "next/server";
import QRCode from "qrcode";
import { requireTenant, requireAtLeast, tenantFindOne } from "@/lib/tenant";
import { fail } from "@/lib/api-response";
import { linkUrl } from "@/lib/attribution";

/**
 * GET /api/attribution/links/:id/qr — el QR que se imprime y se pega.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SE GENERA EN EL SERVIDOR, Y NO ES UN CAPRICHO
 *
 * El QR se hace a partir del ORIGEN de la petición, no de una constante: el
 * mismo enlace apunta a un sitio en la vista previa y a otro en producción, y
 * un QR impreso con el dominio equivocado no se arregla — hay que despegarlo de
 * cuarenta mostradores.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 512 PX Y MARGEN 2
 *
 * Esto se imprime en un cartel A5 y se escanea desde metro y medio, con la luz
 * de un lobby. El del voucher (240 px) se lee de una pantalla a un palmo: no es
 * el mismo problema y no lleva el mismo tamaño. El margen de 2 módulos es el
 * mínimo que la mayoría de los lectores necesitan para encontrar el código
 * sobre un fondo de color.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireTenant();
    requireAtLeast(ctx, "manager");
    const { id } = await params;

    // `tenantFindOne` verifica que el enlace es de esta empresa antes de nada:
    // sin eso, un id ajeno imprimiría el QR de la competencia.
    const link = await tenantFindOne<{ slug?: string; name?: string }>(
      ctx.companyId, "seller_link", id
    );
    if (!link?.slug) throw Object.assign(new Error("El enlace no existe"), { status: 404 });

    const origin = new URL(_req.url).origin;
    const png = await QRCode.toBuffer(linkUrl(origin, link.slug), {
      type: "png",
      margin: 2,
      width: 512,
      errorCorrectionLevel: "M",
    });

    return new Response(new Uint8Array(png), {
      headers: {
        "content-type": "image/png",
        // Nombre con el slug dentro: quien descargue veinte QR tiene que poder
        // saber cuál es cuál sin abrirlos.
        "content-disposition": `attachment; filename="qr-${link.slug}.png"`,
        // Privado: lleva el enlace comercial de una empresa concreta.
        "cache-control": "private, max-age=300",
      },
    });
  } catch (err) {
    return fail(err);
  }
}
