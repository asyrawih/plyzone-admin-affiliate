import { mapProducts, riskFlags, type Db, type RateRow } from "@klsm/db";

/** Kapan komisi dari event ini boleh dibayar: sekarang + hold_hours dari rate yang berlaku. */
export function availableAtFor(rate: RateRow, nowMs = Date.now()): string | null {
  const h = rate.hold_hours ?? 0;
  return h > 0 ? new Date(nowMs + h * 3_600_000).toISOString() : null;
}

/**
 * R1: event Robux harus cocok dengan katalog produk map (kalau map punya katalog aktif).
 * Roblox tidak punya API verifikasi receipt dari luar game, jadi katalog adalah satu-satunya
 * pegangan bahwa angka Robux tidak dikarang lewat ingest key yang bocor.
 */
export async function checkCatalog(db: Db, mapId: number, productId: number | null | undefined, currencySpent: number): Promise<{ ok: true } | { ok: false; reason: string; details: Record<string, unknown> }> {
  if ((await mapProducts.countActive(db, mapId)) === 0) return { ok: true };            // map belum punya katalog: kompatibel ke belakang
  if (productId == null) return { ok: false, reason: "R1: laporan tanpa productId, padahal map punya katalog", details: { currencySpent } };
  const p = await mapProducts.find(db, mapId, productId);
  if (!p || !p.is_active) return { ok: false, reason: `R1: produk ${productId} tidak ada di katalog map`, details: { productId, currencySpent } };
  if (p.price_robux !== currencySpent) return { ok: false, reason: `R1: harga ${currencySpent} R$ ≠ katalog ${p.price_robux} R$ (${p.name ?? productId})`, details: { productId, currencySpent, catalogPrice: p.price_robux } };
  return { ok: true };
}

export const flag = {
  r1: (db: Db, v: { spendEventId: number; mapId: number; adminId: number | null; spenderId: number | null; reason: string; details: unknown }) =>
    riskFlags.create(db, { kind: "R1", severity: "high", title: v.reason, spendEventId: v.spendEventId, mapId: v.mapId, adminId: v.adminId, spenderId: v.spenderId, details: v.details }),
  r4: (db: Db, v: { spendEventId: number; mapId: number; adminId: number | null; spenderId: number | null; hours: number }) =>
    riskFlags.create(db, { kind: "R4", severity: "high", title: `R4: donasi dari game belum dikonfirmasi webhook proxy (batas ${v.hours} jam)`, spendEventId: v.spendEventId, mapId: v.mapId, adminId: v.adminId, spenderId: v.spenderId }),
  r6: (db: Db, v: { adminId: number; spenderId: number; mapId: number; kind: "self_referral" | "upline_self_referral" }) =>
    riskFlags.createIfNoneOpen(db, { kind: "R6", severity: "low", title: `R6: admin mencoba mengundang akun Roblox miliknya sendiri (${v.kind})`, adminId: v.adminId, spenderId: v.spenderId, mapId: v.mapId }),
  r7: (db: Db, v: { mapId: number | null; title: string; details: unknown }) =>
    riskFlags.createIfNoneOpen(db, { kind: "R7", severity: "medium", title: v.title, mapId: v.mapId, details: v.details }),
};
