import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { adminSessions, admins } from "@klsm/db";
import type { Vars } from "../context";

export const ADMIN_COOKIE = "klsm_admin_session";

/** Session admin. Hanya admin berstatus active yang lolos; pending/inactive dapat 403 dengan status-nya. */
export const requireAdmin: MiddlewareHandler<{ Variables: Vars & { adminId: number } }> = async (c, next) => {
  const { db } = c.get("ctx");
  const sid = getCookie(c, ADMIN_COOKIE);
  const s = sid ? await adminSessions.find(db, sid) : null;
  if (!s) return c.json({ error: "unauthorized" }, 401);
  const a = await admins.findById(db, s.admin_id);
  if (!a) return c.json({ error: "unauthorized" }, 401);
  if (a.status !== "active") return c.json({ error: a.status === "pending" ? "menunggu approval owner" : "akun nonaktif", status: a.status }, 403);
  c.set("adminId", a.id);
  await next();
};
