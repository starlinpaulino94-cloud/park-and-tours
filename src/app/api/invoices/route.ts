import { NextRequest } from "next/server";
import { requireTenant, requireTenantWrite, requireAtLeast, tenantQuery, tenantCount } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertModule } from "@/lib/plan-service";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { issueInvoice } from "@/lib/invoice-service";
import { sequenceHealth } from "@/lib/invoicing";
import type { NcfType } from "@/lib/invoicing";

const NCF_TYPES = new Set(["b01", "b02", "b04", "b14", "b15", "e31", "e32", "e34", "e44", "e45"]);

/**
 * POST /api/invoices — emite la factura de una orden.
 *
 * La pantalla anterior era un formulario donde el NCF, el subtotal, el impuesto
 * y el total se escribían a mano. Un comprobante fiscal tecleado rompe de tres
 * formas que la DGII ve: NCF repetidos entre dos cajas simultáneas, huecos en la
 * secuencia que hay que justificar meses después, y totales que no cuadran con
 * la venta. Aquí los calcula el sistema desde la orden, y el número lo entrega
 * la base de forma atómica.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    assertModule(ctx, "accounting");
    assertRateLimit({ key: rateLimitKey(req, "invoices:issue", ctx.userId), limit: 60, windowMs: 60_000 });
    // Emitir un comprobante fiscal compromete a la empresa ante la DGII: no es
    // una acción de mostrador.
    requireAtLeast(ctx, "cashier");

    const body = await readJson<{
      order_id?: string; ncf_type?: string; tax_profile_id?: string;
      customer_name?: string; customer_tax_id?: string; customer_address?: string;
      due_date?: string; notes?: string;
    }>(req);

    if (!body.order_id) {
      throw Object.assign(new Error("Indica la orden que se va a facturar"), { status: 400 });
    }
    if (body.ncf_type && !NCF_TYPES.has(body.ncf_type)) {
      throw Object.assign(new Error("Ese tipo de comprobante no existe"), { status: 400 });
    }

    const result = await issueInvoice(ctx, {
      orderId: body.order_id,
      ncfType: (body.ncf_type as NcfType) || null,
      taxProfileId: body.tax_profile_id || null,
      customerName: body.customer_name,
      customerTaxId: body.customer_tax_id,
      customerAddress: body.customer_address,
      dueDate: body.due_date,
      notes: body.notes,
    });

    return ok(result);
  } catch (err) {
    return fail(err);
  }
}

/**
 * GET /api/invoices — el listado, más la salud de las secuencias.
 *
 * La salud viaja con el listado porque quedarse sin NCF es dejar de facturar, y
 * pedirle un rango nuevo a la DGII no es inmediato: el aviso tiene que estar
 * donde se mira todos los días, no escondido en configuración.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, "invoices:list", ctx.userId), limit: 120, windowMs: 60_000 });
    requireAtLeast(ctx, "cashier");

    const sp = req.nextUrl.searchParams;
    const filter: Record<string, unknown> = {};
    if (sp.get("status")) filter.status = sp.get("status");
    if (sp.get("invoice_type")) filter.invoice_type = sp.get("invoice_type");
    if (sp.get("q")) filter.ncf = { like: sp.get("q") };

    const [rows, total, sequences] = await Promise.all([
      tenantQuery(ctx.companyId, "invoice", {
        _filter: filter,
        _sort: { createdAt: "desc" },
        _limit: Math.min(Number(sp.get("limit") || 50), 200),
        _offset: Number(sp.get("offset") || 0),
        customer: true, order: true,
      }),
      tenantCount(ctx.companyId, "invoice", filter),
      tenantQuery<Record<string, unknown>>(ctx.companyId, "ncf_sequence", { _limit: 20 }),
    ]);

    return ok(rows, {
      total,
      sequences: sequences.map((s) => ({
        _id: s._id,
        ncf_type: s.ncf_type,
        next_number: s.next_number,
        max_number: s.max_number,
        expires_at: s.expires_at,
        status: s.status,
        health: sequenceHealth(s as never),
      })),
    });
  } catch (err) {
    return fail(err);
  }
}
