import { Hono } from "hono";
import { RangeQuerySchema } from "@klsm/shared";
import { audit, spendEvents } from "@klsm/db";
import { exportSpendRows, funnel, leaderboard, overview, perMap, referralCohort, sourceMix, timeseries, topSpenders, adminsSummary } from "@klsm/analytics";
import type { Vars } from "../context";
import { PageQuery, defaultRange, paged, parseQuery } from "../http";

export const analyticsRoutes = new Hono<{ Variables: Vars }>();

analyticsRoutes.get("/overview", async (c) => {
  const q = parseQuery(c, RangeQuerySchema); if (!q.ok) return q.res;
  const { analytics, db } = c.get("ctx");
  const range = defaultRange(q.data.from, q.data.to);
  const [o, mix, recent, counts] = await Promise.all([
    overview(analytics, range, q.data.adminId, q.data.mapId), sourceMix(analytics, range, q.data.adminId, q.data.mapId),
    spendEvents.list(db, { limit: 15, mapId: q.data.mapId, adminId: q.data.adminId }).then((r) => r.rows),
    spendEvents.countByStatus(db),
  ]);
  return c.json({ range, overview: o, sourceMix: mix, recent, counts });
});

analyticsRoutes.get("/timeseries", async (c) => {
  const q = parseQuery(c, RangeQuerySchema); if (!q.ok) return q.res;
  const range = defaultRange(q.data.from, q.data.to);
  return c.json({ range, granularity: q.data.granularity, series: await timeseries(c.get("ctx").analytics, range, q.data.granularity, q.data.adminId, q.data.mapId) });
});

analyticsRoutes.get("/leaderboard", async (c) => {
  const q = parseQuery(c, RangeQuerySchema); if (!q.ok) return q.res;
  const range = defaultRange(q.data.from, q.data.to);
  return c.json({ range, leaderboard: await leaderboard(c.get("ctx").analytics, range, 20, q.data.mapId) });
});

/** Ringkasan per map (untuk tabel "Per map" di Overview dan breakdown di detail admin). */
analyticsRoutes.get("/maps", async (c) => {
  const q = parseQuery(c, RangeQuerySchema); if (!q.ok) return q.res;
  const range = defaultRange(q.data.from, q.data.to);
  return c.json({ range, maps: await perMap(c.get("ctx").analytics, range, q.data.adminId) });
});

analyticsRoutes.get("/admins", async (c) => c.json({ admins: await adminsSummary(c.get("ctx").analytics) }));

analyticsRoutes.get("/funnel", async (c) => {
  const q = parseQuery(c, RangeQuerySchema); if (!q.ok) return q.res;
  const range = defaultRange(q.data.from, q.data.to);
  const a = c.get("ctx").analytics;
  return c.json({ range, funnel: await funnel(a, range, q.data.mapId), cohort: await referralCohort(a, 6) });
});

analyticsRoutes.get("/top-spenders", async (c) => {
  const q = parseQuery(c, RangeQuerySchema); if (!q.ok) return q.res;
  const range = defaultRange(q.data.from, q.data.to);
  return c.json({ range, spenders: await topSpenders(c.get("ctx").analytics, range, q.data.adminId, 20, q.data.mapId) });
});

analyticsRoutes.get("/export/spend.csv", async (c) => {
  const q = parseQuery(c, RangeQuerySchema); if (!q.ok) return q.res;
  const range = defaultRange(q.data.from, q.data.to);
  const rows = await exportSpendRows(c.get("ctx").analytics, range, q.data.adminId, q.data.mapId);
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [cols.join(","), ...rows.map((r) => cols.map((k) => esc(r[k])).join(","))].join("\n");
  await audit.log(c.get("ctx").db, { actorUserId: c.get("userId")!, action: "export.spend", entity: "spend_event", after: range });
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="spend-${range.from.slice(0, 10)}_${range.to.slice(0, 10)}.csv"` } });
});

export const auditRoutes = new Hono<{ Variables: Vars }>();
auditRoutes.get("/", async (c) => {
  const q = parseQuery(c, PageQuery); if (!q.ok) return q.res;
  return c.json(paged(q.data, await audit.list(c.get("ctx").db, q.data)));
});
