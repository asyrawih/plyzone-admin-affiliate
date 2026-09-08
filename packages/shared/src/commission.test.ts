import { describe, expect, test } from "bun:test";
import { calcCommission, formatBps, pctToBps } from "./commission";

const rate = { commissionBps: 1000, robloxFeeBps: 3000, idrPerRobux: 145 };

describe("calcCommission", () => {
  test("robux: 1000 R$ @ fee 30% @ 145 IDR @ 10% = 10.150", () => {
    const r = calcCommission({ grossAmount: 1000, currency: "ROBUX", rate });
    expect(r.netRobux).toBe(700);
    expect(r.netIdr).toBe(101_500);
    expect(r.commissionIdr).toBe(10_150);
  });

  test("robux: floor pada fee", () => {
    // 99 * 0.7 = 69.3 -> 69
    const r = calcCommission({ grossAmount: 99, currency: "ROBUX", rate });
    expect(r.netRobux).toBe(69);
    expect(r.netIdr).toBe(69 * 145);
  });

  test("idr: tidak ada fee, komisi langsung dari kotor", () => {
    const r = calcCommission({ grossAmount: 50_000, currency: "IDR", rate });
    expect(r.netRobux).toBeNull();
    expect(r.idrPerRobux).toBeNull();
    expect(r.robloxFeeBps).toBe(0);
    expect(r.netIdr).toBe(50_000);
    expect(r.commissionIdr).toBe(5_000);
  });

  test("idr: floor pada komisi", () => {
    const r = calcCommission({ grossAmount: 12_345, currency: "IDR", rate: { ...rate, commissionBps: 1250 } });
    // 12345 * 0.125 = 1543.125 -> 1543
    expect(r.commissionIdr).toBe(1_543);
  });

  test("nol tetap nol", () => {
    const r = calcCommission({ grossAmount: 0, currency: "ROBUX", rate });
    expect(r.netIdr).toBe(0);
    expect(r.commissionIdr).toBe(0);
  });

  test("menolak input non-integer / negatif", () => {
    expect(() => calcCommission({ grossAmount: 1.5, currency: "IDR", rate })).toThrow();
    expect(() => calcCommission({ grossAmount: -1, currency: "IDR", rate })).toThrow();
    expect(() => calcCommission({ grossAmount: 1, currency: "IDR", rate: { ...rate, commissionBps: 10_001 } })).toThrow();
  });
});

describe("bps helpers", () => {
  test("formatBps", () => {
    expect(formatBps(1000)).toBe("10%");
    expect(formatBps(1250)).toBe("12.5%");
    expect(formatBps(3000)).toBe("30%");
  });
  test("pctToBps", () => {
    expect(pctToBps(10)).toBe(1000);
    expect(pctToBps(12.5)).toBe(1250);
  });
});
