import { all, one, run, scalar, type Db } from "../connection";
import type { AuditRow, InboxRow } from "../types";

export const inbox = {
  create: async (db: Db, v: { source: string; headers?: unknown; body?: string | null; authOk: boolean; status: InboxRow["status"]; error?: string | null }) =>
    (await one<InboxRow>(db, `INSERT INTO webhook_inbox(source, headers, body, auth_ok, status, error) VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
      [v.source, v.headers === undefined ? null : JSON.stringify(v.headers), v.body ?? null, v.authOk ? 1 : 0, v.status, v.error ?? null]))!,
  finish: (db: Db, id: number, status: InboxRow["status"], error: string | null, spendEventId: number | null) =>
    run(db, "UPDATE webhook_inbox SET status = ?, error = ?, spend_event_id = ? WHERE id = ?", [status, error, spendEventId, id]),
  list: (db: Db, limit = 100) => all<InboxRow>(db, "SELECT * FROM webhook_inbox ORDER BY id DESC LIMIT ?", [limit]),
};

export const robloxUserCache = {
  get: (db: Db, username: string, maxAgeHours = 24 * 7) =>
    one<{ username_lower: string; roblox_user_id: number | null; username: string | null; display_name: string | null }>(db,
      `SELECT * FROM roblox_user_cache WHERE username_lower = ? AND resolved_at > now() - make_interval(hours => ?::int)`,
      [username.toLowerCase(), maxAgeHours]),
  put: (db: Db, username: string, v: { robloxUserId: number | null; username: string | null; displayName: string | null }) =>
    run(db, `INSERT INTO roblox_user_cache(username_lower, roblox_user_id, username, display_name, resolved_at)
            VALUES (?, ?, ?, ?, now())
            ON CONFLICT(username_lower) DO UPDATE SET roblox_user_id = excluded.roblox_user_id, username = excluded.username,
              display_name = excluded.display_name, resolved_at = excluded.resolved_at`,
      [username.toLowerCase(), v.robloxUserId, v.username, v.displayName]),
};

export const audit = {
  log: (db: Db, v: { actorUserId: number | null; action: string; entity: string; entityId?: string | number | null; before?: unknown; after?: unknown }) =>
    run(db, `INSERT INTO audit_log(actor_user_id, action, entity, entity_id, before, after) VALUES (?, ?, ?, ?, ?, ?)`,
      [v.actorUserId, v.action, v.entity, v.entityId == null ? null : String(v.entityId),
        v.before === undefined ? null : JSON.stringify(v.before), v.after === undefined ? null : JSON.stringify(v.after)]),
  list: async (db: Db, f: { limit?: number; offset?: number } = {}) => {
    const rows = await all<AuditRow & { actor_username: string | null }>(db,
      "SELECT l.*, u.username AS actor_username FROM audit_log l LEFT JOIN users u ON u.id = l.actor_user_id ORDER BY l.id DESC LIMIT ? OFFSET ?",
      [f.limit ?? 50, f.offset ?? 0]);
    const total = await scalar(db, "SELECT COUNT(*) c FROM audit_log");
    return { rows, total };
  },
};
