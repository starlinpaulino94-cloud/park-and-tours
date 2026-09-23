import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, TenantError, esDeSocio } from "@/lib/tenant";
import { fail } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { loadCashClose } from "@/lib/cash-service";
import { buildCashClosePdf } from "@/lib/pdf/documents";
import { pdfResponse } from "@/lib/pdf/doc";

const nameOf = (value: unknown): string | null => {
  if (!value || typeof value !== "object") return null;
  const person = value as { name?: string; full_name?: string; email?: string };
  return person.name || person.full_name || person.email || null;
};

const textOf = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

/**
 * GET /api/cash/sessions/:id/arqueo/pdf — el acta del arqueo.
 *
 * Se imprime, se firma y viaja con el efectivo hasta la bóveda. Sale de la
 * misma carga que la pantalla, así que el papel archivado y lo que quedó en el
 * sistema no pueden contar historias distintas.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "cash:arqueo:pdf", ctx.userId), limit: 60, windowMs: 60_000 });
    if (esDeSocio(ctx)) throw new TenantError("El arqueo de caja es de uso interno", 403);
    requireAtLeast(ctx, "cashier");

    const arqueo = await loadCashClose(ctx.companyId, id);
    const session = arqueo.session as Record<string, unknown>;

    const bytes = await buildCashClosePdf(
      ctx.company,
      {
        code: textOf(session.code),
        register: nameOf(session.cash_register) || textOf(arqueo.register?.name) || "Caja",
        branch: nameOf(session.branch),
        cashier: nameOf(session.user),
        opened_at: textOf(session.opened_at),
        closed_at: textOf(session.closed_at),
        status: textOf(session.status),
        approved_by: nameOf(session.approved_by),
        approved_at: textOf(session.approved_at),
        difference_reason: textOf(session.difference_reason),
        deposit_reference: textOf(session.deposit_reference),
        notes: textOf(session.notes),
        card: arqueo.card,
      },
      arqueo.currencies.map((row) => ({ ...row, breakdown: row.breakdown ?? [] }))
    );

    return pdfResponse(bytes, `arqueo-${textOf(session.code) || id}.pdf`);
  } catch (err) {
    return fail(err);
  }
}
