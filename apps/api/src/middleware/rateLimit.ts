import type { MiddlewareHandler } from "hono";

/** Rate limit sederhana in-memory per IP per menit. Cukup untuk halaman publik. */
export function rateLimit(perMinute: number): MiddlewareHandler {
  const hits = new Map<string, { n: number; reset: number }>();
  return async (c, next) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "local";
    const now = Date.now();
    const cur = hits.get(ip);
    if (!cur || cur.reset < now) hits.set(ip, { n: 1, reset: now + 60_000 });
    else if (++cur.n > perMinute) return c.json({ error: "rate limited" }, 429);
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    await next();
  };
}
