import { Hono } from "hono";
import { admins, audit, ledger, maps, payouts, referralEvents, spenders, spendEvents } from "@klsm/db";
import { ReferralCodeSchema, buildShareLink } from "@klsm/shared";
import { parseBody } from "../http";
import { adminMonthly, adminSummary, perMap } from "@klsm/analytics";
import type { Vars } from "../context";
import { requireAdmin } from "../middleware/adminSession";
import { PageQuery, paged, parseQuery } from "../http";
import { z } from "zod";
const PortalListQuery = PageQuery.extend({ mapId: z.coerce.number().int().optional() });

/** Data untuk portal admin (login). Isinya sama seperti /a/:token plus ledger & daftar spender. */
export const adminPortalRoutes = new Hono<{ Variables: Vars & { adminId: number } }>();
adminPortalRoutes.use("*", requireAdmin);

adminPortalRoutes.get("/summary", async (c) => {
  const { db, analytics, config } = c.get("ctx");
  const id = c.get("adminId");
  const a = (await admins.findById(db, id))!;
  const [summary, monthly, mapsBreakdown, bal, balance, mapRows] = await Promise.all([
    adminSummary(analytics, id), adminMonthly(analytics, id, 12), perMap(analytics, {}, id),
    admins.availableBalance(db, id), admins.balance(db, id), maps.list(db),
  ]);
  return c.json({
    admin: { displayName: a.display_name, username: a.username, referralCode: a.referral_code, referralCodePrev: a.referral_code_prev, referralCodeSetAt: a.referral_code_set_at, status: a.status, robloxUsername: a.roblox_username, robloxUserId: a.roblox_user_id, approvedAt: a.approved_at },
    balance_idr: balance, available_idr: bal.available, held_idr: bal.held,
    summary, monthly, maps: mapsBreakdown,
    shareLinks: mapRows.filter((m) => m.is_active && m.place_id).map((m) => ({ mapName: m.name, url: buildShareLink(m.place_id!, a.referral_code) })),
    publicUrl: `${config.dashboardOrigin}/a/${a.public_token}`,
  });
});

/** Admin memilih kode referralnya SEKALI. Setelah ini terkunci; kode otomatis lama tetap valid sebagai alias. */
adminPortalRoutes.post("/referral-code", async (c) => {
  const { db } = c.get("ctx");
  const id = c.get("adminId");
  const p = await parseBody(c, ReferralCodeSchema); if (!p.ok) return p.res;
  const me = (await admins.findById(db, id))!;
  if (me.referral_code_set_at) return c.json({ error: "kode referral sudah dipilih dan terkunci" }, 409);
  const taken = await admins.findByCode(db, p.data.code);
  if (taken && taken.id !== id) return c.json({ error: "kode sudah dipakai admin lain" }, 409);
  const a = await admins.setReferralCode(db, id, p.data.code);
  if (!a) return c.json({ error: "kode referral sudah dipilih dan terkunci" }, 409);
  await audit.log(db, { actorUserId: null, action: "admin.set_referral_code", entity: "admin", entityId: id, before: { referral_code: me.referral_code }, after: { referral_code: a.referral_code } });
  return c.json({ referralCode: a.referral_code, referralCodePrev: a.referral_code_prev, referralCodeSetAt: a.referral_code_set_at });
});

/** Feed undangan: siapa yang masuk lewat link/undangan admin ini dan hasilnya (berhasil, sudah terikat ke admin lain, dst). */
adminPortalRoutes.get("/invites", async (c) => {
  const q = parseQuery(c, PageQuery); if (!q.ok) return q.res;
  const r = await referralEvents.listByAdmin(c.get("ctx").db, c.get("adminId"), q.data);
  return c.json(paged(q.data, { rows: r.rows.map((e) => ({
    id: e.id, joined_at: e.joined_at, outcome: e.outcome, own: e.own, via: e.inviter_roblox_user_id ? "invite" : "link",
    spender_username: e.spender_username, spender_roblox_user_id: e.spender_roblox_user_id, map_name: e.map_name,
  })), total: r.total }));
});

// Daftar berhalaman untuk portal: { rows, total, limit, offset }.
export const publicEvent = (e: Awaited<ReturnType<typeof spendEvents.list>>["rows"][number]) => ({
  id: e.id, occurred_at: e.occurred_at, source: e.source, status: e.status, spender_username: e.spender_username,
  gross_amount: e.gross_amount, gross_currency: e.gross_currency, net_idr: e.net_idr, commission_idr: e.commission_idr, map_name: e.map_name,
});
export const publicPayout = (p: Awaited<ReturnType<typeof payouts.list>>["rows"][number]) => ({
  id: p.id, amount_idr: p.amount_idr, kind: p.kind, status: p.status, created_at: p.created_at, paid_at: p.paid_at, reference: p.reference, method: p.method,
});

adminPortalRoutes.get("/events", async (c) => {
  const q = parseQuery(c, PortalListQuery); if (!q.ok) return q.res;
  const r = await spendEvents.list(c.get("ctx").db, { adminId: c.get("adminId"), ...q.data });
  return c.json(paged(q.data, { rows: r.rows.map(publicEvent), total: r.total }));
});
adminPortalRoutes.get("/spenders", async (c) => {
  const q = parseQuery(c, PortalListQuery); if (!q.ok) return q.res;
  const r = await spenders.list(c.get("ctx").db, { adminId: c.get("adminId"), ...q.data });
  return c.json(paged(q.data, { rows: r.rows.map((s) => ({ id: s.id, roblox_username: s.roblox_username, referred_at: s.referred_at, spend_count: s.spend_count, total_net_idr: s.total_net_idr, last_spend_at: s.last_spend_at })), total: r.total }));
});
adminPortalRoutes.get("/ledger", async (c) => {
  const q = parseQuery(c, PageQuery); if (!q.ok) return q.res;
  return c.json(paged(q.data, await ledger.list(c.get("ctx").db, { adminId: c.get("adminId"), ...q.data })));
});
adminPortalRoutes.get("/payouts", async (c) => {
  const q = parseQuery(c, PageQuery); if (!q.ok) return q.res;
  const r = await payouts.list(c.get("ctx").db, { adminId: c.get("adminId"), ...q.data });
  return c.json(paged(q.data, { rows: r.rows.map(publicPayout), total: r.total }));
});
