import { Hono, type Context } from "hono";
import { admins, payouts, spendEvents } from "@klsm/db";
import { buildShareLink } from "@klsm/shared";
import { adminMonthly, adminSummary, perMap } from "@klsm/analytics";
import { maps } from "@klsm/db";
import type { Vars } from "../context";
import { PageQuery, paged, parseQuery } from "../http";
import { z } from "zod";
const PublicListQuery = PageQuery.extend({ mapId: z.coerce.number().int().optional() });
import { publicEvent, publicPayout } from "./adminPortal";

/** Halaman admin, read-only, tanpa login. Token 64 hex. */
export const publicRoutes = new Hono<{ Variables: Vars }>();

publicRoutes.get("/:token", async (c) => {
  const token = c.req.param("token");
  if (!/^[0-9a-f]{64}$/.test(token)) return c.json({ error: "not found" }, 404);
  const { db, analytics } = c.get("ctx");
  const a = await admins.findByToken(db, token);
  if (!a) return c.json({ error: "not found" }, 404);
  const [summary, monthly, mapsBreakdown, bal, balance, mapRows] = await Promise.all([
    adminSummary(analytics, a.id), adminMonthly(analytics, a.id, 12), perMap(analytics, {}, a.id),
    admins.availableBalance(db, a.id), admins.balance(db, a.id), maps.list(db),
  ]);
  const links = mapRows.filter((m) => m.is_active && m.place_id).map((m) => ({ mapName: m.name, url: buildShareLink(m.place_id!, a.referral_code) }));
  return c.json({
    admin: { displayName: a.display_name, referralCode: a.referral_code, status: a.status, robloxUsername: a.roblox_username },
    balance_idr: balance, available_idr: bal.available, held_idr: bal.held,
    summary, monthly, maps: mapsBreakdown, shareLinks: links,
    // events & payouts: /a/:token/events, /a/:token/payouts (berhalaman)
  });
});

async function findByToken(c: Context<{ Variables: Vars }>) {
  const token = c.req.param("token") ?? "";
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  return admins.findByToken(c.get("ctx").db, token);
}

publicRoutes.get("/:token/events", async (c) => {
  const a = await findByToken(c); if (!a) return c.json({ error: "not found" }, 404);
  const q = parseQuery(c, PublicListQuery); if (!q.ok) return q.res;
  const r = await spendEvents.list(c.get("ctx").db, { adminId: a.id, ...q.data });
  return c.json(paged(q.data, { rows: r.rows.map(publicEvent), total: r.total }));
});
publicRoutes.get("/:token/payouts", async (c) => {
  const a = await findByToken(c); if (!a) return c.json({ error: "not found" }, 404);
  const q = parseQuery(c, PageQuery); if (!q.ok) return q.res;
  const r = await payouts.list(c.get("ctx").db, { adminId: a.id, ...q.data });
  return c.json(paged(q.data, { rows: r.rows.map(publicPayout), total: r.total }));
});
