import { admins, referralEvents, spenders, withTx, type Db, type ReferralOutcome, type SpenderRow } from "@klsm/db";
import { parseLaunchData } from "@klsm/shared";
import { flag } from "./risk";

export interface JoinResult {
  spender: SpenderRow; outcome: ReferralOutcome; adminId: number | null;
  /** Jalur atribusi yang dipakai: link (LaunchData) atau undangan Roblox (ReferredByPlayerId). */
  via: "link" | "invite" | null;
  /** outcome already_referred: true kalau referrer-nya memang admin ini sendiri (undang ulang), false kalau admin lain. */
  alreadyOwn: boolean;
}

/**
 * Dipanggil setiap player join. Upsert spender, lalu kalau bawa kode referral valid (LaunchData) ATAU masuk lewat undangan
 * Roblox dari akun admin (ReferredByPlayerId) dan belum punya referrer → atribusi (first-touch). LaunchData menang kalau dua-duanya ada.
 */
export function handleJoin(db: Db, v: {
  mapId: number; robloxUserId: number; username: string; launchData?: string | null; referredByRobloxUserId?: number | null; joinedAt: string;
}): Promise<JoinResult> {
  return withTx(db, async (tx): Promise<JoinResult> => {
    const spender = await spenders.upsert(tx, v.robloxUserId, v.username, v.joinedAt);
    const code = parseLaunchData(v.launchData);
    const inviter = !code && v.referredByRobloxUserId ? v.referredByRobloxUserId : null;
    const via: JoinResult["via"] = code ? "link" : inviter ? "invite" : null;
    let outcome: ReferralOutcome; let adminId: number | null = null; let alreadyOwn = false;

    if (!code && !inviter) outcome = "no_code";
    else {
      const admin = code ? await admins.findByCode(tx, code) : await admins.findByRobloxUserId(tx, inviter!);
      if (!admin) outcome = "unknown_code";
      else if (admin.status !== "active") { outcome = "inactive_admin"; adminId = admin.id; }
      else if (admin.roblox_user_id != null && admin.roblox_user_id === v.robloxUserId) { outcome = "self_referral"; adminId = admin.id; }
      else if (spender.referrer_admin_id != null) { outcome = "already_referred"; adminId = admin.id; alreadyOwn = spender.referrer_admin_id === admin.id; }
      else {
        const updated = await spenders.attribute(tx, spender.id, admin.id, v.mapId, v.joinedAt);
        outcome = updated ? "attributed" : "already_referred";
        adminId = admin.id;
        if (updated) Object.assign(spender, updated);
      }
    }
    // no_code tidak perlu dicatat, terlalu banyak noise
    if (outcome !== "no_code") {
      await referralEvents.create(tx, {
        spenderId: spender.id, mapId: v.mapId, adminId, codeRaw: code ? (v.launchData ?? null) : `invite:${inviter}`, outcome, joinedAt: v.joinedAt,
        inviterRobloxUserId: inviter,
      });
    }
    if (outcome === "self_referral" && adminId) await flag.r6(tx, { adminId, spenderId: spender.id, mapId: v.mapId, kind: "self_referral" });
    return { spender, outcome, adminId, via, alreadyOwn };
  });
}
