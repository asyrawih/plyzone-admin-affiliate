import {
  admins, ledger, rates, spenders, spendEvents, robloxUserCache, audit, riskFlags, withTx,
  type Db, type SpendEventRow, type SpendStatus,
} from "@klsm/db";
import { calcCommission, extractUsernameCandidates, type SpendCurrency } from "@klsm/shared";
import type { AppContext } from "../context";
import { availableAtFor, checkCatalog, flag } from "./risk";

export class NoRateError extends Error {
  constructor() { super("Belum ada commission rate yang berlaku. Set dulu di Config."); }
}

async function computeForSpender(db: Db, spenderId: number | null, occurredAt: string, gross: number, currency: SpendCurrency) {
  const rate = await rates.effectiveAt(db, occurredAt);
  if (!rate) throw new NoRateError();
  const spender = spenderId ? await spenders.findById(db, spenderId) : null;
  const admin = spender?.referrer_admin_id ? await admins.findById(db, spender.referrer_admin_id) : null;
  const calc = calcCommission({ grossAmount: gross, currency, rate: { commissionBps: rate.commission_bps, robloxFeeBps: rate.roblox_fee_bps, idrPerRobux: rate.idr_per_robux } });
  const status: SpendStatus = spender ? (admin ? "attributed" : "unattributed") : "unmatched";
  return { rate, spender, admin, calc, status };
}

/** Robux dari ProcessReceipt. Idempoten by purchaseId. */
export function recordRobuxSpend(db: Db, v: {
  mapId: number; purchaseId: string; robloxUserId: number; username?: string; productId?: number;
  currencySpent: number; purchasedAt: string; raw?: unknown;
}): Promise<{ event: SpendEventRow; duplicate: boolean }> {
  return withTx(db, async (tx) => {
    const existing = await spendEvents.findByExternal(tx, "robux", v.purchaseId);
    if (existing) return { event: existing, duplicate: true };
    const spender = await spenders.upsert(tx, v.robloxUserId, v.username ?? null, v.purchasedAt);
    const { rate, admin, calc, status: computed } = await computeForSpender(tx, spender.id, v.purchasedAt, v.currencySpent, "ROBUX");
    // R1: cocokkan ke katalog produk map. Gagal → review, tanpa ledger, sampai owner menyetujui.
    const cat = await checkCatalog(tx, v.mapId, v.productId, v.currencySpent);
    const status: SpendStatus = cat.ok ? computed : "review";
    const event = await spendEvents.insert(tx, {
      source: "robux", externalId: v.purchaseId, mapId: v.mapId, spenderId: spender.id, adminId: admin?.id ?? null,
      occurredAt: v.purchasedAt, grossAmount: v.currencySpent, grossCurrency: "ROBUX", robloxFeeBps: calc.robloxFeeBps,
      netRobux: calc.netRobux, idrPerRobux: calc.idrPerRobux, netIdr: calc.netIdr, commissionBps: calc.commissionBps,
      commissionIdr: status === "attributed" ? calc.commissionIdr : 0, rateId: rate.id, status, matchedBy: "auto",
      productId: v.productId ?? null, rawPayload: v.raw, reviewReason: cat.ok ? null : cat.reason,
    });
    if (!event) { return { event: (await spendEvents.findByExternal(tx, "robux", v.purchaseId))!, duplicate: true }; }
    if (!cat.ok) await flag.r1(tx, { spendEventId: event.id, mapId: v.mapId, adminId: admin?.id ?? null, spenderId: spender.id, reason: cat.reason, details: cat.details });
    if (status === "attributed" && admin) {
      await ledger.add(tx, { adminId: admin.id, type: "earn", amountIdr: calc.commissionIdr, spendEventId: event.id, availableAt: availableAtFor(rate) });
    }
    return { event, duplicate: false };
  });
}

