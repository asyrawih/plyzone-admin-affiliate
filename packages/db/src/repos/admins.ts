import { all, one, run, scalar, type Db } from "../connection";
import type { AdminRow, AdminSessionRow, AdminStatus } from "../types";

export const adminSessions = {
  create: (db: Db, id: string, adminId: number, expiresAt: string) =>
    run(db, "INSERT INTO admin_sessions(id, admin_id, expires_at) VALUES (?, ?, ?)", [id, adminId, expiresAt]),
  find: (db: Db, id: string) => one<AdminSessionRow>(db, "SELECT * FROM admin_sessions WHERE id = ? AND expires_at > now()", [id]),
  delete: (db: Db, id: string) => run(db, "DELETE FROM admin_sessions WHERE id = ?", [id]),
  deleteByAdmin: (db: Db, adminId: number) => run(db, "DELETE FROM admin_sessions WHERE admin_id = ?", [adminId]),
  purgeExpired: (db: Db) => run(db, "DELETE FROM admin_sessions WHERE expires_at <= now()"),
};

export const admins = {
  list: (db: Db) => all<AdminRow>(db, "SELECT * FROM admins ORDER BY id"),
  findById: (db: Db, id: number) => one<AdminRow>(db, "SELECT * FROM admins WHERE id = ?", [id]),
  /** Kode pilihan admin ATAU kode otomatis lama (alias), keduanya tidak peka huruf. */
  findByCode: (db: Db, code: string) =>
    one<AdminRow>(db, "SELECT * FROM admins WHERE referral_code = ? OR referral_code_prev = ?", [code.toUpperCase(), code.toUpperCase()]),
  /** Admin yang akun Roblox-nya = pengundang (ReferredByPlayerId). */
  findByRobloxUserId: (db: Db, robloxUserId: number) =>
    one<AdminRow>(db, "SELECT * FROM admins WHERE roblox_user_id = ? ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, id LIMIT 1", [robloxUserId]),
  /** Set kode pilihan admin sekali. null kalau sudah pernah diset (terkunci) atau admin tidak ada. */
  setReferralCode: (db: Db, id: number, code: string) =>
    one<AdminRow>(db, `UPDATE admins SET referral_code_prev = referral_code, referral_code = ?, referral_code_set_at = now(), updated_at = now()
              WHERE id = ? AND referral_code_set_at IS NULL RETURNING *`, [code.toUpperCase(), id]),
  findByToken: (db: Db, token: string) => one<AdminRow>(db, "SELECT * FROM admins WHERE public_token = ?", [token]),
  findByUsername: (db: Db, username: string) => one<AdminRow>(db, "SELECT * FROM admins WHERE lower(username) = lower(?)", [username]),
  countByStatus: async (db: Db) =>
    Object.fromEntries((await all<{ status: string; c: number }>(db, "SELECT status, COUNT(*) c FROM admins GROUP BY status")).map((r) => [r.status, r.c])) as Record<AdminStatus, number | undefined>,
  create: async (db: Db, v: {
    displayName: string; robloxUserId?: number | null; robloxUsername?: string | null;
    referralCode: string; publicToken: string; notes?: string | null;
    username?: string | null; passwordHash?: string | null; status?: AdminStatus;
  }) =>
    (await one<AdminRow>(db, `INSERT INTO admins(display_name, username, password_hash, roblox_user_id, roblox_username, referral_code, public_token, notes, status, approved_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ?::text = 'active' THEN now() END) RETURNING *`,
      [v.displayName, v.username ?? null, v.passwordHash ?? null, v.robloxUserId ?? null, v.robloxUsername ?? null, v.referralCode, v.publicToken,
        v.notes ?? null, v.status ?? "active", v.status ?? "active"]))!,
  update: async (db: Db, id: number, v: {
    displayName?: string; robloxUserId?: number | null; robloxUsername?: string | null;
    notes?: string | null; status?: AdminStatus; username?: string | null; passwordHash?: string | null;
  }) => {
    const sets: string[] = []; const args: unknown[] = [];
    if (v.displayName !== undefined) { sets.push("display_name = ?"); args.push(v.displayName); }
    if (v.robloxUserId !== undefined) { sets.push("roblox_user_id = ?"); args.push(v.robloxUserId); }
    if (v.robloxUsername !== undefined) { sets.push("roblox_username = ?"); args.push(v.robloxUsername); }
    if (v.notes !== undefined) { sets.push("notes = ?"); args.push(v.notes); }
    if (v.username !== undefined) { sets.push("username = ?"); args.push(v.username); }
    if (v.passwordHash !== undefined) { sets.push("password_hash = ?"); args.push(v.passwordHash); }
    if (v.status !== undefined) {
      sets.push("status = ?"); args.push(v.status);
      if (v.status === "active") sets.push("approved_at = COALESCE(approved_at, now())");
    }
    if (!sets.length) return admins.findById(db, id);
    sets.push("updated_at = now()");
    args.push(id);
    return one<AdminRow>(db, `UPDATE admins SET ${sets.join(", ")} WHERE id = ? RETURNING *`, args);
  },
  setPublicToken: (db: Db, id: number, token: string) =>
    one<AdminRow>(db, "UPDATE admins SET public_token = ?, updated_at = now() WHERE id = ? RETURNING *", [token, id]),
  balance: (db: Db, id: number) =>
    scalar(db, "SELECT COALESCE(SUM(amount_idr),0)::bigint b FROM commission_ledger WHERE admin_id = ?", [id]),
  /** Saldo semua admin sekaligus: { admin_id, balance }. */
  balances: (db: Db) =>
    all<{ admin_id: number; balance: number }>(db, `SELECT a.id AS admin_id, COALESCE(SUM(l.amount_idr),0)::bigint AS balance
              FROM admins a LEFT JOIN commission_ledger l ON l.admin_id = a.id GROUP BY a.id`),
  /** Saldo yang sudah lewat masa tahan (bisa dibayar). `held` = sisanya. */
  availableBalance: async (db: Db, id: number, nowIso = new Date().toISOString()) =>
    (await one<{ available: number; held: number }>(db, `SELECT COALESCE(SUM(CASE WHEN available_at IS NULL OR available_at <= ?::timestamptz THEN amount_idr ELSE 0 END),0)::bigint AS available,
                     COALESCE(SUM(CASE WHEN available_at IS NOT NULL AND available_at > ?::timestamptz THEN amount_idr ELSE 0 END),0)::bigint AS held
              FROM commission_ledger WHERE admin_id = ?`, [nowIso, nowIso, id]))!,
  availableBalances: (db: Db, nowIso = new Date().toISOString()) =>
    all<{ admin_id: number; available: number; held: number }>(db, `SELECT a.id AS admin_id,
                     COALESCE(SUM(CASE WHEN l.available_at IS NULL OR l.available_at <= ?::timestamptz THEN l.amount_idr ELSE 0 END),0)::bigint AS available,
                     COALESCE(SUM(CASE WHEN l.available_at IS NOT NULL AND l.available_at > ?::timestamptz THEN l.amount_idr ELSE 0 END),0)::bigint AS held
              FROM admins a LEFT JOIN commission_ledger l ON l.admin_id = a.id GROUP BY a.id`, [nowIso, nowIso]),
};
