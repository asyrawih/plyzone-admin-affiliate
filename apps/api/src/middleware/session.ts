import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { sessions } from "@klsm/db";
import type { Vars } from "../context";

export const COOKIE = "klsm_session";

export function sessionCookieOpts(secure: boolean, maxAgeSec: number) {
  return { httpOnly: true, secure, sameSite: "Lax" as const, path: "/", maxAge: maxAgeSec };
}

export const requireOwner: MiddlewareHandler<{ Variables: Vars }> = async (c, next) => {
  const { db } = c.get("ctx");
  const sid = getCookie(c, COOKIE);
  const s = sid ? await sessions.find(db, sid) : null;
  if (!s) return c.json({ error: "unauthorized" }, 401);
  c.set("userId", s.user_id);
  await next();
};

export { setCookie, deleteCookie, getCookie };
