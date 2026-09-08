import type { Context } from "hono";
import { z, type ZodType } from "zod";

export async function parseBody<T>(c: Context, schema: ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; res: Response }> {
  let json: unknown;
  try { json = await c.req.json(); } catch { return { ok: false, res: c.json({ error: "body harus JSON" }, 400) }; }
  const r = schema.safeParse(json);
  if (!r.success) return { ok: false, res: c.json({ error: "validasi gagal", issues: r.error.issues }, 400) };
  return { ok: true, data: r.data };
}

export function parseQuery<T>(c: Context, schema: ZodType<T>): { ok: true; data: T } | { ok: false; res: Response } {
  // ?status=&source= (param kosong) dianggap tidak ada, supaya filter kosong dari UI/Postman tidak 400
  const q = Object.fromEntries(Object.entries(c.req.query()).filter(([, v]) => v !== ""));
  const r = schema.safeParse(q);
  if (!r.success) return { ok: false, res: c.json({ error: "query tidak valid", issues: r.error.issues }, 400) };
  return { ok: true, data: r.data };
}

/** Query pagination standar: ?limit=&offset=. Response list memakai bentuk { rows, total, limit, offset }. */
export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type Page = z.infer<typeof PageQuery>;

export function paged<T>(page: { limit: number; offset: number }, r: { rows: T[]; total: number }) {
  return { rows: r.rows, total: r.total, limit: page.limit, offset: page.offset };
}

export function idParam(c: Context, name = "id"): number | null {
  const n = Number(c.req.param(name));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Range default: 30 hari terakhir. */
export function defaultRange(from?: string, to?: string) {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 30 * 86_400_000);
  return { from: start.toISOString(), to: end.toISOString() };
}
