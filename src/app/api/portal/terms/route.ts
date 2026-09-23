import { NextRequest } from "next/server";
import { requireTenant, requireTenantWrite, TenantError, esDeSocio } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { supabaseService } from "@/lib/supabase/service";
import { writeAudit } from "@/lib/audit";
import { estadoDeCondiciones } from "@/lib/partner-lifecycle";
import { assertSameOriginMutation } from "@/lib/csrf";

/**
 * LAS CONDICIONES COMERCIALES: CONSULTAR Y ACEPTAR.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO ES UN CAMPO MÁS DE LA FICHA DEL SOCIO
 *
 * Porque lo que acredita una aceptación es QUIÉN la hizo y CUÁNDO, y las dos
 * cosas tienen que venir de la sesión, no del cuerpo de la petición. Metida en
 * la lista blanca de escritura del CRUD del socio, la aceptación la podría
 * fechar el propio personal de la operadora desde la pantalla de partners —y
 * entonces no acreditaría nada más que que alguien rellenó una casilla—.
 *
 * Por eso `terms_accepted_*` está fuera de `PARTNER_RELATIONSHIP_COLUMNS` y
 * este es el único camino que las escribe.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ACEPTA EL SOCIO, NO LA OPERADORA
 *
 * El personal interno puede MIRAR el portal de un socio —es como audita lo que
 * el socio ve—, y justo por eso no puede aceptar desde ahí: firmaría en nombre
 * de otra empresa. La comprobación es por identificador propio, no por rol.
 */

/** La relación comercial de este socio con esta operadora. */
async function relacion(orgId: string, partnerId: string) {
  const { data, error } = await supabaseService()
    .from("organization_relationships")
    .select("id, terms_version, terms_accepted_version, terms_accepted_at, terms_accepted_by")
    .eq("from_org_id", orgId)
    .eq("to_org_id", partnerId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new TenantError("No se pudieron leer las condiciones comerciales", 500);
  return data;
}

export async function GET() {
  try {
    const ctx = await requireTenant();
    if (!ctx.partnerId) throw new TenantError("Tu usuario no está asociado a ningún partner", 403);

    const rel = await relacion(ctx.companyId, ctx.partnerId);
    return ok({
      status: estadoDeCondiciones(rel),
      version: rel?.terms_version ?? 0,
      accepted_version: rel?.terms_accepted_version ?? null,
      accepted_at: rel?.terms_accepted_at ?? null,
    });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    // Escribe en los datos de la operadora, así que pasa por la misma puerta
    // que cualquier otra escritura: si su suscripción no permite escribir, no
    // se abre una excepción para esto.
    const ctx = await requireTenantWrite();
    if (!esDeSocio(ctx) || !ctx.partnerId) {
      throw new TenantError("Solo la empresa asociada puede aceptar sus condiciones", 403);
    }

    const rel = await relacion(ctx.companyId, ctx.partnerId);
    if (!rel) throw new TenantError("Tu empresa no tiene condiciones comerciales registradas", 404);
    // Aceptar «las condiciones» cuando no hay ninguna escrita dejaría una firma
    // sobre un texto vacío, que es peor que no tener firma: parece un acuerdo.
    if (!rel.terms_version) {
      throw new TenantError("El operador todavía no ha publicado condiciones que aceptar", 409);
    }

    /**
     * Se sella la versión LEÍDA del servidor, no una que mande el cliente.
     *
     * Si el número viniera en el cuerpo, un socio podría aceptar la versión 7
     * el día que rige la 9 —o al revés, firmar por adelantado una que todavía
     * no ha leído nadie—. La aceptación es siempre de lo que rige ahora.
     */
    const { error } = await supabaseService()
      .from("organization_relationships")
      .update({
        terms_accepted_version: rel.terms_version,
        terms_accepted_at: new Date().toISOString(),
        terms_accepted_by: ctx.userId,
      })
      .eq("id", rel.id);
    if (error) throw new TenantError("No se pudo registrar la aceptación", 500);

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "partner_terms_accepted",
      entityType: "organizations", entityId: ctx.partnerId,
      description: `${ctx.email} aceptó la versión ${rel.terms_version} de las condiciones comerciales`,
      metadata: { partner: ctx.partnerId, version: rel.terms_version },
    });

    return ok({ status: "aceptadas", version: rel.terms_version });
  } catch (err) {
    return fail(err);
  }
}
