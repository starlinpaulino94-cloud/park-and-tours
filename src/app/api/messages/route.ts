import { NextRequest } from "next/server";
import { requireTenant, requireTenantWrite, requireAtLeast, tenantQuery, tenantCount } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { enqueueMessage, dispatchQueue } from "@/lib/messaging/outbox";
import { configuredChannels } from "@/lib/messaging/providers";
import { TEMPLATE_VARIABLES, TEMPLATE_TRIGGER, DEFAULT_TEMPLATES } from "@/lib/messaging/templates";
import type { MessageChannel, TemplateKey } from "@/lib/messaging/render";

const CHANNELS = new Set(["email", "whatsapp", "sms"]);

/**
 * POST /api/messages — compone y encola un mensaje a mano.
 *
 * Los avisos automáticos salen de `src/lib/messaging/events.ts`; esto es para lo
 * que no tiene automatismo: reenviarle a un cliente su confirmación porque la
 * borró, avisar de un saldo pendiente antes de la excursión, o probar una
 * plantilla recién escrita contra el propio correo.
 *
 * Se encola igual que lo automático —mismo registro, mismo reintento, misma
 * bandeja— porque un mensaje mandado por fuera del sistema es exactamente el
 * problema que este módulo viene a resolver.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "messages:send", ctx.userId), limit: 60, windowMs: 60_000 });
    requireAtLeast(ctx, "seller");

    const body = await readJson<{
      key?: string; channel?: string; language?: string;
      to?: { email?: string; phone?: string; whatsapp?: string };
      to_name?: string;
      vars?: Record<string, string | number>;
      refs?: Record<string, string>;
      deliver_now?: boolean;
    }>(req);

    if (!body.key || !TEMPLATE_VARIABLES[body.key as TemplateKey]) {
      throw Object.assign(new Error("Plantilla desconocida"), { status: 400 });
    }
    if (!CHANNELS.has(String(body.channel))) {
      throw Object.assign(new Error("El canal solo puede ser correo, WhatsApp o SMS"), { status: 400 });
    }

    const result = await enqueueMessage(ctx.company, ctx.companyId, {
      key: body.key as TemplateKey,
      channel: body.channel as MessageChannel,
      language: body.language || "es",
      contact: body.to || {},
      toName: body.to_name,
      vars: body.vars || {},
      refs: body.refs,
      userId: ctx.userId,
      // Un envío a mano NO lleva clave de dedupe: reenviar una confirmación a
      // petición del cliente es legítimo y no puede quedar bloqueado por el
      // aviso automático que ya salió.
      dedupeKey: null,
    });

    if (result.status === "skipped") {
      throw Object.assign(new Error(result.reason), { status: 409 });
    }

    // El envío inmediato es para el que está delante del cliente: no puede
    // esperar quince minutos a que pase el cron.
    let delivered = null;
    if (body.deliver_now && result.status === "queued") {
      delivered = await dispatchQueue(ctx.company, ctx.companyId, 5);
    }

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "message_enqueued",
      entityType: "message", entityId: "id" in result ? result.id ?? undefined : undefined,
      description: `Mensaje ${body.key} por ${body.channel}` +
        (result.status === "undeliverable" ? ` — no entregable: ${result.reason}` : ""),
      severity: result.status === "undeliverable" ? "warning" : "info",
    });

    return ok({ ...result, delivered });
  } catch (err) {
    return fail(err);
  }
}

/**
 * GET /api/messages — la bandeja, más lo que la pantalla necesita saber:
 * qué canales pueden salir y qué plantillas existen.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "messages:list", ctx.userId), limit: 120, windowMs: 60_000 });
    requireAtLeast(ctx, "seller");

    const sp = req.nextUrl.searchParams;
    const filter: Record<string, unknown> = {};
    if (sp.get("status")) filter.status = sp.get("status");
    if (sp.get("channel")) filter.channel = sp.get("channel");
    if (sp.get("template_key")) filter.template_key = sp.get("template_key");
    if (sp.get("booking")) filter.booking = sp.get("booking");

    const [rows, total] = await Promise.all([
      tenantQuery(ctx.companyId, "message", {
        _filter: filter,
        _sort: { createdAt: "desc" },
        _limit: Math.min(Number(sp.get("limit") || 50), 200),
        _offset: Number(sp.get("offset") || 0),
        customer: true, booking: true, quote: true,
      }),
      tenantCount(ctx.companyId, "message", filter),
    ]);

    return ok(rows, {
      total,
      channels: configuredChannels(),
      templates: Object.keys(TEMPLATE_VARIABLES).map((key) => ({
        key,
        trigger: TEMPLATE_TRIGGER[key as TemplateKey],
        variables: TEMPLATE_VARIABLES[key as TemplateKey],
        channels: DEFAULT_TEMPLATES.filter((t) => t.key === key).map((t) => t.channel),
      })),
    });
  } catch (err) {
    return fail(err);
  }
}
