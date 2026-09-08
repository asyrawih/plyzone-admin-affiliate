import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rates, users, admins as adminsRepo, one } from "@klsm/db";
import { createTestDb } from "@klsm/db/testing";
import { config as baseConfig } from "../src/config";
import { createContext, type AppContext } from "../src/context";
import { createApp } from "../src/app";
import { hashPassword } from "../src/services/password";

let ctx: AppContext; let app: ReturnType<typeof createApp>; let dropDb: () => Promise<void>;
let cookie = ""; let mapKey = ""; let adminId = 0; let code = ""; let token = "";

const json = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method, headers: { "content-type": "application/json", cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeAll(async () => {
  const t = await createTestDb(); dropDb = t.drop;
  ctx = await createContext(
    { ...baseConfig, databaseUrl: t.url, dbPoolMax: 4, webhookSharedSecret: "s3cret", webhookHmacSecret: null },
    { resolveUsername: async (u) => (u.toLowerCase() === "player42" ? { id: 42, name: "player42", displayName: "P42" } : null) },
  );
  await users.create(ctx.db, "owner", await hashPassword("pw"));
  // holdHours 0 supaya skenario dasar tidak terpengaruh masa tahan; masa tahan diuji terpisah di bawah.
  await rates.create(ctx.db, { commissionBps: 1000, robloxFeeBps: 3000, idrPerRobux: 145, minPayoutIdr: 0, effectiveFrom: "2000-01-01T00:00:00.000Z", holdHours: 0 });
  app = createApp(ctx);
});
afterAll(async () => { await ctx.close(); await dropDb(); });

describe("e2e", () => {
  test("login", async () => {
    expect((await json("POST", "/api/auth/login", { username: "owner", password: "wrong" })).status).toBe(401);
    const r = await json("POST", "/api/auth/login", { username: "owner", password: "pw" });
    expect(r.status).toBe(200);
    cookie = r.headers.get("set-cookie")!.split(";")[0]!;
    expect((await json("GET", "/api/auth/me")).status).toBe(200);
  });

  test("owner-only guard", async () => {
    const r = await app.request("/api/admins");
    expect(r.status).toBe(401);
  });

  test("buat map + admin", async () => {
    const m = await (await json("POST", "/api/config/maps", { name: "Main", placeId: 123456 })).json() as any;
    mapKey = m.ingestKey; expect(mapKey).toStartWith("mk_");
    const a = await (await json("POST", "/api/admins", { displayName: "Andi" })).json() as any;
    adminId = a.admin.id; code = a.admin.referral_code; token = a.admin.public_token;
    expect(a.shareLinks[0].url).toBe(`https://www.roblox.com/games/start?placeId=123456&launchData=ref_${code}`);
  });

  test("ingest join: atribusi first-touch", async () => {
    expect((await json("POST", "/ingest/join", { robloxUserId: 42, username: "player42" })).status).toBe(401);
    const h = { "x-map-key": mapKey };
    let r = await (await json("POST", "/ingest/join", { robloxUserId: 42, username: "player42", launchData: `ref_${code}` }, h)).json() as any;
    expect(r.outcome).toBe("attributed"); expect(r.referrerAdminId).toBe(adminId);
    r = await (await json("POST", "/ingest/join", { robloxUserId: 42, username: "player42", launchData: "ref_ZZZZZZ" }, h)).json() as any;
    expect(r.outcome).toBe("unknown_code"); expect(r.referrerAdminId).toBe(adminId);
    r = await (await json("POST", "/ingest/join", { robloxUserId: 99, username: "organic99" }, h)).json() as any;
    expect(r.outcome).toBe("no_code"); expect(r.referrerAdminId).toBeNull();
  });

  test("ingest robux: idempoten + komisi", async () => {
    const h = { "x-map-key": mapKey };
    const body = { purchaseId: "P-1", robloxUserId: 42, productId: 7, currencySpent: 1000, purchasedAt: "2026-08-10T10:00:00Z" };
    const r1 = await (await json("POST", "/ingest/robux", body, h)).json() as any;
    expect(r1.duplicate).toBe(false); expect(r1.status).toBe("attributed"); expect(r1.commissionIdr).toBe(10150);
    const r2 = await (await json("POST", "/ingest/robux", body, h)).json() as any;
    expect(r2.duplicate).toBe(true); expect(r2.eventId).toBe(r1.eventId);
    const org = await (await json("POST", "/ingest/robux", { purchaseId: "P-2", robloxUserId: 99, currencySpent: 500 }, h)).json() as any;
    expect(org.status).toBe("unattributed"); expect(org.commissionIdr).toBe(0);
    expect((await adminsRepo.balance(ctx.db, adminId))).toBe(10150);
  });

  test("webhook bagibagi: auth, match auto, unmatched", async () => {
    expect((await json("POST", "/webhook/bagibagi", { id: "bb-0", amount: 1 })).status).toBe(401);
    const h = { "x-webhook-secret": "s3cret" };
    const ok = await (await json("POST", "/webhook/bagibagi", { transaction_id: "bb-1", donator_name: "player42", amount: "Rp 50.000", message: "gas", created_at: "2026-08-11T03:00:00Z" }, h)).json() as any;
    expect(ok.status).toBe("attributed");
    const un = await (await json("POST", "/webhook/bagibagi", { id: "bb-2", name: "Orang Asing", amount: 20000, message: "halo" }, h)).json() as any;
    expect(un.status).toBe("unmatched");
    const dup = await (await json("POST", "/webhook/bagibagi", { id: "bb-2", name: "Orang Asing", amount: 20000 }, h)).json() as any;
    expect(dup.duplicate).toBe(true);
    expect((await adminsRepo.balance(ctx.db, adminId))).toBe(10150 + 5000);

    const list = await (await json("GET", "/api/spend-events?status=unmatched")).json() as any;
    expect(list.total).toBe(1);
    const m = await (await json("POST", `/api/spend-events/${un.eventId}/match`, { spenderRobloxUserId: 42 })).json() as any;
    expect(m.event.status).toBe("attributed"); expect(m.event.commission_idr).toBe(2000);
    expect((await adminsRepo.balance(ctx.db, adminId))).toBe(17150);
  });

  test("ingest bagibagi dari game: robloxUserId match langsung, tanpa id → tebak username", async () => {
    const h = { "x-map-key": mapKey };
    const direct = await (await json("POST", "/ingest/bagibagi", { id: "g-1", donorName: "siapa saja", amountIdr: 30000, message: "halo", robloxUserId: 42, occurredAt: "2026-08-12T03:00:00Z" }, h)).json() as any;
    expect(direct.status).toBe("attributed"); expect(direct.commissionIdr).toBe(3000);
    const guess = await (await json("POST", "/ingest/bagibagi", { id: "g-2", donorName: "x", amountIdr: 10000, message: "dari player42 nih", occurredAt: "2026-08-12T04:00:00Z" }, h)).json() as any;
    expect(guess.status).toBe("attributed"); expect(guess.commissionIdr).toBe(1000);
    const none = await (await json("POST", "/ingest/bagibagi", { id: "g-3", donorName: "Anonim", amountIdr: 5000, message: "" }, h)).json() as any;
    expect(none.status).toBe("unmatched");
    expect((await json("POST", "/ingest/bagibagi", { id: "g-4", amountIdr: 1 })).status).toBe(401);
    expect((await adminsRepo.balance(ctx.db, adminId))).toBe(17150 + 4000);
  });

  test("void membalik ledger", async () => {
    const list = await (await json("GET", "/api/spend-events?source=robux&status=attributed")).json() as any;
    const ev = list.rows[0];
    const v = await (await json("POST", `/api/spend-events/${ev.id}/void`, { reason: "refund" })).json() as any;
    expect(v.event.status).toBe("void");
    expect((await adminsRepo.balance(ctx.db, adminId))).toBe(11000);
    expect((await json("POST", `/api/spend-events/${ev.id}/void`, { reason: "lagi" })).status).toBe(400);
  });

  test("payout bulanan + paid, saldo jadi 0", async () => {
    const prev = await (await json("POST", "/api/payouts/generate-monthly", { month: "2026-08", dryRun: true })).json() as any;
    expect(prev.preview.rows[0].eligible).toBe(true); expect(prev.preview.rows[0].balance).toBe(11000);
    const gen = await (await json("POST", "/api/payouts/generate-monthly", { month: "2026-08" })).json() as any;
    expect(gen.created).toHaveLength(1);
    expect((await adminsRepo.balance(ctx.db, adminId))).toBe(0);
    const again = await (await json("POST", "/api/payouts/generate-monthly", { month: "2026-08" })).json() as any;
    expect(again.created).toHaveLength(0);
    const paid = await (await json("POST", `/api/payouts/${gen.created[0].id}/paid`, { method: "transfer", reference: "TRX1" })).json() as any;
    expect(paid.payout.status).toBe("paid");
    expect((await json("POST", "/api/payouts", { adminId, amountIdr: 1 })).status).toBe(400);
  });

  test("info publik landing", async () => {
    const r = await app.request("/api/public/info");
    expect(r.status).toBe(200);
    const info = await r.json() as any;
    expect(info.rate.commission_bps).toBeGreaterThan(0);
    expect(info.maps.length).toBeGreaterThan(0);
    expect(info.stats.active_admins).toBeGreaterThan(0);
  });

  test("halaman publik admin", async () => {
    expect((await app.request("/a/deadbeef")).status).toBe(404);
    const p = await (await app.request(`/a/${token}`)).json() as any;
    expect(p.admin.referralCode).toBe(code);
    expect(p.balance_idr).toBe(0);
    expect(p.summary.commission_idr).toBe(11000);
    expect(p.summary.paid_idr).toBe(11000);
    const pp = await (await app.request(`/a/${token}/payouts`)).json() as any;
    expect(pp.rows[0].status).toBe("paid"); expect(pp.total).toBe(1);
    const pe = await (await app.request(`/a/${token}/events?limit=1`)).json() as any;
    expect(pe.rows).toHaveLength(1); expect(pe.total).toBeGreaterThan(1);
  });

  test("admin daftar sendiri → pending → approve → portal", async () => {
    const reg = await json("POST", "/api/admin-auth/register", { username: "citra", password: "rahasia123", displayName: "Citra", robloxUsername: "player42" }, { cookie: "" });
    expect(reg.status).toBe(201);
    const body = await reg.json() as any;
    expect(body.admin.status).toBe("pending");
    const ac = reg.headers.get("set-cookie")!.split(";")[0]!;
    // pending: /me ok, portal 403
    expect((await app.request("/api/admin-auth/me", { headers: { cookie: ac } })).status).toBe(200);
    expect((await app.request("/api/admin-portal/summary", { headers: { cookie: ac } })).status).toBe(403);
    // kode admin pending tidak bisa dipakai referral
    const j = await (await json("POST", "/ingest/join", { robloxUserId: 555, username: "p555", launchData: `ref_${body.admin.referralCode}` }, { "x-map-key": mapKey })).json() as any;
    expect(j.outcome).toBe("inactive_admin");
    // username dobel ditolak
    expect((await json("POST", "/api/admin-auth/register", { username: "CITRA", password: "rahasia123", displayName: "X" }, { cookie: "" })).status).toBe(409);
    // owner lihat pending & approve
    const list = await (await json("GET", "/api/admins")).json() as any;
    expect(list.counts.pending).toBe(1);
    const ap = await (await json("POST", `/api/admins/${body.admin.id}/approve`)).json() as any;
    expect(ap.admin.status).toBe("active"); expect(ap.admin.password_hash).toBeUndefined();
    // resolveUsername mock → roblox_user_id 42 terisi, jadi self-referral diblokir
    const self = await (await json("POST", "/ingest/join", { robloxUserId: 42, username: "player42", launchData: `ref_${body.admin.referralCode}` }, { "x-map-key": mapKey })).json() as any;
    expect(self.outcome).toBe("self_referral");
    // login & portal
    const lg = await json("POST", "/api/admin-auth/login", { username: "citra", password: "rahasia123" }, { cookie: "" });
    expect(lg.status).toBe(200);
    const ac2 = lg.headers.get("set-cookie")!.split(";")[0]!;
    const portal = await (await app.request("/api/admin-portal/summary", { headers: { cookie: ac2 } })).json() as any;
    expect(portal.admin.username).toBe("citra"); expect(portal.balance_idr).toBe(0); expect(portal.shareLinks).toHaveLength(1);
    // ganti password
    expect((await app.request("/api/admin-auth/change-password", { method: "POST", headers: { cookie: ac2, "content-type": "application/json" }, body: JSON.stringify({ currentPassword: "salah", newPassword: "barubaru123" }) })).status).toBe(400);
    expect((await app.request("/api/admin-auth/change-password", { method: "POST", headers: { cookie: ac2, "content-type": "application/json" }, body: JSON.stringify({ currentPassword: "rahasia123", newPassword: "barubaru123" }) })).status).toBe(200);
    // owner kasih login ke admin manual (Andi)
    expect((await json("POST", `/api/admins/${adminId}/set-login`, { username: "andi", password: "andipass123" })).status).toBe(200);
    expect((await json("POST", "/api/admin-auth/login", { username: "andi", password: "andipass123" }, { cookie: "" })).status).toBe(200);
    // reject → session mati
    await json("POST", `/api/admins/${body.admin.id}/reject`);
    expect((await app.request("/api/admin-portal/summary", { headers: { cookie: ac2 } })).status).toBe(401);
  });

  test("analytics konsisten dengan postgres", async () => {
    const o = await (await json("GET", "/api/analytics/overview?from=2026-08-01T00:00:00Z&to=2026-09-01T00:00:00Z")).json() as any;
    const sq = await one(ctx.db, "SELECT COALESCE(SUM(net_idr),0)::bigint n, COALESCE(SUM(commission_idr),0)::bigint c, COUNT(*) k FROM spend_events WHERE status='attributed' AND occurred_at >= '2026-08-01T00:00:00.000Z' AND occurred_at < '2026-09-01T00:00:00.000Z'") as any;
    expect(o.overview.net_idr).toBe(sq.n); expect(o.overview.commission_idr).toBe(sq.c); expect(o.overview.events).toBe(sq.k);
    const ts = await (await json("GET", "/api/analytics/timeseries?from=2026-08-01T00:00:00Z&to=2026-09-01T00:00:00Z&granularity=month")).json() as any;
    expect(ts.series[0].bucket).toBe("2026-08");
    const lb = await (await json("GET", "/api/analytics/leaderboard?from=2026-08-01T00:00:00Z&to=2026-09-01T00:00:00Z")).json() as any;
    expect(lb.leaderboard[0].display_name).toBe("Andi");
    const csv = await (await json("GET", "/api/analytics/export/spend.csv?from=2026-08-01T00:00:00Z&to=2026-09-01T00:00:00Z")).text();
    expect(csv.split("\n").length).toBeGreaterThan(2);
    const au = await (await json("GET", "/api/audit")).json() as any;
    expect(au.total).toBeGreaterThan(3); expect(au.rows.length).toBeGreaterThan(3);
    const au2 = await (await json("GET", "/api/audit?limit=2&offset=1")).json() as any;
    expect(au2.rows).toHaveLength(2); expect(au2.rows[0].id).toBe(au.rows[1].id);
  });

  test("fase 1: katalog produk R1 → review → approve", async () => {
    const h = { "x-map-key": mapKey };
    const mapsList = await (await json("GET", "/api/config/maps")).json() as any;
    const mapId = mapsList.maps[0].id;
    expect(mapsList.maps[0]).toHaveProperty("stale");
    // katalog: produk 7 = 1000 R$, dikunci
    const put = await (await json("PUT", `/api/config/maps/${mapId}/products`, { products: [{ productId: 7, name: "VIP", priceRobux: 1000, locked: true }] })).json() as any;
    expect(put.products).toHaveLength(1);
    // game sinkron harga lain untuk produk terkunci → tidak menimpa; produk baru masuk
    const sync = await (await json("POST", "/ingest/products", { products: [{ productId: 7, priceRobux: 5, name: "VIP" }, { productId: 8, priceRobux: 250, name: "Boost" }] }, h)).json() as any;
    expect(sync.count).toBe(2);
    const prods = await (await json("GET", `/api/config/maps/${mapId}/products`)).json() as any;
    expect(prods.products.find((x: any) => x.product_id === 7).price_robux).toBe(1000);
    expect(prods.products.find((x: any) => x.product_id === 8).price_robux).toBe(250);
    // harga tidak cocok → review, tanpa ledger, flag R1
    const before = (await adminsRepo.balance(ctx.db, adminId));
    const bad = await (await json("POST", "/ingest/robux", { purchaseId: "P-R1", robloxUserId: 42, productId: 7, currencySpent: 999, purchasedAt: "2026-08-20T10:00:00Z" }, h)).json() as any;
    expect(bad.status).toBe("review");
    expect((await adminsRepo.balance(ctx.db, adminId))).toBe(before);
    const risk = await (await json("GET", "/api/risk?status=open&kind=R1")).json() as any;
    expect(risk.total).toBeGreaterThanOrEqual(1); expect(risk.counts.review).toBeGreaterThanOrEqual(1);
    expect(risk.rows[0].spend_event_id).toBe(bad.eventId);
    // produk tak dikenal → review juga; harga cocok → normal
    const unknown = await (await json("POST", "/ingest/robux", { purchaseId: "P-R1b", robloxUserId: 42, productId: 999, currencySpent: 10, purchasedAt: "2026-08-20T10:01:00Z" }, h)).json() as any;
    expect(unknown.status).toBe("review");
    const good = await (await json("POST", "/ingest/robux", { purchaseId: "P-OK", robloxUserId: 42, productId: 8, currencySpent: 250, purchasedAt: "2026-08-20T10:02:00Z" }, h)).json() as any;
    expect(good.status).toBe("attributed");
    // owner setujui yang pertama → attributed, ledger masuk, flag tertutup
    const ap = await (await json("POST", `/api/spend-events/${bad.eventId}/approve`, { note: "harga promo" })).json() as any;
    expect(ap.event.status).toBe("attributed"); expect(ap.event.commission_idr).toBe(Math.floor(Math.floor(999 * 0.7) * 145 * 0.1));
    expect((await adminsRepo.balance(ctx.db, adminId))).toBe(before + good.commissionIdr + ap.event.commission_idr);
    const after = await (await json("GET", `/api/risk?status=open&kind=R1`)).json() as any;
    expect(after.rows.find((r: any) => r.spend_event_id === bad.eventId)).toBeUndefined();
    expect((await json("POST", `/api/spend-events/${bad.eventId}/approve`, {})).status).toBe(400);
    // void event review: tidak ada ledger yang dibalik, flag jadi confirmed
    const v = await (await json("POST", `/api/spend-events/${unknown.eventId}/void`, { reason: "palsu" })).json() as any;
    expect(v.event.status).toBe("void");
    const conf = await (await json("GET", `/api/risk?status=confirmed`)).json() as any;
    expect(conf.rows.some((r: any) => r.spend_event_id === unknown.eventId)).toBe(true);
  });

  test("fase 1: placeId salah → 403 + flag R7, dismiss flag", async () => {
    const h = { "x-map-key": mapKey };
    const r = await json("POST", "/ingest/robux", { purchaseId: "P-R7", robloxUserId: 42, productId: 8, currencySpent: 250, placeId: 777 }, h);
    expect(r.status).toBe(403);
    const risk = await (await json("GET", "/api/risk?status=open&kind=R7")).json() as any;
    expect(risk.total).toBe(1);
    const d = await (await json("POST", `/api/risk/${risk.rows[0].id}/dismiss`, { note: "tes" })).json() as any;
    expect(d.flag.status).toBe("dismissed");
    expect((await (await json("GET", "/api/risk?status=open&kind=R7")).json() as any).total).toBe(0);
  });

  test("fase 1: masa tahan → saldo tertahan, payout hanya yang tersedia", async () => {
    const h = { "x-map-key": mapKey };
    const nr = await json("POST", "/api/config/rates", { commissionBps: 1000, robloxFeeBps: 3000, idrPerRobux: 145, holdHours: 48 });
    expect(nr.status).toBe(201);
    const avail0 = (await adminsRepo.availableBalance(ctx.db, adminId));
    const ev = await (await json("POST", "/ingest/robux", { purchaseId: "P-HOLD", robloxUserId: 42, productId: 8, currencySpent: 250 }, h)).json() as any;
    expect(ev.status).toBe("attributed"); expect(ev.commissionIdr).toBeGreaterThan(0);
    const avail1 = (await adminsRepo.availableBalance(ctx.db, adminId));
    expect(avail1.available).toBe(avail0.available);
    expect(avail1.held).toBe(avail0.held + ev.commissionIdr);
    const prev = await (await json("POST", "/api/payouts/generate-monthly", { month: "2026-09", dryRun: true })).json() as any;
    const row = prev.preview.rows.find((x: any) => x.adminId === adminId);
    expect(row.balance).toBe(avail1.available); expect(row.held).toBe(avail1.held);
    expect((await json("POST", "/api/payouts", { adminId, amountIdr: avail1.available + 1 })).status).toBe(400);
    const portal = await (await app.request(`/a/${token}`)).json() as any;
    expect(portal.held_idr).toBe(avail1.held);
  });

  test("fase 1: filter mapId & ringkasan per map", async () => {
    const maps = await (await json("GET", "/api/analytics/maps?from=2000-01-01T00:00:00Z&to=2100-01-01T00:00:00Z")).json() as any;
    expect(maps.maps).toHaveLength(1);
    expect(maps.maps[0].events).toBeGreaterThan(0);
    const filtered = await (await json("GET", `/api/spend-events?mapId=${maps.maps[0].map_id}&limit=1`)).json() as any;
    expect(filtered.total).toBeGreaterThan(0);
    const none = await (await json("GET", `/api/spend-events?mapId=9999&limit=1`)).json() as any;
    expect(none.total).toBe(0);
    const ov = await (await json("GET", `/api/analytics/overview?mapId=9999&from=2000-01-01T00:00:00Z&to=2100-01-01T00:00:00Z`)).json() as any;
    expect(ov.overview.events).toBe(0);
  });
  test("kode referral pilihan admin: sekali set, terkunci, alias lama tetap valid", async () => {
    const lg = await json("POST", "/api/admin-auth/login", { username: "andi", password: "andipass123" }, { cookie: "" });
    expect(lg.status).toBe(200);
    const ac = lg.headers.get("set-cookie")!.split(";")[0]!;
    const portal = (path: string, body?: unknown) => app.request(path, { method: body === undefined ? "GET" : "POST", headers: { cookie: ac, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    expect((await portal("/api/admin-portal/referral-code", { code: "ab" })).status).toBe(400);        // terlalu pendek
    expect((await portal("/api/admin-portal/referral-code", { code: "andi_88" })).status).toBe(400);   // underscore
    const set = await portal("/api/admin-portal/referral-code", { code: "andi88" });
    expect(set.status).toBe(200);
    const sj = await set.json() as any;
    expect(sj.referralCode).toBe("ANDI88"); expect(sj.referralCodePrev).toBe(code); expect(sj.referralCodeSetAt).toBeTruthy();
    expect((await portal("/api/admin-portal/referral-code", { code: "lagi99" })).status).toBe(409);    // terkunci
    // admin lain tidak bisa pakai kode yang sama (juga tidak bisa pakai alias lama Andi)
    const b = await (await json("POST", "/api/admins", { displayName: "Budi", robloxUserId: 4343 })).json() as any;
    await json("POST", `/api/admins/${b.admin.id}/set-login`, { username: "budi", password: "budipass123" });
    const lb = await json("POST", "/api/admin-auth/login", { username: "budi", password: "budipass123" }, { cookie: "" });
    const bc = lb.headers.get("set-cookie")!.split(";")[0]!;
    const bset = (c2: string) => app.request("/api/admin-portal/referral-code", { method: "POST", headers: { cookie: bc, "content-type": "application/json" }, body: JSON.stringify({ code: c2 }) });
    expect((await bset("ANDI88")).status).toBe(409);
    expect((await bset(code.toLowerCase())).status).toBe(409);
    expect((await bset("budi77")).status).toBe(200);
    // join lewat kode lama (alias) dan kode baru dua-duanya masuk ke Andi
    const h = { "x-map-key": mapKey };
    const j1 = await (await json("POST", "/ingest/join", { robloxUserId: 777, username: "p777", launchData: `ref_${code}` }, h)).json() as any;
    expect(j1.outcome).toBe("attributed"); expect(j1.referrerAdminId).toBe(adminId); expect(j1.via).toBe("link");
    const j2 = await (await json("POST", "/ingest/join", { robloxUserId: 778, username: "p778", launchData: "ref_andi88" }, h)).json() as any;
    expect(j2.outcome).toBe("attributed"); expect(j2.referrerAdminId).toBe(adminId);
    const me = await (await portal("/api/admin-auth/me")).json() as any;
    expect(me.admin.referralCode).toBe("ANDI88"); expect(me.admin.referralCodePrev).toBe(code);
  });

  test("undangan Roblox (ReferredByPlayerId): first-touch, notifikasi sudah terikat, tombol undang untuk admin", async () => {
    const h = { "x-map-key": mapKey };
    // Andi dapat akun Roblox 4242; Budi sudah 4343
    expect((await json("PATCH", `/api/admins/${adminId}`, { robloxUserId: 4242 })).status).toBe(200);
    // teman masuk lewat undangan Andi → first-touch ke Andi
    const a1 = await (await json("POST", "/ingest/join", { robloxUserId: 900, username: "temanAndi", referredByRobloxUserId: 4242 }, h)).json() as any;
    expect(a1.outcome).toBe("attributed"); expect(a1.via).toBe("invite"); expect(a1.referrerAdminId).toBe(adminId);
    expect(a1.invite.inviterRobloxUserId).toBe(4242); expect(a1.invite.message).toContain("terikat ke kamu");
    // Budi mengundang orang yang sama → sudah terikat ke admin lain (tanpa menyebut siapa)
    const b1 = await (await json("POST", "/ingest/join", { robloxUserId: 900, username: "temanAndi", referredByRobloxUserId: 4343 }, h)).json() as any;
    expect(b1.outcome).toBe("already_referred"); expect(b1.invite.alreadyOwn).toBe(false); expect(b1.invite.message).toBe("temanAndi sudah terikat ke admin lain");
    expect(b1.referrerAdminId).toBe(adminId);
    // Andi mengundang ulang → memang miliknya
    const a2 = await (await json("POST", "/ingest/join", { robloxUserId: 900, username: "temanAndi", referredByRobloxUserId: 4242 }, h)).json() as any;
    expect(a2.outcome).toBe("already_referred"); expect(a2.invite.alreadyOwn).toBe(true);
    // pengundang bukan admin → unknown_code, tanpa atribusi
    const x = await (await json("POST", "/ingest/join", { robloxUserId: 901, username: "p901", referredByRobloxUserId: 5555 }, h)).json() as any;
    expect(x.outcome).toBe("unknown_code"); expect(x.referrerAdminId).toBeNull();
    // LaunchData menang atas ReferredByPlayerId
    const y = await (await json("POST", "/ingest/join", { robloxUserId: 902, username: "p902", launchData: "ref_budi77", referredByRobloxUserId: 4242 }, h)).json() as any;
    expect(y.via).toBe("link"); expect(y.referrerAdminId).not.toBe(adminId);
    // admin sendiri yang join → response bawa kode & launchData untuk tombol "Undang teman"; self-referral tetap diblokir
    const self = await (await json("POST", "/ingest/join", { robloxUserId: 4242, username: "andi_admin", referredByRobloxUserId: 4242 }, h)).json() as any;
    expect(self.outcome).toBe("self_referral"); expect(self.admin.referralCode).toBe("ANDI88"); expect(self.admin.launchData).toBe("ref_ANDI88");
    const plain = await (await json("POST", "/ingest/join", { robloxUserId: 903, username: "p903" }, h)).json() as any;
    expect(plain.admin).toBeNull(); expect(plain.invite).toBeNull();
    // feed undangan di portal Andi
    const lg = await json("POST", "/api/admin-auth/login", { username: "andi", password: "andipass123" }, { cookie: "" });
    const ac = lg.headers.get("set-cookie")!.split(";")[0]!;
    const feed = await (await app.request("/api/admin-portal/invites?limit=10", { headers: { cookie: ac } })).json() as any;
    expect(feed.total).toBeGreaterThanOrEqual(4);
    const inv = feed.rows.filter((r: any) => r.via === "invite" && r.spender_roblox_user_id === 900);
    expect(inv.length).toBe(2); expect(inv.every((r: any) => r.own === true)).toBe(true);
    // feed Budi: undangannya ke 900 tercatat sebagai bukan miliknya
    const lb = await json("POST", "/api/admin-auth/login", { username: "budi", password: "budipass123" }, { cookie: "" });
    const bc = lb.headers.get("set-cookie")!.split(";")[0]!;
    const bfeed = await (await app.request("/api/admin-portal/invites", { headers: { cookie: bc } })).json() as any;
    const brow = bfeed.rows.find((r: any) => r.spender_roblox_user_id === 900);
    expect(brow.outcome).toBe("already_referred"); expect(brow.own).toBe(false);
  });
  test("owner: username Roblox → UserId otomatis, cek ulang, riwayat undangan per admin", async () => {
    // create dengan username yang dikenal resolver (player42 → 42), tanpa UserId
    const c1 = await (await json("POST", "/api/admins", { displayName: "Citra2", robloxUsername: "PLAYER42" })).json() as any;
    expect(c1.robloxResolved).toBe(true); expect(c1.admin.roblox_user_id).toBe(42); expect(c1.admin.roblox_username).toBe("player42");
    // username tidak dikenal → tersimpan tanpa UserId, ditandai
    const c2 = await (await json("POST", "/api/admins", { displayName: "Dodi", robloxUsername: "orangAsing" })).json() as any;
    expect(c2.robloxResolved).toBe(false); expect(c2.admin.roblox_user_id).toBeNull(); expect(c2.admin.roblox_username).toBe("orangAsing");
    expect((await json("POST", `/api/admins/${c2.admin.id}/resolve-roblox`)).status).toBe(404);
    // PATCH ganti username ke yang dikenal → UserId terisi
    const up = await (await json("PATCH", `/api/admins/${c2.admin.id}`, { robloxUsername: "player42" })).json() as any;
    expect(up.robloxResolved).toBe(true); expect(up.admin.roblox_user_id).toBe(42);
    // PATCH kosongkan username → UserId ikut kosong
    const cl = await (await json("PATCH", `/api/admins/${c2.admin.id}`, { robloxUsername: "" })).json() as any;
    expect(cl.admin.roblox_user_id).toBeNull(); expect(cl.admin.roblox_username).toBeNull();
    expect((await json("POST", `/api/admins/${c2.admin.id}/resolve-roblox`)).status).toBe(400);
    // UserId manual tetap dihormati tanpa resolve
    const man = await (await json("PATCH", `/api/admins/${c2.admin.id}`, { robloxUsername: "apaSaja", robloxUserId: 777777 })).json() as any;
    expect(man.admin.roblox_user_id).toBe(777777); expect(man.robloxResolved).toBeNull();
    // riwayat undangan Andi (owner view)
    const inv = await (await json("GET", `/api/admins/${adminId}/invites?limit=5`)).json() as any;
    expect(inv.total).toBeGreaterThanOrEqual(4); expect(inv.rows[0]).toHaveProperty("own"); expect(inv.rows[0]).toHaveProperty("via");
  });
});
