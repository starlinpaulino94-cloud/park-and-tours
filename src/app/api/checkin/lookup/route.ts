import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, tenantQuery } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";

/** Escapes regex metacharacters so user input is matched literally (no ReDoS / injection). */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** GET /api/checkin/lookup?code=… — finds a booking by voucher code, number or customer. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    // AUD-B06: check-in is an operations action. Without a role gate any tenant
    // user — including an external B2B `partner` — could enumerate every
    // booking's voucher (the only credential a ticket has) across all partners.
    requireAtLeast(ctx, "operations");

    const code = req.nextUrl.searchParams.get("code")?.trim();
    if (!code) throw Object.assign(new Error("Indica un código o nombre a buscar"), { status: 400 });
    // AUD-B06: escape the input before it is used as a regex, otherwise a
    // crafted pattern (e.g. "(a+)+b") causes catastrophic backtracking / ReDoS,
    // and "." would match — and dump — every booking in the tenant.
    const safe = escapeRegex(code);

    const rows = await tenantQuery(ctx.companyId, "booking", {
      _filter: {
        _or: [
          { voucher_code: { regex: safe, options: "i" } },
          { booking_number: { regex: safe, options: "i" } },
          { room_number: { regex: safe, options: "i" } },
        ],
      },
      _limit: 20,
      _sort: { travel_date: "desc" },
      customer: true, product: true, departure: true, pickup_hotel: true,
      participant: { _limit: 50 },
      voucher: { _limit: 5 },
    });

    console.log(`[checkin] búsqueda → ${rows.length} resultados`);
    return ok(rows);
  } catch (err) {
    return fail(err);
  }
}
