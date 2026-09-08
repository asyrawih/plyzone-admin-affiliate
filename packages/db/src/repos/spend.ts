import { all, one, run, scalar, type Db } from "../connection";
import type { LedgerRow, LedgerType, SpendEventRow, SpendSource, SpendStatus } from "../types";

export interface NewSpendEvent {
  source: SpendSource; externalId: string; mapId: number | null; spenderId: number | null; adminId: number | null;
  occurredAt: string; grossAmount: number; grossCurrency: "ROBUX" | "IDR"; robloxFeeBps: number;
  netRobux: number | null; idrPerRobux: number | null; netIdr: number; commissionBps: number; commissionIdr: number;
  rateId: number | null; status: SpendStatus; matchedBy: "auto" | "manual" | null;
  donorName?: string | null; message?: string | null; productId?: number | null; rawPayload?: unknown;
  reviewReason?: string | null;
}

export interface SpendListFilter {
  status?: SpendStatus; source?: SpendSource; adminId?: number; spenderId?: number; mapId?: number;
  from?: string; to?: string; limit?: number; offset?: number;
}

export const spendEvents = {
  findById: (db: Db, id: number) => one<SpendEventRow>(db, "SELECT * FROM spend_events WHERE id = ?", [id]),
  findByExternal: (db: Db, source: SpendSource, externalId: string) =>
    one<SpendEventRow>(db, "SELECT * FROM spend_events WHERE source = ? AND external_id = ?", [source, externalId]),
  /** Insert; return null kalau (source, external_id) sudah ada. */
  insert: (db: Db, v: NewSpendEvent) =>
    one<SpendEventRow>(db, `INSERT INTO spend_events(
        source, external_id, map_id, spender_id, admin_id, occurred_at, gross_amount, gross_currency, roblox_fee_bps,
        net_robux, idr_per_robux, net_idr, commission_bps, commission_idr, rate_id, status, matched_by,
        donor_name, message, product_id, raw_payload, review_reason)
      VALUES (?, ?, ?, ?, ?, ?::timestamptz, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (source, external_id) DO NOTHING RETURNING *`,
      [v.source, v.externalId, v.mapId, v.spenderId, v.adminId, v.occurredAt, v.grossAmount, v.grossCurrency, v.robloxFeeBps,
        v.netRobux, v.idrPerRobux, v.netIdr, v.commissionBps, v.commissionIdr, v.rateId, v.status, v.matchedBy,
        v.donorName ?? null, v.message ?? null, v.productId ?? null,
        v.rawPayload === undefined ? null : JSON.stringify(v.rawPayload), v.reviewReason ?? null]),
  /** Owner menyetujui event review: status final ditentukan pemanggil (attributed/unattributed/unmatched). */
  settleReview: (db: Db, id: number, v: { status: SpendStatus; commissionIdr: number }) =>
    one<SpendEventRow>(db, `UPDATE spend_events SET status = ?, commission_idr = ?, review_reason = NULL WHERE id = ? AND status = 'review' RETURNING *`,
      [v.status, v.commissionIdr, id]),
  /** Isi map_id kalau masih kosong (event dibuat dari webhook, lalu game melapor). */
  setMapIfNull: (db: Db, id: number, mapId: number) => run(db, "UPDATE spend_events SET map_id = ? WHERE id = ? AND map_id IS NULL", [mapId, id]),
  listReviewByReason: (db: Db, reasonPrefix: string) =>
    all<SpendEventRow>(db, "SELECT * FROM spend_events WHERE status = 'review' AND review_reason ILIKE ? ORDER BY id", [reasonPrefix + "%"]),
  /** Dipakai saat match manual: isi spender/admin/komisi dan ubah status. */
  applyMatch: (db: Db, id: number, v: {
    spenderId: number; adminId: number | null; status: SpendStatus; commissionBps: number; commissionIdr: number; rateId: number | null;
  }) =>
    one<SpendEventRow>(db, `UPDATE spend_events SET spender_id = ?, admin_id = ?, status = ?, commission_bps = ?, commission_idr = ?, rate_id = ?, matched_by = 'manual'
              WHERE id = ? AND status = 'unmatched' RETURNING *`, [v.spenderId, v.adminId, v.status, v.commissionBps, v.commissionIdr, v.rateId, id]),
  void: (db: Db, id: number, reason: string) =>
    one<SpendEventRow>(db, `UPDATE spend_events SET status = 'void', void_reason = ?, voided_at = now()
              WHERE id = ? AND status != 'void' RETURNING *`, [reason, id]),
  list: async (db: Db, f: SpendListFilter = {}) => {
    const where: string[] = []; const args: unknown[] = [];
    if (f.status) { where.push("e.status = ?"); args.push(f.status); }
    if (f.source) { where.push("e.source = ?"); args.push(f.source); }
    if (f.adminId) { where.push("e.admin_id = ?"); args.push(f.adminId); }
    if (f.spenderId) { where.push("e.spender_id = ?"); args.push(f.spenderId); }
    if (f.mapId) { where.push("e.map_id = ?"); args.push(f.mapId); }
    if (f.from) { where.push("e.occurred_at >= ?::timestamptz"); args.push(f.from); }
    if (f.to) { where.push("e.occurred_at < ?::timestamptz"); args.push(f.to); }
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const countArgs = [...args];
    args.push(f.limit ?? 50, f.offset ?? 0);
    const rows = await all<SpendEventRow & { spender_username: string | null; spender_roblox_user_id: number | null; admin_name: string | null; map_name: string | null }>(db, `
      SELECT e.*, s.roblox_username AS spender_username, s.roblox_user_id AS spender_roblox_user_id,
             a.display_name AS admin_name, m.name AS map_name
      FROM spend_events e
      LEFT JOIN spenders s ON s.id = e.spender_id
      LEFT JOIN admins a ON a.id = e.admin_id
      LEFT JOIN maps m ON m.id = e.map_id
      ${w} ORDER BY e.occurred_at DESC, e.id DESC LIMIT ? OFFSET ?`, args);
    const total = await scalar(db, `SELECT COUNT(*) c FROM spend_events e ${w}`, countArgs);
    return { rows, total };
  },
  countByStatus: async (db: Db) =>
    Object.fromEntries((await all<{ status: string; c: number }>(db, "SELECT status, COUNT(*) c FROM spend_events GROUP BY status")).map((r) => [r.status, r.c])) as Record<SpendStatus, number | undefined>,
};

