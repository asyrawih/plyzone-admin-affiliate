import { Hono } from "hono";
import { CreateMapSchema, CreateRateSchema, UpdateMapSchema, UpsertProductsSchema, generateIngestKey } from "@klsm/shared";
import { audit, mapProducts, maps, rates } from "@klsm/db";
import type { Vars } from "../../context";
import { idParam, parseBody } from "../../http";
import { sha256Hex } from "../../services/password";

export const configRoutes = new Hono<{ Variables: Vars }>();

configRoutes.get("/rates", async (c) => {
  const { db } = c.get("ctx");
  return c.json({ current: await rates.current(db), history: await rates.list(db) });
});

configRoutes.post("/rates", async (c) => {
  const { db } = c.get("ctx");
  const p = await parseBody(c, CreateRateSchema);
  if (!p.ok) return p.res;
  const r = await rates.create(db, { ...p.data, effectiveFrom: p.data.effectiveFrom ?? new Date().toISOString(), createdBy: c.get("userId")! });
  await audit.log(db, { actorUserId: c.get("userId")!, action: "rate.create", entity: "commission_rate", entityId: r.id, after: r });
  return c.json({ rate: r }, 201);
});

configRoutes.get("/maps", async (c) => {
  const db = c.get("ctx").db;
  const health = new Map((await maps.health(db)).map((h) => [h.map_id, h]));
  const dayAgo = Date.now() - 86_400_000;
  return c.json({
    maps: (await maps.list(db)).map(({ ingest_key_hash: _h, ...m }) => {
      const h = health.get(m.id);
      const lastJoin = h?.last_join_at ? Date.parse(h.last_join_at) : null;
      // Peringatan: map aktif dengan placeId tapi tidak ada join > 24 jam → script mati atau key salah.
      const stale = !!(m.is_active && m.place_id && (lastJoin === null || lastJoin < dayAgo));
      return { ...m, ...h, stale };
    }),
  });
});

configRoutes.get("/maps/:id/products", async (c) => {
  const id = idParam(c); if (!id) return c.json({ error: "id" }, 400);
  return c.json({ products: await mapProducts.listByMap(c.get("ctx").db, id) });
});

/** Owner mengganti/menambah produk (source=owner, bisa mengunci harga). */
configRoutes.put("/maps/:id/products", async (c) => {
  const { db } = c.get("ctx");
  const id = idParam(c); if (!id) return c.json({ error: "id" }, 400);
  if (!(await maps.findById(db, id))) return c.json({ error: "tidak ditemukan" }, 404);
  const p = await parseBody(c, UpsertProductsSchema); if (!p.ok) return p.res;
  const rows = [];
  for (const it of p.data.products) rows.push(await mapProducts.upsert(db, { mapId: id, productId: it.productId, name: it.name ?? null, priceRobux: it.priceRobux, isActive: it.isActive, locked: it.locked, source: "owner" }));
  await audit.log(db, { actorUserId: c.get("userId")!, action: "map.products", entity: "map", entityId: id, after: p.data.products });
  return c.json({ products: rows });
});

configRoutes.delete("/maps/:id/products/:productId", async (c) => {
  const { db } = c.get("ctx");
  const id = idParam(c); const productId = idParam(c, "productId");
  if (!id || !productId) return c.json({ error: "id" }, 400);
  await mapProducts.remove(db, id, productId);
  await audit.log(db, { actorUserId: c.get("userId")!, action: "map.product_delete", entity: "map", entityId: id, after: { productId } });
  return c.json({ ok: true });
});

configRoutes.post("/maps", async (c) => {
  const { db } = c.get("ctx");
  const p = await parseBody(c, CreateMapSchema);
  if (!p.ok) return p.res;
  const key = generateIngestKey();
  const m = await maps.create(db, { name: p.data.name, universeId: p.data.universeId, placeId: p.data.placeId, keyHash: await sha256Hex(key) });
  await audit.log(db, { actorUserId: c.get("userId")!, action: "map.create", entity: "map", entityId: m.id, after: { ...m, ingest_key_hash: undefined } });
  const { ingest_key_hash: _h, ...safe } = m;
  return c.json({ map: safe, ingestKey: key, note: "Simpan key ini, tidak bisa dilihat lagi." }, 201);
});

configRoutes.patch("/maps/:id", async (c) => {
  const { db } = c.get("ctx");
  const id = idParam(c); if (!id) return c.json({ error: "id" }, 400);
  const p = await parseBody(c, UpdateMapSchema);
  if (!p.ok) return p.res;
  const m = await maps.update(db, id, p.data); if (!m) return c.json({ error: "tidak ditemukan" }, 404);
  await audit.log(db, { actorUserId: c.get("userId")!, action: "map.update", entity: "map", entityId: id, after: p.data });
  const { ingest_key_hash: _h, ...safe } = m;
  return c.json({ map: safe });
});

configRoutes.post("/maps/:id/rotate-key", async (c) => {
  const { db } = c.get("ctx");
  const id = idParam(c); if (!id) return c.json({ error: "id" }, 400);
  const key = generateIngestKey();
  const m = await maps.rotateKey(db, id, await sha256Hex(key)); if (!m) return c.json({ error: "tidak ditemukan" }, 404);
  await audit.log(db, { actorUserId: c.get("userId")!, action: "map.rotate_key", entity: "map", entityId: id });
  return c.json({ mapId: id, ingestKey: key, note: "Key lama sudah tidak berlaku." });
});