/** Donasi bagi-bagi. Coba resolve username → spender. Kalau gagal → unmatched. */
export async function recordBagiBagiSpend(ctx: AppContext, v: {
  externalId: string; donorName: string; amountIdr: number; message: string; username?: string; occurredAt: string; raw?: unknown;
  /** Diisi kalau laporan datang dari game server. */
  mapId?: number | null;
  /** Diisi kalau game sudah mencocokkan donatur ke player di server → match langsung. */
  robloxUserId?: number | null;
}): Promise<{ event: SpendEventRow; duplicate: boolean; candidates: string[] }> {
  const { db } = ctx;
  const existing = await spendEvents.findByExternal(db, "bagibagi", v.externalId);
  if (existing) {
    // Laporan kedua untuk donasi yang sama. Kalau yang pertama dari game dan ditahan R4, webhook proxy ini adalah konfirmasinya.
    if (v.mapId) await spendEvents.setMapIfNull(db, existing.id, v.mapId);
    if (!v.mapId && existing.status === "review" && existing.review_reason?.startsWith("R4")) {
      return { event: await approveReview(db, existing.id, null, "dikonfirmasi webhook proxy"), duplicate: true, candidates: [] };
    }
    return { event: (await spendEvents.findById(db, existing.id))!, duplicate: true, candidates: [] };
  }

  const candidates = extractUsernameCandidates({ username: v.username, name: v.donorName, message: v.message });
  let spenderId: number | null = null;
  if (v.robloxUserId) {
    // game sudah yakin siapa donaturnya (player ada di server) → upsert supaya tercatat walau belum pernah join via link
    spenderId = (await spenders.upsert(db, v.robloxUserId, v.username ?? null, v.occurredAt)).id;
  }
  // 0) kata apa pun di pesan/nama yang persis sama dengan username spender yang sudah dikenal (tanpa panggil API)
  for (const word of `${v.donorName} ${v.message}`.split(/[^A-Za-z0-9_]+/)) {
    if (spenderId) break;
    if (word.length < 3 || candidates.includes(word)) continue;
    const known = await spenders.findByUsername(db, word);
    if (known) { spenderId = known.id; break; }
  }
  for (const cand of candidates) {
    if (spenderId) break;
    // 1) sudah dikenal sebagai spender?
    const known = await spenders.findByUsername(db, cand);
    if (known) { spenderId = known.id; break; }
    // 2) resolve ke Roblox (cache dulu)
    let userId: number | null = null;
    const cached = await robloxUserCache.get(db, cand);
    if (cached) userId = cached.roblox_user_id;
    else {
      try {
        const u = await ctx.resolveUsername(cand);
        await robloxUserCache.put(db, cand, { robloxUserId: u?.id ?? null, username: u?.name ?? null, displayName: u?.displayName ?? null });
        userId = u?.id ?? null;
      } catch { /* API down: lanjut kandidat berikutnya, jadi unmatched dan bisa manual */ }
    }
    if (userId) {
      const byId = await spenders.findByRobloxId(db, userId);
      // Hanya cocokkan ke spender yang SUDAH pernah join game (ada di tabel). User Roblox asing tidak dibuat otomatis.
      if (byId) { spenderId = byId.id; break; }
    }
  }

  const result = await withTx(db, async (tx) => {
    const { rate, admin, calc, status: computed } = await computeForSpender(tx, spenderId, v.occurredAt, v.amountIdr, "IDR");
    // R4: laporan dari game ditahan sampai webhook proxy yang cocok datang (kalau diaktifkan di rate).
    const needConfirm = !!v.mapId && rate.bagibagi_confirm_hours > 0;
    const status: SpendStatus = needConfirm ? "review" : computed;
    const event = await spendEvents.insert(tx, {
      source: "bagibagi", externalId: v.externalId, mapId: v.mapId ?? null, spenderId, adminId: admin?.id ?? null,
      occurredAt: v.occurredAt, grossAmount: v.amountIdr, grossCurrency: "IDR", robloxFeeBps: 0,
      netRobux: null, idrPerRobux: null, netIdr: calc.netIdr, commissionBps: calc.commissionBps,
      commissionIdr: status === "attributed" ? calc.commissionIdr : 0, rateId: rate.id, status,
      matchedBy: spenderId ? "auto" : null, donorName: v.donorName, message: v.message, rawPayload: v.raw,
      reviewReason: needConfirm ? `R4: menunggu konfirmasi webhook proxy (${rate.bagibagi_confirm_hours} jam)` : null,
    });
    if (!event) return { event: (await spendEvents.findByExternal(tx, "bagibagi", v.externalId))!, duplicate: true };
    if (needConfirm) await flag.r4(tx, { spendEventId: event.id, mapId: v.mapId!, adminId: admin?.id ?? null, spenderId, hours: rate.bagibagi_confirm_hours });
    if (status === "attributed" && admin) {
      await ledger.add(tx, { adminId: admin.id, type: "earn", amountIdr: calc.commissionIdr, spendEventId: event.id, availableAt: availableAtFor(rate) });
    }
    return { event, duplicate: false };
  });
  return { ...result, candidates };
}

