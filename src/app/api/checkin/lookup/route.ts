import { NextRequest } from "next/server";
import { requireTenant, tenantQuery } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";

/** GET /api/checkin/lookup?code=… — finds a booking by voucher code, number or customer. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    const code = req.nextUrl.searchParams.get("code")?.trim();
    if (!code) throw Object.assign(new Error("Indica un código o nombre a buscar"), { status: 400 });

    const rows = await tenantQuery(ctx.companyId, "booking", {
      _filter: {
        _or: [
          { voucher_code: { regex: code, options: "i" } },
          { booking_number: { regex: code, options: "i" } },
          { room_number: { regex: code, options: "i" } },
        ],
      },
      _limit: 20,
      _sort: { travel_date: "desc" },
      customer: true, product: true, departure: true, pickup_hotel: true,
      participant: { _limit: 50 },
      voucher: { _limit: 5 },
    });

    console.log(`[checkin] búsqueda "${code}" → ${rows.length} resultados`);
    return ok(rows);
  } catch (err) {
    return fail(err);
  }
}
