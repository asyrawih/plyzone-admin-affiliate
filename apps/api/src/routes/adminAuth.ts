import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { AdminLoginSchema, AdminRegisterSchema, ChangePasswordSchema, generatePublicToken, generateReferralCode } from "@klsm/shared";
import { adminSessions, admins, audit, type AdminRow } from "@klsm/db";
import type { Vars } from "../context";
import { ADMIN_COOKIE } from "../middleware/adminSession";
import { sessionCookieOpts } from "../middleware/session";
import { rateLimit } from "../middleware/rateLimit";
import { hashPassword, randomId, verifyPassword } from "../services/password";
import { parseBody } from "../http";

export const adminAuthRoutes = new Hono<{ Variables: Vars }>();
adminAuthRoutes.use("/register", rateLimit(10));
adminAuthRoutes.use("/login", rateLimit(30));

function publicAdmin(a: AdminRow | null) {
  if (!a) return null;
  return { id: a.id, username: a.username, displayName: a.display_name, status: a.status, referralCode: a.referral_code, referralCodePrev: a.referral_code_prev, referralCodeSetAt: a.referral_code_set_at, robloxUsername: a.roblox_username, robloxUserId: a.roblox_user_id, createdAt: a.created_at, approvedAt: a.approved_at };
}

/** Daftar sendiri → status pending sampai owner approve. */
adminAuthRoutes.post("/register", async (c) => {
  const ctx = c.get("ctx"); const { db } = ctx;
  const p = await parseBody(c, AdminRegisterSchema);
  if (!p.ok) return p.res;
  if (await admins.findByUsername(db, p.data.username)) return c.json({ error: "username sudah dipakai" }, 409);
  let code = generateReferralCode();
  while (await admins.findByCode(db, code)) code = generateReferralCode();
  // best-effort resolve roblox username → user id (untuk blokir self-referral)
  let robloxUserId: number | null = null; let robloxUsername = p.data.robloxUsername?.trim() || null;
  if (robloxUsername) {
    try { const u = await ctx.resolveUsername(robloxUsername); if (u) { robloxUserId = u.id; robloxUsername = u.name; } } catch { /* abaikan */ }
  }
  const a = await admins.create(db, {
    displayName: p.data.displayName, username: p.data.username, passwordHash: await hashPassword(p.data.password),
    robloxUserId, robloxUsername, referralCode: code, publicToken: generatePublicToken(), notes: p.data.notes, status: "pending",
  });
  await audit.log(db, { actorUserId: null, action: "admin.register", entity: "admin", entityId: a.id, after: { username: a.username, display_name: a.display_name } });
  const sid = randomId(); const ttl = ctx.config.sessionTtlHours * 3600;
  await adminSessions.create(db, sid, a.id, new Date(Date.now() + ttl * 1000).toISOString());
  setCookie(c, ADMIN_COOKIE, sid, sessionCookieOpts(ctx.config.sessionSecure, ttl));
  return c.json({ ok: true, admin: publicAdmin(a) }, 201);
});

adminAuthRoutes.post("/login", async (c) => {
  const { db, config } = c.get("ctx");
  const p = await parseBody(c, AdminLoginSchema);
  if (!p.ok) return p.res;
  const a = await admins.findByUsername(db, p.data.username);
  const ok = a?.password_hash ? await verifyPassword(p.data.password, a.password_hash) : false;
  if (!a || !ok) return c.json({ error: "username / password salah" }, 401);
  const sid = randomId(); const ttl = config.sessionTtlHours * 3600;
  await adminSessions.purgeExpired(db);
  await adminSessions.create(db, sid, a.id, new Date(Date.now() + ttl * 1000).toISOString());
  setCookie(c, ADMIN_COOKIE, sid, sessionCookieOpts(config.sessionSecure, ttl));
  return c.json({ ok: true, admin: publicAdmin(a) });
});

adminAuthRoutes.post("/logout", async (c) => {
  const { db } = c.get("ctx");
  const sid = getCookie(c, ADMIN_COOKIE);
  if (sid) await adminSessions.delete(db, sid);
  deleteCookie(c, ADMIN_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

/** Siapa saya, termasuk kalau masih pending (supaya UI bisa tampilkan "menunggu approval"). */
adminAuthRoutes.get("/me", async (c) => {
  const { db } = c.get("ctx");
  const sid = getCookie(c, ADMIN_COOKIE);
  const s = sid ? await adminSessions.find(db, sid) : null;
  const a = s ? await admins.findById(db, s.admin_id) : null;
  if (!a) return c.json({ admin: null }, 401);
  return c.json({ admin: publicAdmin(a) });
});

adminAuthRoutes.post("/change-password", async (c) => {
  const { db } = c.get("ctx");
  const sid = getCookie(c, ADMIN_COOKIE);
  const s = sid ? await adminSessions.find(db, sid) : null;
  const a = s ? await admins.findById(db, s.admin_id) : null;
  if (!a || !a.password_hash) return c.json({ error: "unauthorized" }, 401);
  const p = await parseBody(c, ChangePasswordSchema);
  if (!p.ok) return p.res;
  if (!(await verifyPassword(p.data.currentPassword, a.password_hash))) return c.json({ error: "password sekarang salah" }, 400);
  await admins.update(db, a.id, { passwordHash: await hashPassword(p.data.newPassword) });
  return c.json({ ok: true });
});
