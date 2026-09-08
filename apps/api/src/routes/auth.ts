import { Hono } from "hono";
import { LoginSchema } from "@klsm/shared";
import { sessions, users } from "@klsm/db";
import type { Vars } from "../context";
import { COOKIE, deleteCookie, getCookie, requireOwner, sessionCookieOpts, setCookie } from "../middleware/session";
import { randomId, verifyPassword } from "../services/password";
import { parseBody } from "../http";

export const authRoutes = new Hono<{ Variables: Vars }>();

authRoutes.post("/login", async (c) => {
  const { db, config } = c.get("ctx");
  const p = await parseBody(c, LoginSchema);
  if (!p.ok) return p.res;
  const u = await users.findByUsername(db, p.data.username);
  const ok = u ? await verifyPassword(p.data.password, u.password_hash) : false;
  if (!u || !ok) return c.json({ error: "username / password salah" }, 401);
  const sid = randomId();
  const ttl = config.sessionTtlHours * 3600;
  await sessions.purgeExpired(db);
  await sessions.create(db, sid, u.id, new Date(Date.now() + ttl * 1000).toISOString());
  setCookie(c, COOKIE, sid, sessionCookieOpts(config.sessionSecure, ttl));
  return c.json({ ok: true, user: { id: u.id, username: u.username } });
});

authRoutes.post("/logout", async (c) => {
  const { db } = c.get("ctx");
  const sid = getCookie(c, COOKIE);
  if (sid) await sessions.delete(db, sid);
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
});

authRoutes.get("/me", requireOwner, async (c) => {
  const u = await users.findById(c.get("ctx").db, c.get("userId")!);
  return c.json({ user: u ? { id: u.id, username: u.username } : null });
});
