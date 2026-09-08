import { Hono } from "hono";
import { z } from "zod";
import { ResolveRiskSchema } from "@klsm/shared";
import { audit, riskFlags } from "@klsm/db";
import type { Vars } from "../../context";
import { PageQuery, idParam, paged, parseBody, parseQuery } from "../../http";

/** Halaman Risiko: flag dari aturan R1..R7 + event review. */
export const riskRoutes = new Hono<{ Variables: Vars }>();

const ListQuery = PageQuery.extend({
  status: z.enum(["open", "dismissed", "confirmed"]).optional(),
  severity: z.enum(["low", "medium", "high"]).optional(),
  kind: z.string().max(10).optional(),
  adminId: z.coerce.number().int().optional(),
  mapId: z.coerce.number().int().optional(),
});

riskRoutes.get("/", async (c) => {
  const q = parseQuery(c, ListQuery); if (!q.ok) return q.res;
  const db = c.get("ctx").db;
  return c.json({ ...paged(q.data, await riskFlags.list(db, q.data)), counts: await riskFlags.counts(db) });
});

riskRoutes.get("/counts", async (c) => c.json({ counts: await riskFlags.counts(c.get("ctx").db) }));

for (const status of ["dismissed", "confirmed"] as const) {
  riskRoutes.post(`/:id/${status === "dismissed" ? "dismiss" : "confirm"}`, async (c) => {
    const db = c.get("ctx").db;
    const id = idParam(c); if (!id) return c.json({ error: "id" }, 400);
    const p = await parseBody(c, ResolveRiskSchema); if (!p.ok) return p.res;
    const before = await riskFlags.findById(db, id); if (!before) return c.json({ error: "tidak ditemukan" }, 404);
    const flag = await riskFlags.resolve(db, id, { status, note: p.data.note ?? null, by: c.get("userId")! });
    await audit.log(db, { actorUserId: c.get("userId")!, action: `risk.${status}`, entity: "risk_flag", entityId: id, before: { status: before.status }, after: { status, note: p.data.note } });
    return c.json({ flag });
  });
}
