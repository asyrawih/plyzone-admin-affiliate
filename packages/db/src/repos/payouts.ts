import { all, one, scalar, type Db } from "../connection";
import type { PayoutRow, PayoutStatus } from "../types";

export const payouts = {
  findById: (db: Db, id: number) => one<PayoutRow>(db, "SELECT * FROM payouts WHERE id = ?", [id]),
  list: async (db: Db, f: { adminId?: number; status?: PayoutStatus; limit?: number; offset?: number } = {}) => {
    const where: string[] = []; const args: unknown[] = [];
    if (f.adminId) { where.push("p.admin_id = ?"); args.push(f.adminId); }
    if (f.status) { where.push("p.status = ?"); args.push(f.status); }
    const w = where.length ? "WHERE " + where.join(" AND ") : "";
    const countArgs = [...args];
    args.push(f.limit ?? 50, f.offset ?? 0);
    const rows = await all<PayoutRow & { admin_name: string }>(db, `SELECT p.*, a.display_name AS admin_name FROM payouts p JOIN admins a ON a.id = p.admin_id
                     ${w} ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`, args);
    const total = await scalar(db, `SELECT COUNT(*) c FROM payouts p ${w}`, countArgs);
    return { rows, total };
  },
  create: async (db: Db, v: {
    adminId: number; amountIdr: number; kind: "monthly" | "adhoc"; periodStart?: string | null; periodEnd?: string | null;
    method?: string | null; reference?: string | null; note?: string | null; createdBy?: number | null;
  }) =>
    (await one<PayoutRow>(db, `INSERT INTO payouts(admin_id, amount_idr, kind, period_start, period_end, method, reference, note, created_by)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [v.adminId, v.amountIdr, v.kind, v.periodStart ?? null, v.periodEnd ?? null, v.method ?? null, v.reference ?? null, v.note ?? null, v.createdBy ?? null]))!,
  markPaid: (db: Db, id: number, v: { method?: string | null; reference?: string | null; proofUrl?: string | null }) =>
    one<PayoutRow>(db, `UPDATE payouts SET status = 'paid', paid_at = now(),
              method = COALESCE(?, method), reference = COALESCE(?, reference), proof_url = COALESCE(?, proof_url)
              WHERE id = ? AND status = 'pending' RETURNING *`, [v.method ?? null, v.reference ?? null, v.proofUrl ?? null, id]),
  cancel: (db: Db, id: number) =>
    one<PayoutRow>(db, `UPDATE payouts SET status = 'cancelled', cancelled_at = now() WHERE id = ? AND status = 'pending' RETURNING *`, [id]),
  existsForPeriod: async (db: Db, adminId: number, periodStart: string, periodEnd: string) =>
    !!(await one(db, `SELECT 1 AS x FROM payouts WHERE admin_id = ? AND kind = 'monthly' AND period_start = ?::timestamptz AND period_end = ?::timestamptz AND status != 'cancelled'`,
      [adminId, periodStart, periodEnd])),
};
