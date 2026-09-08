import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDb } from "./testing";
import { migrate } from "./migrate";
import { admins, spenders, spendEvents, ledger, rates, type Db } from "./index";

let db: Db; let drop: () => Promise<void>;
beforeAll(async () => { const t = await createTestDb(); db = t.db; drop = t.drop; });
afterAll(async () => { await drop(); });

describe("migrate", () => {
  test("idempotent", async () => {
    // createTestDb sudah menjalankan migrasi; panggilan kedua tidak boleh menjalankan apa pun
    expect(await migrate(db)).toEqual([]);
    const applied = await db.unsafe("SELECT name FROM _migrations ORDER BY name");
    expect(applied.map((r: any) => r.name)).toEqual(["0001_init.sql", "0002_referral_code_choice.sql"]);
  });

  test("first-touch attribution & idempotent spend insert", async () => {
    const a1 = await admins.create(db, { displayName: "A1", referralCode: "AAA111", publicToken: "t1" });
    const a2 = await admins.create(db, { displayName: "A2", referralCode: "BBB222", publicToken: "t2" });
    const s = await spenders.upsert(db, 42, "player42", "2026-09-01T00:00:00.000Z");
    expect(typeof s.id).toBe("number");
    expect(s.first_seen_at).toBe("2026-09-01T00:00:00.000Z");
    expect((await spenders.attribute(db, s.id, a1.id, null, "2026-09-01T00:00:00.000Z"))?.referrer_admin_id).toBe(a1.id);
    expect(await spenders.attribute(db, s.id, a2.id, null, "2026-09-02T00:00:00.000Z")).toBeNull();

    const r = await rates.create(db, { commissionBps: 1000, robloxFeeBps: 3000, idrPerRobux: 145, minPayoutIdr: 0, effectiveFrom: "2020-01-01T00:00:00.000Z" });
    const base = {
      source: "robux" as const, externalId: "p1", mapId: null, spenderId: s.id, adminId: a1.id, occurredAt: "2026-09-01T01:00:00.000Z",
      grossAmount: 1000, grossCurrency: "ROBUX" as const, robloxFeeBps: 3000, netRobux: 700, idrPerRobux: 145, netIdr: 101500,
      commissionBps: 1000, commissionIdr: 10150, rateId: r.id, status: "attributed" as const, matchedBy: "auto" as const,
    };
    const e1 = await spendEvents.insert(db, base);
    expect(e1?.id).toBeGreaterThan(0);
    expect(await spendEvents.insert(db, base)).toBeNull();
    await ledger.add(db, { adminId: a1.id, type: "earn", amountIdr: 10150, spendEventId: e1!.id });
    expect(await admins.balance(db, a1.id)).toBe(10150);
    expect((await admins.availableBalance(db, a1.id)).available).toBe(10150);
  });

  test("username admin tidak peka huruf", async () => {
    await admins.create(db, { displayName: "C", referralCode: "CCC333", publicToken: "t3", username: "citra", passwordHash: "x" });
    expect((await admins.findByUsername(db, "CITRA"))?.username).toBe("citra");
    await expect(admins.create(db, { displayName: "D", referralCode: "DDD444", publicToken: "t4", username: "Citra", passwordHash: "x" })).rejects.toThrow();
  });
});
