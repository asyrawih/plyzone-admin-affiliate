/**
 * Rumus komisi. Semua nilai integer:
 *  - Robux dan IDR dalam satuan bulat
 *  - persen dalam basis point (bps): 1000 bps = 10.00%
 * Pembulatan selalu ke bawah (floor) supaya sistem tidak pernah membayar lebih.
 */

export const BPS_DENOM = 10_000;

export interface RateSnapshot {
  /** Persen komisi untuk admin, bps. */
  commissionBps: number;
  /** Potongan platform Roblox atas Robux kotor, bps. Default 3000 (30%). */
  robloxFeeBps: number;
  /** Kurs konversi 1 Robux net -> IDR. */
  idrPerRobux: number;
}

export type SpendCurrency = "ROBUX" | "IDR";

export interface CommissionInput {
  grossAmount: number;
  currency: SpendCurrency;
  rate: RateSnapshot;
}

export interface CommissionResult {
  grossAmount: number;
  currency: SpendCurrency;
  robloxFeeBps: number;
  /** Robux setelah dipotong fee. null untuk sumber IDR. */
  netRobux: number | null;
  /** Kurs yang dipakai. null untuk sumber IDR. */
  idrPerRobux: number | null;
  /** Nilai bersih dalam IDR yang jadi dasar komisi. */
  netIdr: number;
  commissionBps: number;
  commissionIdr: number;
}

function assertNonNegInt(name: string, v: number) {
  if (!Number.isInteger(v) || v < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${v}`);
  }
}

export function calcCommission(input: CommissionInput): CommissionResult {
  const { grossAmount, currency, rate } = input;
  assertNonNegInt("grossAmount", grossAmount);
  assertNonNegInt("commissionBps", rate.commissionBps);
  assertNonNegInt("robloxFeeBps", rate.robloxFeeBps);
  assertNonNegInt("idrPerRobux", rate.idrPerRobux);
  if (rate.commissionBps > BPS_DENOM) throw new RangeError("commissionBps > 100%");
  if (rate.robloxFeeBps > BPS_DENOM) throw new RangeError("robloxFeeBps > 100%");

  let netRobux: number | null = null;
  let idrPerRobux: number | null = null;
  let netIdr: number;

  if (currency === "ROBUX") {
    netRobux = Math.floor((grossAmount * (BPS_DENOM - rate.robloxFeeBps)) / BPS_DENOM);
    idrPerRobux = rate.idrPerRobux;
    netIdr = netRobux * idrPerRobux;
  } else {
    netIdr = grossAmount;
  }

  const commissionIdr = Math.floor((netIdr * rate.commissionBps) / BPS_DENOM);

  return {
    grossAmount,
    currency,
    robloxFeeBps: currency === "ROBUX" ? rate.robloxFeeBps : 0,
    netRobux,
    idrPerRobux,
    netIdr,
    commissionBps: rate.commissionBps,
    commissionIdr,
  };
}

/** 1000 -> "10%" ; 1250 -> "12.5%" */
export function formatBps(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/\.?0+$/, "")}%`;
}

export function pctToBps(pct: number): number {
  return Math.round(pct * 100);
}
