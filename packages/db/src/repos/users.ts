import { all, one, run, scalar, type Db } from "../connection";
import type { SessionRow, UserRow } from "../types";

export const users = {
  findByUsername: (db: Db, username: string) => one<UserRow>(db, "SELECT * FROM users WHERE username = ?", [username]),
  findById: (db: Db, id: number) => one<UserRow>(db, "SELECT * FROM users WHERE id = ?", [id]),
  count: (db: Db) => scalar(db, "SELECT COUNT(*) c FROM users"),
  create: async (db: Db, username: string, passwordHash: string) =>
    (await one<UserRow>(db, "INSERT INTO users(username, password_hash) VALUES (?, ?) RETURNING *", [username, passwordHash]))!,
  updatePassword: (db: Db, id: number, passwordHash: string) => run(db, "UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, id]),
};

export const sessions = {
  create: (db: Db, id: string, userId: number, expiresAt: string) =>
    run(db, "INSERT INTO sessions(id, user_id, expires_at) VALUES (?, ?, ?)", [id, userId, expiresAt]),
  find: (db: Db, id: string) => one<SessionRow>(db, "SELECT * FROM sessions WHERE id = ? AND expires_at > now()", [id]),
  delete: (db: Db, id: string) => run(db, "DELETE FROM sessions WHERE id = ?", [id]),
  purgeExpired: (db: Db) => run(db, "DELETE FROM sessions WHERE expires_at <= now()"),
};
