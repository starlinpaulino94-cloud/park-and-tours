import { NextRequest } from "next/server";
import { requireTenant, TenantError } from "@/lib/tenant";
import { fail } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { loadManifest, personName } from "@/lib/manifest-service";
import { buildManifestPdf } from "@/lib/pdf/documents";
import { pdfResponse } from "@/lib/pdf/doc";
import { formatDate } from "@/lib/format";

/**
 * GET /api/departures/:id/manifest/pdf — el manifiesto para imprimir.
 *
 * La pantalla ya se imprime desde el navegador, pero eso exige abrirla con
 * sesión: el guía que sale a las 6 de la mañana necesita un archivo que se
 * mande por WhatsApp la noche antes y se lea sin conexión.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, "departures:manifest:pdf", ctx.userId), limit: 60, windowMs: 60_000 });
    if (ctx.role === "partner") throw new TenantError("El manifiesto es de uso interno", 403);

    const m = await loadManifest(ctx.companyId, id);
    const dep = m.departure;
    const productName = (m.product?.name as string) || "Salida";

    const bytes = await buildManifestPdf(
      ctx.company,
      {
        product_name: productName,
        departure_at: (dep.departure_at as string) ?? null,
        meeting_point: (dep.meeting_point as string) || (m.product?.meeting_point as string) || null,
        capacity: Number(dep.capacity) || 0,
        vehicles: m.vehicles.map((v) => ({
          plate: (v.plate as string) ?? null, name: (v.name as string) ?? null, capacity: Number(v.capacity) || 0,
        })),
        staff: m.staff.map((s) => ({
          name: personName(s), role: (s.resource_role as string) ?? null, phone: (s.phone as string) ?? null,
        })),
        notes: (dep.notes as string) ?? null,
      },
      m.rows, m.stops, m.summary
    );

    const day = dep.departure_at ? formatDate(dep.departure_at as string) : "sin-fecha";
    return pdfResponse(bytes, `manifiesto-${productName}-${day}.pdf`);
  } catch (err) {
    return fail(err);
  }
}
