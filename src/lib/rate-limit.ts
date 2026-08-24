import "server-only";

type Bucket = {
  count: number;
  resetAt: number;
};

type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
};

const buckets = new Map<string, Bucket>();

function clientIp(req: Request): string {
  const headers = req.headers;
  return (
    headers.get("cf-connecting-ip") ||
    headers.get("x-real-ip") ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export function rateLimitKey(req: Request, scope: string, subject?: string | null): string {
  return `${scope}:${subject || clientIp(req)}`;
}

export function assertRateLimit({ key, limit, windowMs }: RateLimitOptions): void {
  const now = Date.now();
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  current.count += 1;
  if (current.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    throw Object.assign(new Error("Demasiadas solicitudes. Intenta de nuevo en unos segundos."), {
      status: 429,
      retryAfter,
    });
  }

  // Opportunistic cleanup to keep the map bounded in long-lived Node processes.
  if (buckets.size > 10_000) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    }
  }
}