export const ledger = {
  add: async (db: Db, v: {
    adminId: number; type: LedgerType; amountIdr: number; spendEventId?: number | null; payoutId?: number | null;
    note?: string | null; createdBy?: number | null; availableAt?: string | null;
  }) =>
    (await one<LedgerRow>(db, `INSERT INTO commission_ledger(admin_id, type, amount_idr, spend_event_id, payout_id, note, created_by, available_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?::timestamptz) RETURNING *`,
      [v.adminId, v.type, v.amountIdr, v.spendEventId ?? null, v.payoutId ?? null, v.note ?? null, v.createdBy ?? null, v.availableAt ?? null]))!,
  list: async (db: Db, f: { adminId: number; limit?: number; offset?: number }) => {
    const rows = await all<LedgerRow>(db, "SELECT * FROM commission_ledger WHERE admin_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
      [f.adminId, f.limit ?? 50, f.offset ?? 0]);
    const total = await scalar(db, "SELECT COUNT(*) c FROM commission_ledger WHERE admin_id = ?", [f.adminId]);
    return { rows, total };
  },
  earnForSpend: (db: Db, spendEventId: number) =>
    one<LedgerRow>(db, "SELECT * FROM commission_ledger WHERE spend_event_id = ? AND type = 'earn'", [spendEventId]),
};
