import { Hono } from "hono";
import { maps, rates, scalar } from "@klsm/db";
import type { Vars } from "../context";

/** Info publik untuk landing page: rate yang berlaku, map aktif, dan angka ringkas. Tanpa auth, boleh di-cache sebentar. */
export const publicInfoRoutes = new Hono<{ Variables: Vars }>();

publicInfoRoutes.get("/info", async (c) => {
  const { db } = c.get("ctx");
  const rate = await rates.current(db);
  const n = async (sql: string) => Number((await scalar<number | null>(db, sql)) ?? 0);
  c.header("Cache-Control", "public, max-age=60");
  return c.json({
    rate: rate ? { commission_bps: rate.commission_bps, roblox_fee_bps: rate.roblox_fee_bps, idr_per_robux: rate.idr_per_robux, min_payout_idr: rate.min_payout_idr } : null,
    maps: (await maps.list(db)).filter((m) => m.is_active && m.place_id).map((m) => ({ name: m.name, placeId: m.place_id })),
    stats: {
      active_admins: await n("SELECT COUNT(*) n FROM admins WHERE status = 'active'"),
      spenders: await n("SELECT COUNT(*) n FROM spenders WHERE referrer_admin_id IS NOT NULL"),
      attributed_events: await n("SELECT COUNT(*) n FROM spend_events WHERE status = 'attributed'"),
      commission_idr: await n("SELECT COALESCE(SUM(commission_idr),0)::bigint n FROM spend_events WHERE status = 'attributed'"),
      paid_idr: await n("SELECT COALESCE(SUM(amount_idr),0)::bigint n FROM payouts WHERE status = 'paid'"),
    },
  });
});
