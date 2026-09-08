import { all, one, run, scalar, type Db } from "../connection";
import type { MapProductRow, MapRow } from "../types";

export const maps = {
  list: (db: Db) => all<MapRow>(db, "SELECT * FROM maps ORDER BY id"),
  findById: (db: Db, id: number) => one<MapRow>(db, "SELECT * FROM maps WHERE id = ?", [id]),
  findByKeyHash: (db: Db, hash: string) => one<MapRow>(db, "SELECT * FROM maps WHERE ingest_key_hash = ? AND is_active = 1", [hash]),
  create: async (db: Db, v: { name: string; universeId?: number | null; placeId?: number | null; keyHash: string }) =>
    (await one<MapRow>(db, "INSERT INTO maps(name, universe_id, place_id, ingest_key_hash) VALUES (?, ?, ?, ?) RETURNING *",
      [v.name, v.universeId ?? null, v.placeId ?? null, v.keyHash]))!,
  update: async (db: Db, id: number, v: { name?: string; universeId?: number | null; placeId?: number | null; isActive?: boolean }) => {
    const sets: string[] = []; const args: unknown[] = [];
    if (v.name !== undefined) { sets.push("name = ?"); args.push(v.name); }
    if (v.universeId !== undefined) { sets.push("universe_id = ?"); args.push(v.universeId); }
    if (v.placeId !== undefined) { sets.push("place_id = ?"); args.push(v.placeId); }
    if (v.isActive !== undefined) { sets.push("is_active = ?"); args.push(v.isActive ? 1 : 0); }
    if (!sets.length) return maps.findById(db, id);
    args.push(id);
    return one<MapRow>(db, `UPDATE maps SET ${sets.join(", ")} WHERE id = ? RETURNING *`, args);
  },
  rotateKey: (db: Db, id: number, keyHash: string) =>
    one<MapRow>(db, "UPDATE maps SET ingest_key_hash = ? WHERE id = ? RETURNING *", [keyHash, id]),
  /** Kesehatan per map: aktivitas terakhir & jumlah event 24 jam. Dasar peringatan "script mati / key salah". */
  health: (db: Db) =>
    all<{ map_id: number; last_join_at: string | null; last_spend_at: string | null; events_24h: number; review_count: number; products_count: number }>(db, `
      SELECT m.id AS map_id,
        (SELECT MAX(joined_at) FROM referral_events r WHERE r.map_id = m.id) AS last_join_at,
        (SELECT MAX(occurred_at) FROM spend_events e WHERE e.map_id = m.id) AS last_spend_at,
        (SELECT COUNT(*) FROM spend_events e WHERE e.map_id = m.id AND e.occurred_at >= now() - interval '1 day') AS events_24h,
        (SELECT COUNT(*) FROM spend_events e WHERE e.map_id = m.id AND e.status = 'review') AS review_count,
        (SELECT COUNT(*) FROM map_products p WHERE p.map_id = m.id AND p.is_active = 1) AS products_count
      FROM maps m`),
};

export const mapProducts = {
  listByMap: (db: Db, mapId: number) => all<MapProductRow>(db, "SELECT * FROM map_products WHERE map_id = ? ORDER BY product_id", [mapId]),
  find: (db: Db, mapId: number, productId: number) =>
    one<MapProductRow>(db, "SELECT * FROM map_products WHERE map_id = ? AND product_id = ?", [mapId, productId]),
  countActive: (db: Db, mapId: number) => scalar(db, "SELECT COUNT(*) c FROM map_products WHERE map_id = ? AND is_active = 1", [mapId]),
  /** Upsert satu produk. Dari game (source='game') tidak menimpa baris yang dikunci owner. */
  upsert: async (db: Db, v: { mapId: number; productId: number; name?: string | null; priceRobux: number; isActive?: boolean; locked?: boolean; source: "owner" | "game" }) =>
    (await one<MapProductRow>(db, `INSERT INTO map_products(map_id, product_id, name, price_robux, is_active, locked, source)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(map_id, product_id) DO UPDATE SET
                name = COALESCE(excluded.name, map_products.name),
                price_robux = CASE WHEN map_products.locked = 1 AND excluded.source = 'game' THEN map_products.price_robux ELSE excluded.price_robux END,
                is_active = CASE WHEN excluded.source = 'game' THEN map_products.is_active ELSE excluded.is_active END,
                locked = CASE WHEN excluded.source = 'game' THEN map_products.locked ELSE excluded.locked END,
                source = CASE WHEN map_products.locked = 1 THEN map_products.source ELSE excluded.source END,
                updated_at = now()
              RETURNING *`,
      [v.mapId, v.productId, v.name ?? null, v.priceRobux, v.isActive === false ? 0 : 1, v.locked ? 1 : 0, v.source]))!,
  remove: (db: Db, mapId: number, productId: number) => run(db, "DELETE FROM map_products WHERE map_id = ? AND product_id = ?", [mapId, productId]),
};
