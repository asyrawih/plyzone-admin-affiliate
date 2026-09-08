import { Hono } from "hono";
import { IngestBagiBagiSchema, IngestJoinSchema, IngestProductsSchema, IngestRobuxSchema } from "@klsm/shared";
import { admins, mapProducts, maps } from "@klsm/db";
import { buildLaunchData } from "@klsm/shared";
import { flag } from "../services/risk";
import type { Vars } from "../context";
import { requireMapKey } from "../middleware/mapKey";
import { handleJoin } from "../services/attribution";
import { NoRateError, recordBagiBagiSpend, recordRobuxSpend } from "../services/spend";
import { parseBody } from "../http";

export const ingestRoutes = new Hono<{ Variables: Vars }>();
ingestRoutes.use("*", requireMapKey);

ingestRoutes.post("/join", async (c) => {
  const p = await parseBody(c, IngestJoinSchema);
  if (!p.ok) return p.res;
  const db = c.get("ctx").db;
  const r = await handleJoin(db, {
    mapId: c.get("mapId")!, robloxUserId: p.data.robloxUserId, username: p.data.username,
    launchData: p.data.launchData, referredByRobloxUserId: p.data.referredByRobloxUserId, joinedAt: p.data.joinedAt ?? new Date().toISOString(),
  });
  // Diagnostik undangan: satu baris per join di log pod, supaya bisa dilihat apakah LaunchData/ReferredByPlayerId benar-benar sampai dari Roblox.
  console.log(`[join] ${p.data.username}#${p.data.robloxUserId} map=${c.get("mapId")} launchData=${JSON.stringify(p.data.launchData ?? null)} referredBy=${p.data.referredByRobloxUserId ?? "-"} waited=${p.data.waitedSeconds ?? "-"}s → ${r.outcome}${r.via ? ` via ${r.via}` : ""} joinData=${JSON.stringify(p.data.joinData ?? null)}`);
  // Pemain yang join adalah admin aktif? Game memakai ini untuk menampilkan tombol "Undang teman" dengan LaunchData kodenya.
  const me = await admins.findByRobloxUserId(db, p.data.robloxUserId);
  const admin = me && me.status === "active" ? { adminId: me.id, referralCode: me.referral_code, launchData: buildLaunchData(me.referral_code) } : null;
  // Hasil untuk pengundang (kalau masuk lewat undangan Roblox): game menampilkan notifikasi ke pengundang bila dia ada di server.
  const invite = r.via === "invite" ? {
    inviterRobloxUserId: p.data.referredByRobloxUserId, outcome: r.outcome, alreadyOwn: r.alreadyOwn,
    message: r.outcome === "attributed" ? `${p.data.username} sekarang terikat ke kamu`
      : r.outcome === "already_referred" ? (r.alreadyOwn ? `${p.data.username} memang sudah undanganmu` : `${p.data.username} sudah terikat ke admin lain`)
      : r.outcome === "self_referral" ? "tidak bisa mengundang akun sendiri"
      : r.outcome === "inactive_admin" ? "akun adminmu belum aktif" : null,
  } : null;
  return c.json({ ok: true, outcome: r.outcome, via: r.via, spenderId: r.spender.id, referrerAdminId: r.spender.referrer_admin_id, admin, invite });
});

ingestRoutes.post("/robux", async (c) => {
  const p = await parseBody(c, IngestRobuxSchema);
  if (!p.ok) return p.res;
  const db = c.get("ctx").db; const mapId = c.get("mapId")!;
  // R7: map ditentukan dari key; placeId di payload harus cocok. Key bocor tidak bisa mengaku map lain.
  const map = await maps.findById(db, mapId);
  if (p.data.placeId && map?.place_id && p.data.placeId !== map.place_id) {
    await flag.r7(db, { mapId, title: `R7: placeId ${p.data.placeId} tidak cocok dengan map "${map.name}" (${map.place_id})`, details: { placeId: p.data.placeId, purchaseId: p.data.purchaseId, robloxUserId: p.data.robloxUserId } });
    return c.json({ ok: false, error: "placeId tidak cocok dengan map dari x-map-key" }, 403);
  }
  try {
    const r = await recordRobuxSpend(db, {
      mapId, purchaseId: p.data.purchaseId, robloxUserId: p.data.robloxUserId, username: p.data.username,
      productId: p.data.productId, currencySpent: p.data.currencySpent, purchasedAt: p.data.purchasedAt ?? new Date().toISOString(), raw: p.data,
    });
    return c.json({ ok: true, duplicate: r.duplicate, eventId: r.event.id, status: r.event.status, commissionIdr: r.event.commission_idr });
  } catch (e) {
    if (e instanceof NoRateError) return c.json({ ok: false, error: e.message }, 503);
    throw e;
  }
});

/** Katalog produk dari game (server start). Tidak menimpa harga yang dikunci owner. */
ingestRoutes.post("/products", async (c) => {
  const p = await parseBody(c, IngestProductsSchema);
  if (!p.ok) return p.res;
  const db = c.get("ctx").db; const mapId = c.get("mapId")!;
  let count = 0;
  for (const it of p.data.products) { await mapProducts.upsert(db, { mapId, productId: it.productId, name: it.name ?? null, priceRobux: it.priceRobux, source: "game" }); count++; }
  return c.json({ ok: true, count });
});

/** Donasi bagi-bagi dilaporkan dari game server (jalur utama). */
ingestRoutes.post("/bagibagi", async (c) => {
  const p = await parseBody(c, IngestBagiBagiSchema);
  if (!p.ok) return p.res;
  try {
    const r = await recordBagiBagiSpend(c.get("ctx"), {
      externalId: p.data.id, donorName: p.data.donorName, amountIdr: p.data.amountIdr, message: p.data.message,
      username: p.data.username, robloxUserId: p.data.robloxUserId, mapId: c.get("mapId")!,
      occurredAt: p.data.occurredAt ?? new Date().toISOString(), raw: p.data,
    });
    return c.json({ ok: true, duplicate: r.duplicate, eventId: r.event.id, status: r.event.status, commissionIdr: r.event.commission_idr, candidates: r.candidates });
  } catch (e) {
    if (e instanceof NoRateError) return c.json({ ok: false, error: e.message }, 503);
    throw e;
  }
});
