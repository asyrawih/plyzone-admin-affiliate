import { all, one, scalar, type Db } from "../connection";
import type { ReferralEventRow, ReferralOutcome, SpenderRow } from "../types";

export const spenders = {
  findById: (db: Db, id: number) => one<SpenderRow>(db, "SELECT * FROM spenders WHERE id = ?", [id]),
  findByRobloxId: (db: Db, robloxUserId: number) => one<SpenderRow>(db, "SELECT * FROM spenders WHERE roblox_user_id = ?", [robloxUserId]),
  findByUsername: (db: Db, username: string) => one<SpenderRow>(db, "SELECT * FROM spenders WHERE lower(roblox_username) = lower(?)", [username]),
  search: (db: Db, q: string, limit = 20) =>
    all<SpenderRow>(db, `SELECT * FROM spenders WHERE roblox_username ILIKE ? OR roblox_user_id::text LIKE ?
              ORDER BY last_seen_at DESC LIMIT ?`, [`%${q}%`, `${q}%`, limit]),
  /** Upsert by roblox_user_id; refresh username & last_seen. */
  upsert: async (db: Db, robloxUserId: number, username: string | null, seenAt: string) =>
    (await one<SpenderRow>(db, `INSERT INTO spenders(roblox_user_id, roblox_username, first_seen_at, last_seen_at)
              VALUES (?, ?, ?::timestamptz, ?::timestamptz)
              ON CONFLICT(roblox_user_id) DO UPDATE SET
                roblox_username = COALESCE(excluded.roblox_username, spenders.roblox_username),
                last_seen_at = GREATEST(spenders.last_seen_at, excluded.last_seen_at)
              RETURNING *`, [robloxUserId, username, seenAt, seenAt]))!,
  /** Set referrer hanya kalau belum ada (first-touch). Return row kalau berhasil, null kalau sudah punya referrer. */
  attribute: (db: Db, id: number, adminId: number, mapId: number | null, at: string) =>
    one<SpenderRow>(db, `UPDATE spenders SET referrer_admin_id = ?, referred_at = ?::timestamptz, referred_map_id = ?
              WHERE id = ? AND referrer_admin_id IS NULL RETURNING *`, [adminId, at, mapId, id]),
  /** Override oleh owner (audit di layer service). */
  forceReferrer: (db: Db, id: number, adminId: number | null, at: string | null) =>
    one<SpenderRow>(db, "UPDATE spenders SET referrer_admin_id = ?, referred_at = ?::timestamptz WHERE id = ? RETURNING *", [adminId, at, id]),
  /** Daftar spender berhalaman. `q` cocok ke username (substring) atau awalan userId. */
  list: async (db: Db, opts: { adminId?: number; mapId?: number; q?: string; limit?: number; offset?: number } = {}) => {
    const where: string[] = []; const args: unknown[] = [];
    if (opts.adminId) { where.push("s.referrer_admin_id = ?"); args.push(opts.adminId); }
    if (opts.mapId) { where.push("s.referred_map_id = ?"); args.push(opts.mapId); }
    if (opts.q) { where.push("(s.roblox_username ILIKE ? OR s.roblox_user_id::text LIKE ?)"); args.push(`%${opts.q}%`, `${opts.q}%`); }
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const countArgs = [...args];
    args.push(opts.limit ?? 50, opts.offset ?? 0);
    const rows = await all<SpenderRow & { referrer_name: string | null; total_net_idr: number; spend_count: number; last_spend_at: string | null }>(db, `
      SELECT s.*, a.display_name AS referrer_name,
        (SELECT COALESCE(SUM(net_idr),0)::bigint FROM spend_events e WHERE e.spender_id = s.id AND e.status IN ('attributed','unattributed')) AS total_net_idr,
        (SELECT COUNT(*) FROM spend_events e WHERE e.spender_id = s.id AND e.status IN ('attributed','unattributed')) AS spend_count,
        (SELECT MAX(occurred_at) FROM spend_events e WHERE e.spender_id = s.id AND e.status != 'void') AS last_spend_at
      FROM spenders s LEFT JOIN admins a ON a.id = s.referrer_admin_id
      ${w} ORDER BY s.last_seen_at DESC LIMIT ? OFFSET ?`, args);
    const total = await scalar(db, `SELECT COUNT(*) c FROM spenders s ${w}`, countArgs);
    return { rows, total };
  },
};

export const referralEvents = {
  create: async (db: Db, v: {
    spenderId: number; mapId: number | null; adminId: number | null; codeRaw: string | null;
    outcome: ReferralOutcome; joinedAt: string; inviterRobloxUserId?: number | null;
  }) =>
    (await one<ReferralEventRow>(db, `INSERT INTO referral_events(spender_id, map_id, admin_id, referral_code_raw, outcome, joined_at, inviter_roblox_user_id)
              VALUES (?, ?, ?, ?, ?, ?::timestamptz, ?) RETURNING *`, [v.spenderId, v.mapId, v.adminId, v.codeRaw, v.outcome, v.joinedAt, v.inviterRobloxUserId ?? null]))!,
  listBySpender: (db: Db, spenderId: number) =>
    all<ReferralEventRow>(db, "SELECT * FROM referral_events WHERE spender_id = ? ORDER BY joined_at DESC", [spenderId]),
  /** Feed undangan untuk portal admin: siapa yang masuk lewat kode/undangannya dan hasilnya. `own` = spender memang miliknya sekarang. */
  listByAdmin: async (db: Db, adminId: number, f: { limit?: number; offset?: number } = {}) => {
    const rows = await all<ReferralEventRow & { spender_username: string | null; spender_roblox_user_id: number; map_name: string | null; own: boolean }>(db, `
      SELECT r.*, s.roblox_username AS spender_username, s.roblox_user_id AS spender_roblox_user_id, m.name AS map_name,
             (s.referrer_admin_id = r.admin_id) AS own
      FROM referral_events r JOIN spenders s ON s.id = r.spender_id LEFT JOIN maps m ON m.id = r.map_id
      WHERE r.admin_id = ? ORDER BY r.joined_at DESC, r.id DESC LIMIT ? OFFSET ?`, [adminId, f.limit ?? 50, f.offset ?? 0]);
    const total = await scalar(db, "SELECT COUNT(*) c FROM referral_events WHERE admin_id = ?", [adminId]);
    return { rows, total };
  },
};
