import { TenantError } from "@/lib/tenant";

function originFrom(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function allowedMutationOrigins(req: Request): Set<string> {
  const allowed = new Set<string>();
  const appOrigin = originFrom(process.env.NEXT_PUBLIC_APP_URL || null);
  if (appOrigin) allowed.add(appOrigin);

  const requestUrlOrigin = originFrom(req.url);
  if (requestUrlOrigin) allowed.add(requestUrlOrigin);

  const host = req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || (process.env.NODE_ENV === "production" ? "https" : "http");
  if (host) allowed.add(`${proto}://${host}`);
  return allowed;
}

/**
 * CSRF defense for cookie-authenticated mutations. Webhook routes must not use
 * this helper; they authenticate with provider signatures instead.
 */
export function assertSameOriginMutation(req: Request): void {
  if (process.env.NODE_ENV !== "production") return;

  const origin = originFrom(req.headers.get("origin"));
  const referer = originFrom(req.headers.get("referer"));
  const actual = origin || referer;
  if (!actual || !allowedMutationOrigins(req).has(actual)) {
    throw new TenantError("Origen de la solicitud no permitido", 403);
  }
}
