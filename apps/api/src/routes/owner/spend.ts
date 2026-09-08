import { Hono } from "hono";
import { z } from "zod";
import { ApproveReviewSchema, MatchSpendSchema, VoidSpendSchema } from "@klsm/shared";
import { inbox, spenders, spendEvents, referralEvents, audit } from "@klsm/db";
import type { Vars } from "../../context";
import { PageQuery, idParam, paged, parseBody, parseQuery } from "../../http";
import { approveReview, matchSpendManually, voidSpend } from "../../services/spend";

export const spendRoutes = new Hono<{ Variables: Vars }>();

const ListQuery = z.object({
  status: z.enum(["attributed", "unattributed", "unmatched", "void", "review"]).optional(),
  source: z.enum(["robux", "bagibagi"]).optional(),
  adminId: z.coerce.number().int().optional(),
  mapId: z.coerce.number().int().optional(),
  spenderId: z.coerce.number().int().optional(),
  from: z.string().optional(), to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

spendRoutes.get("/", async (c) => {
  const q = parseQuery(c, ListQuery); if (!q.ok) return q.res;
  const { db } = c.get("ctx");
  return c.json({ ...(await spendEvents.list(db, q.data)), counts: await spendEvents.countByStatus(db) });
});

spendRoutes.get("/inbox", async (c) => c.json({ inbox: await inbox.list(c.get("ctx").db, 100) }));

spendRoutes.post("/:id/match", async (c) => {
  const { db } = c.get("ctx");
  const id = idParam(c); if (!id) return c.json({ error: "id" }, 400);
  const p = await parseBody(c, MatchSpendSchema); if (!p.ok) return p.res;
  const spender = p.data.spenderId ? await spenders.findById(db, p.data.spenderId)
    : p.data.spenderRobloxUserId ? await spenders.findByRobloxId(db, p.data.spenderRobloxUserId) : null;
  if (!spender) return c.json({ error: "spender tidak ditemukan (harus pernah join game)" }, 404);
  try { return c.json({ event: await matchSpendManually(db, id, spender.id, c.get("userId")!) }); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }
});

/** Owner menyetujui event yang ditahan aturan risiko (status review). */
spendRoutes.post("/:id/approve", async (c) => {
  const { db } = c.get("ctx");
  const id = idParam(c); if (!id) return c.json({ error: "id" }, 400);
  const p = await parseBody(c, ApproveReviewSchema); if (!p.ok) return p.res;
  try { return c.json({ event: await approveReview(db, id, c.get("userId")!, p.data.note) }); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }
});

spendRoutes.post("/:id/void", async (c) => {
  const { db } = c.get("ctx");
  const id = idParam(c); if (!id) return c.json({ error: "id" }, 400);
  const p = await parseBody(c, VoidSpendSchema); if (!p.ok) return p.res;
  try { return c.json({ event: await voidSpend(db, id, p.data.reason, c.get("userId")!) }); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }
});

// ---- spenders ----
export const spenderRoutes = new Hono<{ Variables: Vars }>();

const SpenderListQuery = PageQuery.extend({ q: z.string().trim().min(1).max(80).optional(), adminId: z.coerce.number().int().optional(), mapId: z.coerce.number().int().optional() });

spenderRoutes.get("/", async (c) => {
  const q = parseQuery(c, SpenderListQuery); if (!q.ok) return q.res;
  return c.json(paged(q.data, await spenders.list(c.get("ctx").db, q.data)));
});

spenderRoutes.get("/:id", async (c) => {
  const { db } = c.get("ctx");
  const id = idParam(c); if (!id) return c.json({ error: "id" }, 400);
  const s = await spenders.findById(db, id); if (!s) return c.json({ error: "tidak ditemukan" }, 404);
  return c.json({ spender: s, referralEvents: await referralEvents.listBySpender(db, id), spendEvents: (await spendEvents.list(db, { spenderId: id, limit: 200 })).rows });
});

/** Override referrer oleh owner (kasus khusus). Tidak menghitung ulang event lama. */
spenderRoutes.post("/:id/referrer", async (c) => {
  const { db } = c.get("ctx");
  const id = idParam(c); if (!id) return c.json({ error: "id" }, 400);
  const p = await parseBody(c, z.object({ adminId: z.coerce.number().int().positive().nullable() })); if (!p.ok) return p.res;
  const before = await spenders.findById(db, id); if (!before) return c.json({ error: "tidak ditemukan" }, 404);
  const after = await spenders.forceReferrer(db, id, p.data.adminId, p.data.adminId ? new Date().toISOString() : null);
  await audit.log(db, { actorUserId: c.get("userId")!, action: "spender.override_referrer", entity: "spender", entityId: id, before, after });
  return c.json({ spender: after });
});
