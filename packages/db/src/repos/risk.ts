import { all, one, run, scalar, type Db } from "../connection";
import type { RiskFlagRow, RiskSeverity, RiskStatus } from "../types";

export interface NewRiskFlag {
  kind: string; severity: RiskSeverity; title: string;
  adminId?: number | null; mapId?: number | null; spenderId?: number | null; spendEventId?: number | null; details?: unknown;
}

export const riskFlags = {
  create: async (db: Db, v: NewRiskFlag) =>
    (await one<RiskFlagRow>(db, `INSERT INTO risk_flags(kind, severity, title, admin_id, map_id, spender_id, spend_event_id, details)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [v.kind, v.severity, v.title, v.adminId ?? null, v.mapId ?? null, v.spenderId ?? null, v.spendEventId ?? null,
        v.details === undefined ? null : JSON.stringify(v.details)]))!,
  /** Hindari flag ganda yang masih terbuka untuk kombinasi (kind, entitas) yang sama. */
  createIfNoneOpen: async (db: Db, v: NewRiskFlag) => {
    const dup = await one<{ id: number }>(db, `SELECT id FROM risk_flags WHERE status = 'open' AND kind = ?
      AND COALESCE(admin_id,0) = COALESCE(?::bigint,0) AND COALESCE(map_id,0) = COALESCE(?::bigint,0) AND COALESCE(spender_id,0) = COALESCE(?::bigint,0) AND COALESCE(spend_event_id,0) = COALESCE(?::bigint,0)`,
      [v.kind, v.adminId ?? null, v.mapId ?? null, v.spenderId ?? null, v.spendEventId ?? null]);
    return dup ? null : riskFlags.create(db, v);
  },
  findById: (db: Db, id: number) => one<RiskFlagRow>(db, "SELECT * FROM risk_flags WHERE id = ?", [id]),
  list: async (db: Db, f: { status?: RiskStatus; severity?: RiskSeverity; kind?: string; adminId?: number; mapId?: number; limit?: number; offset?: number } = {}) => {
    const where: string[] = []; const args: unknown[] = [];
    if (f.status) { where.push("r.status = ?"); args.push(f.status); }
    if (f.severity) { where.push("r.severity = ?"); args.push(f.severity); }
    if (f.kind) { where.push("r.kind = ?"); args.push(f.kind); }
    if (f.adminId) { where.push("r.admin_id = ?"); args.push(f.adminId); }
    if (f.mapId) { where.push("r.map_id = ?"); args.push(f.mapId); }
    const w = where.length ? "WHERE " + where.join(" AND ") : "";
    const countArgs = [...args]; args.push(f.limit ?? 50, f.offset ?? 0);
    const rows = await all<RiskFlagRow & { admin_name: string | null; map_name: string | null; spender_username: string | null; event_status: string | null; event_source: string | null; event_gross: number | null; event_currency: string | null; event_net_idr: number | null }>(db,
      `SELECT r.*, a.display_name AS admin_name, m.name AS map_name, s.roblox_username AS spender_username,
        e.status AS event_status, e.source AS event_source, e.gross_amount AS event_gross, e.gross_currency AS event_currency, e.net_idr AS event_net_idr
      FROM risk_flags r LEFT JOIN admins a ON a.id = r.admin_id LEFT JOIN maps m ON m.id = r.map_id
      LEFT JOIN spenders s ON s.id = r.spender_id LEFT JOIN spend_events e ON e.id = r.spend_event_id
      ${w} ORDER BY CASE r.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`, args);
    const total = await scalar(db, `SELECT COUNT(*) c FROM risk_flags r ${w}`, countArgs);
    return { rows, total };
  },
  counts: async (db: Db) => {
    const rows = await all<{ severity: RiskSeverity; c: number }>(db, "SELECT severity, COUNT(*) c FROM risk_flags WHERE status = 'open' GROUP BY severity");
    const out = { open: 0, high: 0, medium: 0, low: 0, review: 0 };
    for (const r of rows) { out[r.severity] = r.c; out.open += r.c; }
    out.review = await scalar(db, "SELECT COUNT(*) c FROM spend_events WHERE status = 'review'");
    return out;
  },
  resolve: (db: Db, id: number, v: { status: RiskStatus; note?: string | null; by: number }) =>
    one<RiskFlagRow>(db, `UPDATE risk_flags SET status = ?, note = ?, resolved_by = ?, resolved_at = now() WHERE id = ? RETURNING *`,
      [v.status, v.note ?? null, v.by, id]),
  /** Tutup semua flag terbuka yang menunjuk event ini (mis. setelah owner menyetujui / void). */
  resolveByEvent: (db: Db, spendEventId: number, v: { status: RiskStatus; note?: string | null; by: number }) =>
    run(db, `UPDATE risk_flags SET status = ?, note = ?, resolved_by = ?, resolved_at = now() WHERE spend_event_id = ? AND status = 'open'`,
      [v.status, v.note ?? null, v.by, spendEventId]),
};
