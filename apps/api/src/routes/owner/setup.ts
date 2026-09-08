import { Hono } from "hono";
import { admins, maps, one, rates, scalar } from "@klsm/db";
import type { Vars } from "../../context";

/** Status setup untuk halaman Alur: apa yang sudah/belum terjadi di sistem. */
export const setupRoutes = new Hono<{ Variables: Vars }>();

setupRoutes.get("/", async (c) => {
  const { db, config } = c.get("ctx");
  const n = (sql: string) => scalar(db, sql);
  const rate = await rates.current(db);
  const mapRows = await maps.list(db);
  const adminRows = await admins.list(db);
  return c.json({
    apiUrl: config.appUrl,
    rate: rate ? { commission_bps: rate.commission_bps, roblox_fee_bps: rate.roblox_fee_bps, idr_per_robux: rate.idr_per_robux, min_payout_idr: rate.min_payout_idr } : null,
    maps: mapRows.length,
    mapsWithPlace: mapRows.filter((m) => m.is_active && m.place_id).length,
    admins: adminRows.length,
    activeAdmins: adminRows.filter((a) => a.status === "active").length,
    pendingAdmins: adminRows.filter((a) => a.status === "pending").length,
    joins: await n("SELECT COUNT(*) n FROM spenders"),
    referredSpenders: await n("SELECT COUNT(*) n FROM spenders WHERE referrer_admin_id IS NOT NULL"),
    referralAttributed: await n("SELECT COUNT(*) n FROM referral_events WHERE outcome = 'attributed'"),
    referralUnknownCode: await n("SELECT COUNT(*) n FROM referral_events WHERE outcome = 'unknown_code'"),
    robuxEvents: await n("SELECT COUNT(*) n FROM spend_events WHERE source = 'robux'"),
    bagibagiEvents: await n("SELECT COUNT(*) n FROM spend_events WHERE source = 'bagibagi'"),
    attributedEvents: await n("SELECT COUNT(*) n FROM spend_events WHERE status = 'attributed'"),
    unmatched: await n("SELECT COUNT(*) n FROM spend_events WHERE status = 'unmatched'"),
    ledgerEarn: await n("SELECT COUNT(*) n FROM commission_ledger WHERE type = 'earn'"),
    payouts: await n("SELECT COUNT(*) n FROM payouts"),
    paidPayouts: await n("SELECT COUNT(*) n FROM payouts WHERE status = 'paid'"),
    lastInbox: await one(db, "SELECT received_at, status FROM webhook_inbox ORDER BY id DESC LIMIT 1"),
    lastJoin: await one(db, "SELECT MAX(last_seen_at) t FROM spenders"),
    lastSpend: await one(db, "SELECT MAX(created_at) t FROM spend_events"),
  });
});
