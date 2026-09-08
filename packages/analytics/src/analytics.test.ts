import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { admins, spenders, spendEvents, ledger, rates, type Db } from "@klsm/db";
import { createTestDb } from "@klsm/db/testing";
import { Analytics, overview, timeseries, leaderboard, adminsSummary, funnel } from "./index";

let a: Analytics; let db: Db; let drop: () => Promise<void>;
let ad: Awaited<ReturnType<typeof admins.create>>; let sp: Awaited<ReturnType<typeof spenders.upsert>>; let rt: Awaited<ReturnType<typeof rates.create>>;

const mk = async (ext: string, at: string, gross: number) => (await spendEvents.insert(db, {
  source: "robux", externalId: ext, mapId: null, spenderId: sp.id, adminId: ad.id, occurredAt: at,
  grossAmount: gross, grossCurrency: "ROBUX", robloxFeeBps: 3000, netRobux: Math.floor(gross * 0.7), idrPerRobux: 145,
  netIdr: Math.floor(gross * 0.7) * 145, commissionBps: 1000, commissionIdr: Math.floor(Math.floor(gross * 0.7) * 145 * 0.1),
  rateId: rt.id, status: "attributed", matchedBy: "auto",
}))!;

beforeAll(async () => {
  const t = await createTestDb(); db = t.db; drop = t.drop;
  ad = await admins.create(db, { displayName: "Andi", referralCode: "AAA111", publicToken: "t1" });
  rt = await rates.create(db, { commissionBps: 1000, robloxFeeBps: 3000, idrPerRobux: 145, minPayoutIdr: 0, effectiveFrom: "2020-01-01T00:00:00.000Z" });
  sp = await spenders.upsert(db, 42, "player42", "2026-09-01T00:00:00.000Z");
  await spenders.attribute(db, sp.id, ad.id, null, "2026-09-01T00:00:00.000Z");
  const e1 = await mk("p1", "2026-09-01T10:00:00.000Z", 1000); // Jakarta: 1 Sep 17:00
  const e2 = await mk("p2", "2026-09-01T18:00:00.000Z", 1000); // Jakarta: 2 Sep 01:00
  await ledger.add(db, { adminId: ad.id, type: "earn", amountIdr: e1.commission_idr, spendEventId: e1.id });
  await ledger.add(db, { adminId: ad.id, type: "earn", amountIdr: e2.commission_idr, spendEventId: e2.id });
  a = await Analytics.open({ databaseUrl: t.url });
});

afterAll(async () => { await a.close(); await drop(); });

describe("analytics", () => {
  test("overview", async () => {
    const o = await overview(a, {});
    expect(o.events).toBe(2);
    expect(o.net_idr).toBe(203_000);
    expect(o.commission_idr).toBe(20_300);
    expect(o.outstanding_balance_idr).toBe(20_300);
    expect(o.new_referrals).toBe(1);
  });
  test("timeseries pakai hari Jakarta", async () => {
    const t = await timeseries(a, {}, "day");
    expect(t.map((x) => x.bucket)).toEqual(["2026-09-01", "2026-09-02"]);
  });
  test("leaderboard & summary", async () => {
    const l = await leaderboard(a, {});
    expect(l[0]?.display_name).toBe("Andi");
    expect(l[0]?.commission_idr).toBe(20_300);
    const s = await adminsSummary(a);
    expect(s[0]?.balance_idr).toBe(20_300);
    expect(s[0]?.referrals).toBe(1);
  });
  test("funnel", async () => {
    const f = await funnel(a, {});
    expect(f.referred).toBe(1);
    expect(f.converted).toBe(1);
  });
  test("live: data baru di Postgres langsung terlihat DuckDB tanpa snapshot", async () => {
    await mk("p3", "2026-09-03T10:00:00.000Z", 1000);
    const o = await overview(a, {});
    expect(o.events).toBe(3);
    expect(o.net_idr).toBe(304_500);
  });
});