/** Owner mencocokkan event unmatched ke spender. */
export function matchSpendManually(db: Db, eventId: number, spenderId: number, actorUserId: number): Promise<SpendEventRow> {
  return withTx(db, async (tx) => {
    const ev = await spendEvents.findById(tx, eventId);
    if (!ev) throw new Error("event tidak ditemukan");
    if (ev.status !== "unmatched") throw new Error("hanya event unmatched yang bisa di-match");
    const spender = await spenders.findById(tx, spenderId);
    if (!spender) throw new Error("spender tidak ditemukan");
    const rate = (ev.rate_id ? (await rates.list(tx)).find((r) => r.id === ev.rate_id) : null) ?? await rates.effectiveAt(tx, ev.occurred_at);
    if (!rate) throw new NoRateError();
    const admin = spender.referrer_admin_id ? await admins.findById(tx, spender.referrer_admin_id) : null;
    const calc = calcCommission({ grossAmount: ev.gross_amount, currency: ev.gross_currency, rate: { commissionBps: rate.commission_bps, robloxFeeBps: rate.roblox_fee_bps, idrPerRobux: rate.idr_per_robux } });
    const status: SpendStatus = admin ? "attributed" : "unattributed";
    const updated = await spendEvents.applyMatch(tx, eventId, { spenderId, adminId: admin?.id ?? null, status, commissionBps: calc.commissionBps, commissionIdr: admin ? calc.commissionIdr : 0, rateId: rate.id });
    if (!updated) throw new Error("gagal update event");
    if (admin) await ledger.add(tx, { adminId: admin.id, type: "earn", amountIdr: calc.commissionIdr, spendEventId: eventId, createdBy: actorUserId, note: "manual match", availableAt: availableAtFor(rate) });
    await audit.log(tx, { actorUserId, action: "spend.match", entity: "spend_event", entityId: eventId, before: ev, after: updated });
    return updated;
  });
}

/**
 * Owner (atau sistem, actor null) menyetujui event yang ditahan aturan risiko. Status final mengikuti data spender/admin
 * saat ini, komisi dihitung dari rate event, ledger dibuat dengan masa tahan, flag terkait ditutup.
 */
export function approveReview(db: Db, eventId: number, actorUserId: number | null, note?: string): Promise<SpendEventRow> {
  return withTx(db, async (tx) => {
    const ev = await spendEvents.findById(tx, eventId);
    if (!ev) throw new Error("event tidak ditemukan");
    if (ev.status !== "review") throw new Error("hanya event review yang bisa disetujui");
    const rate = (ev.rate_id ? (await rates.list(tx)).find((r) => r.id === ev.rate_id) : null) ?? await rates.effectiveAt(tx, ev.occurred_at);
    if (!rate) throw new NoRateError();
    const spender = ev.spender_id ? await spenders.findById(tx, ev.spender_id) : null;
    const admin = spender?.referrer_admin_id ? await admins.findById(tx, spender.referrer_admin_id) : null;
    const calc = calcCommission({ grossAmount: ev.gross_amount, currency: ev.gross_currency, rate: { commissionBps: rate.commission_bps, robloxFeeBps: rate.roblox_fee_bps, idrPerRobux: rate.idr_per_robux } });
    const status: SpendStatus = spender ? (admin ? "attributed" : "unattributed") : "unmatched";
    const updated = await spendEvents.settleReview(tx, eventId, { status, commissionIdr: admin ? calc.commissionIdr : 0 });
    if (!updated) throw new Error("gagal update event");
    if (admin) await ledger.add(tx, { adminId: admin.id, type: "earn", amountIdr: calc.commissionIdr, spendEventId: eventId, createdBy: actorUserId, note: note ?? "disetujui dari review", availableAt: availableAtFor(rate) });
    await riskFlags.resolveByEvent(tx, eventId, { status: "dismissed", note: note ?? "event disetujui", by: actorUserId ?? 0 });
    await audit.log(tx, { actorUserId, action: "spend.approve_review", entity: "spend_event", entityId: eventId, before: ev, after: updated });
    return updated;
  });
}

export function voidSpend(db: Db, eventId: number, reason: string, actorUserId: number): Promise<SpendEventRow> {
  return withTx(db, async (tx) => {
    const ev = await spendEvents.findById(tx, eventId);
    if (!ev) throw new Error("event tidak ditemukan");
    if (ev.status === "void") throw new Error("event sudah void");
    const updated = (await spendEvents.void(tx, eventId, reason))!;
    const earn = await ledger.earnForSpend(tx, eventId);
    if (earn && earn.amount_idr !== 0) {
      await ledger.add(tx, { adminId: earn.admin_id, type: "reversal", amountIdr: -earn.amount_idr, spendEventId: eventId, createdBy: actorUserId, note: `void: ${reason}` });
    }
    await riskFlags.resolveByEvent(tx, eventId, { status: "confirmed", note: `void: ${reason}`, by: actorUserId });
    await audit.log(tx, { actorUserId, action: "spend.void", entity: "spend_event", entityId: eventId, before: ev, after: updated });
    return updated;
  });
}
