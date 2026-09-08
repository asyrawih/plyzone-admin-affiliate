import type { MiddlewareHandler } from "hono";
import { maps } from "@klsm/db";
import { sha256Hex } from "../services/password";
import type { Vars } from "../context";

/** Header x-map-key = key mentah dari owner. Disimpan hash-nya di maps.ingest_key_hash. */
export const requireMapKey: MiddlewareHandler<{ Variables: Vars }> = async (c, next) => {
  const key = c.req.header("x-map-key") ?? c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!key) return c.json({ error: "x-map-key wajib" }, 401);
  const m = await maps.findByKeyHash(c.get("ctx").db, await sha256Hex(key));
  if (!m) return c.json({ error: "map key tidak valid / map nonaktif" }, 401);
  c.set("mapId", m.id);
  await next();
};
