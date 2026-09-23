import { NextRequest, NextResponse } from "next/server";
import { requireTenant, requireAtLeast, TenantError, esDeSocio } from "@/lib/tenant";
import { fail } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { toCsv } from "@/lib/export";
import { tarifarioDeSocio } from "@/lib/tarifario";

/**
 * GET /api/portal/tarifario — el tarifario neto del socio, en un archivo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO PASA POR EL EXPORTADOR GENÉRICO
 *
 * Porque no es un listado: es el resultado de correr el motor de precios una
 * vez por producto y modalidad. El exportador saca las columnas de las filas
 * que le den, y aquí las filas no existen en ninguna tabla — se calculan.
 *
 * La lista blanca de 5.5 sigue mandando en `/api/export/*`; esto es otra cosa y
 * sus columnas están escritas aquí, que es lo mismo que una lista blanca con
 * otro nombre.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y COINCIDE CON LA API PORQUE ES LA MISMA FUNCIÓN
 *
 * No porque se haya revisado: `tarifarioDeSocio` la usan los dos. Dos
 * implementaciones del mismo precio divergen el día que alguien añade una regla
 * de temporada a una de las dos, y la divergencia sale a la luz facturando.
 */
const COLUMNAS = [
  ["product_code", "Código"],
  ["product_name", "Excursión"],
  ["modality_name", "Modalidad"],
  ["currency", "Moneda"],
  ["net_price", "Precio neto"],
  ["rule", "Tarifa aplicada"],
] as const;

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    const sp = req.nextUrl.searchParams;

    let partnerId: string | null;
    if (esDeSocio(ctx)) {
      partnerId = ctx.partnerId;
    } else {
      // El personal interno puede sacar el de un socio concreto: es lo que se
      // le manda por correo cuando pide «pásame tus precios».
      requireAtLeast(ctx, "manager");
      partnerId = sp.get("partner_id") || ctx.partnerId;
    }
    if (!partnerId) throw new TenantError("Tu usuario no está asociado a ningún partner", 403);

    await assertRateLimit({
      key: rateLimitKey(req, "portal:tarifario", ctx.userId), limit: 10, windowMs: 60_000,
    });

    /**
     * La fecha va DENTRO del archivo y por defecto es hoy.
     *
     * Las reglas tienen temporada, así que «el tarifario» sin día no existe. Un
     * archivo sin fecha dentro es el que alguien reenvía en noviembre con los
     * precios de agosto y discute con él en la mano.
     */
    const fecha = (sp.get("date") || "").trim() || new Date().toISOString().slice(0, 10);
    const lineas = await tarifarioDeSocio(ctx.companyId, partnerId, `${fecha}T00:00:00.000Z`);

    const csv = toCsv(
      COLUMNAS.map(([, cabecera]) => cabecera),
      lineas.map((l) => COLUMNAS.map(([campo]) => {
        const valor = l[campo as keyof typeof l];
        return valor === null || valor === undefined ? "" : String(valor);
      }))
    );

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "data_exported", entityType: "partner", entityId: partnerId,
      description: `Tarifario neto de ${fecha}: ${lineas.length} línea(s)`,
      metadata: { partner: partnerId, fecha, lineas: lineas.length },
    });

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="tarifario-${fecha}.csv"`,
        // Un archivo con precios pactados de un socio no se guarda en ninguna
        // caché intermedia: el siguiente pediría lo mismo y recibiría los de otro.
        "Cache-Control": "no-store, private",
        "X-Row-Count": String(lineas.length),
      },
    });
  } catch (err) {
    return fail(err);
  }
}
