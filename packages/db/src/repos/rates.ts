import { all, one, type Db } from "../connection";
import type { RateRow } from "../types";

export const rates = {
  list: (db: Db) => all<RateRow>(db, "SELECT * FROM commission_rates ORDER BY effective_from DESC, id DESC"),
  /** Rate yang berlaku pada waktu tertentu (effective_from <= at, terbaru). */
  effectiveAt: (db: Db, atIso: string) =>
    one<RateRow>(db, "SELECT * FROM commission_rates WHERE effective_from <= ?::timestamptz ORDER BY effective_from DESC, id DESC LIMIT 1", [atIso]),
  current: (db: Db) => rates.effectiveAt(db, new Date().toISOString()),
  create: async (db: Db, v: {
    commissionBps: number; robloxFeeBps: number; idrPerRobux: number; minPayoutIdr: number;
    effectiveFrom: string; createdBy?: number | null; holdHours?: number; bagibagiConfirmHours?: number;
  }) =>
    (await one<RateRow>(db, `INSERT INTO commission_rates(commission_bps, roblox_fee_bps, idr_per_robux, min_payout_idr, effective_from, created_by, hold_hours, bagibagi_confirm_hours)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [v.commissionBps, v.robloxFeeBps, v.idrPerRobux, v.minPayoutIdr, v.effectiveFrom, v.createdBy ?? null, v.holdHours ?? 72, v.bagibagiConfirmHours ?? 0]))!,
};
