import { Hono } from "hono";
import { CreateAdminSchema, SetAdminLoginSchema, UpdateAdminSchema, buildShareLink, generatePublicToken, generateReferralCode } from "@klsm/shared";
import { adminSessions, admins, audit, ledger, maps, referralEvents, type AdminRow, type Db } from "@klsm/db";
import type { AppContext } from "../../context";
import { hashPassword } from "../../services/password";
import { adminMonthly, adminSummary, perMap } from "@klsm/analytics";
import type { Vars } from "../../context";
import { PageQuery, idParam, paged, parseBody, parseQuery } from "../../http";

export const adminRoutes = new Hono<{ Variables: Vars }>();

async function shareLinks(db: Db, code: string) {
  return (await maps.list(db)).filter((m) => m.is_active && m.place_id).map((m) => ({ mapId: m.id, mapName: m.name, placeId: m.place_id, url: buildShareLink(m.place_id!, code) }));
}

const strip = ({ password_hash: _p, ...a }: AdminRow) => a;

/**
 * Username Roblox → UserId lewat Roblox Users API (sama seperti saat admin daftar sendiri). Gagal/tidak ketemu → null,
 * tanpa melempar: owner tetap bisa menyimpan username-nya, tapi undangan Roblox admin ini belum terdeteksi sampai ada UserId.
 */
async function resolveRoblox(ctx: AppContext, username: string | null | undefined): Promise<{ id: number; name: string } | null> {
  const u = username?.trim();
  if (!u) return null;
  try { const r = await ctx.resolveUsername(u); return r ? { id: r.id, name: r.name } : null; } catch { return null; }
}

adminRoutes.get("/", async (c) => {
  const { db } = c.get("ctx");
  const bal = new Map((await admins.availableBalances(db)).map((b) => [b.admin_id, b]));
  return c.json({ admins: (await admins.list(db)).map((a) => ({ ...strip(a), balance_idr: (bal.get(a.id)?.available ?? 0) + (bal.get(a.id)?.held ?? 0), available_idr: bal.get(a.id)?.available ?? 0, held_idr: bal.get(a.id)?.held ?? 0 })), counts: await admins.countByStatus(db) });
});

adminRoutes.post("/:id/approve", async (c) => {
  const { db } = c.get("ctx");
  const id = idParam(c); if (!id) return c.json({ error: "id" }, 400);
  const before = await admins.findById(db, id); if (!before) return c.json({ error: "tidak ditemukan" }, 404);
  const a = await admins.update(db, id, { status: "active" });
  await audit.log(db, { actorUserId: c.get("userId")!, action: "admin.approve", entity: "admin", entityId: id, before: { status: before.status }, after: { status: "active" } });
  return c.json({ admin: strip(a!) });
});

adminRoutes.post("/:id/reject", async (c) => {
  const { db } = c.get("ctx");
  const id = idParam(c); if (!id) return c.json({ error: "id" }, 400);
  const before = await admins.findById(db, id); if (!before) return c.json({ error: "tidak ditemukan" }, 404);
  const a = await admins.update(db, id, { status: "inactive" });
  await adminSessions.deleteByAdmin(db, id);
  await audit.log(db, { actorUserId: c.get("userId")!, action: "admin.reject", entity: "admin", entityId: id, before: { status: before.status }, after: { status: "inactive" } });
  return c.json({ admin: strip(a!) });
});

/** Owner memberi login ke admin yang dibuat manual, atau reset password admin. */
adminRoutes.post("/:id/set-login", async (c) => {
  const { db } = c.get("ctx");
  const id = idParam(c); if (!id) return c.json({ error: "id" }, 400);
  if (!(await admins.findById(db, id))) return c.json({ error: "tidak ditemukan" }, 404);
  const p = await parseBody(c, SetAdminLoginSchema); if (!p.ok) return p.res;
  const taken = await admins.findByUsername(db, p.data.username);
  if (taken && taken.id !== id) return c.json({ error: "username sudah dipakai" }, 409);
  const a = await admins.update(db, id, { username: p.data.username, passwordHash: await hashPassword(p.data.password) });
  await adminSessions.deleteByAdmin(db, id);
  await audit.log(db, { actorUserId: c.get("userId")!, action: "admin.set_login", entity: "admin", entityId: id, after: { username: p.data.username } });
  return c.json({ admin: strip(a!) });
});

adminRoutes.post("/", async (c) => {
  const ctx = c.get("ctx"); const { db } = ctx;
  const p = await parseBody(c, CreateAdminSchema);
  if (!p.ok) return p.res;
  let code = generateReferralCode();
  while (await admins.findByCode(db, code)) code = generateReferralCode();
  // UserId tidak diisi tapi username ada → cari otomatis; username dinormalkan ke ejaan resmi Roblox.
  let robloxUserId = p.data.robloxUserId ?? null; let robloxUsername = p.data.robloxUsername?.trim() || null; let robloxResolved: boolean | null = null;
  if (!robloxUserId && robloxUsername) { const r = await resolveRoblox(ctx, robloxUsername); robloxResolved = !!r; if (r) { robloxUserId = r.id; robloxUsername = r.name; } }
  const a = await admins.create(db, { displayName: p.data.displayName, robloxUserId, robloxUsername, referralCode: code, publicToken: generatePublicToken(), notes: p.data.notes });
  await audit.log(db, { actorUserId: c.get("userId")!, action: "admin.create", entity: "admin", entityId: a.id, after: strip(a) });
  return c.json({ admin: strip(a), shareLinks: await shareLinks(db, a.referral_code), robloxResolved }, 201);
});

/** Cari ulang UserId Roblox dari username yang tersimpan (mis. dulu diisi username saja, atau API Roblox sempat down). */
adminRoutes.post("/:id/resolve-roblox", async (c) => {
  const ctx = c.get("ctx"); const { db } = ctx;
  const id = idParam(c); if (!id) return c.json({ error: "id" }, 400);
  const before = await admins.findById(db, id); if (!before) return c.json({ error: "tidak ditemukan" }, 404);
  if (!before.roblox_username) return c.json({ error: "username Roblox belum diisi" }, 400);
  const r = await resolveRoblox(ctx, before.roblox_username);
  if (!r) return c.json({ error: `username Roblox "${before.roblox_username}" tidak ditemukan (atau API Roblox sedang tidak bisa dihubungi)`, admin: strip(before), robloxResolved: false }, 404);
  const a = await admins.update(db, id, { robloxUserId: r.id, robloxUsername: r.name });
  await audit.log(db, { actorUserId: c.get("userId")!, action: "admin.resolve_roblox", entity: "admin", entityId: id, before: { roblox_user_id: before.roblox_user_id, roblox_username: before.roblox_username }, after: { roblox_user_id: r.id, roblox_username: r.name } });
  return c.json({ admin: strip(a!), robloxResolved: true });
});

/** Riwayat undangan admin ini (link maupun undangan Roblox) beserta hasilnya, untuk tab "Undangan" di detail admin. */
adminRoutes.get("/:id/invites", async (c) => {
  const id = idParam(c); if (!id) return c.json({ error: "id" }, 400);
  const q = parseQuery(c, PageQuery); if (!q.ok) return q.res;
  const r = await referralEvents.listByAdmin(c.get("ctx").db, id, q.data);
  return c.json(paged(q.data, { rows: r.rows.map((e) => ({
    id: e.id, joined_at: e.joined_at, outcome: e.outcome, own: e.own, via: e.inviter_roblox_user_id ? "invite" : "link",
    spender_id: e.spender_id, spender_username: e.spender_username, spender_roblox_user_id: e.spender_roblox_user_id, map_name: e.map_name, code_raw: e.referral_code_raw,
  })), total: r.total }));
});

adminRoutes.get("/:id", async (c) => {
  const { db, analytics, config } = c.get("ctx");
  const id = idParam(c); if (!id) return c.json({ error: "id" }, 400);
  const a = await admins.findById(db, id); if (!a) return c.json({ error: "tidak ditemukan" }, 404);
  const [summary, monthly, mapsBreakdown] = await Promise.all([adminSummary(analytics, id), adminMonthly(analytics, id, 12), perMap(analytics, {}, id)]);
  const { available, held } = await admins.availableBalance(db, id);
  return c.json({
    admin: strip(a), summary, monthly, maps: mapsBreakdown,
    balance_idr: await admins.balance(db, id), available_idr: available, held_idr: held,
    shareLinks: await shareLinks(db, a.referral_code),
    publicUrl: `${config.dashboardOrigin}/a/${a.public_token}`,
    // Daftar spender/event/payout admin ini: pakai /api/spenders?adminId=, /api/spend-events?adminId=, /api/payouts?adminId= (berhalaman).
  });
});

adminRoutes.get("/:id/ledger", async (c) => {
  const id = idParam(c); if (!id) return c.json({ error: "id" }, 400);
  const q = parseQuery(c, PageQuery); if (!q.ok) return q.res;
  return c.json(paged(q.data, await ledger.list(c.get("ctx").db, { adminId: id, ...q.data })));
});

adminRoutes.patch("/:id", async (c) => {
  const ctx = c.get("ctx"); const { db } = ctx;
  const id = idParam(c); if (!id) return c.json({ error: "id" }, 400);
  const before = await admins.findById(db, id); if (!before) return c.json({ error: "tidak ditemukan" }, 404);
  const p = await parseBody(c, UpdateAdminSchema);
  if (!p.ok) return p.res;
  const patchData: Parameters<typeof admins.update>[2] = { ...p.data };
  let robloxResolved: boolean | null = null;
  // Username Roblox diganti tanpa UserId → cari otomatis. Username dikosongkan → UserId ikut kosong.
  if (p.data.robloxUsername !== undefined && p.data.robloxUserId == null) {
    const uname = p.data.robloxUsername?.trim() || null;
    if (!uname) { patchData.robloxUsername = null; patchData.robloxUserId = null; }
    else if (uname.toLowerCase() !== (before.roblox_username ?? "").toLowerCase() || !before.roblox_user_id) {
      const r = await resolveRoblox(ctx, uname); robloxResolved = !!r;
      patchData.robloxUsername = r ? r.name : uname; patchData.robloxUserId = r ? r.id : null;
    }
  }
  const a = await admins.update(db, id, patchData);
  if (p.data.status === "inactive") await adminSessions.deleteByAdmin(db, id);
  await audit.log(db, { actorUserId: c.get("userId")!, action: "admin.update", entity: "admin", entityId: id, before: strip(before), after: strip(a!) });
  return c.json({ admin: strip(a!), robloxResolved });
});

adminRoutes.post("/:id/regenerate-token", async (c) => {
  const { db, config } = c.get("ctx");
  const id = idParam(c); if (!id) return c.json({ error: "id" }, 400);
  const a = await admins.setPublicToken(db, id, generatePublicToken()); if (!a) return c.json({ error: "tidak ditemukan" }, 404);
  await audit.log(db, { actorUserId: c.get("userId")!, action: "admin.regenerate_token", entity: "admin", entityId: id });
  return c.json({ admin: strip(a), publicUrl: `${config.dashboardOrigin}/a/${a.public_token}` });
});

adminRoutes.get("/:id/share-link", async (c) => {
  const { db } = c.get("ctx");
  const id = idParam(c); if (!id) return c.json({ error: "id" }, 400);
  const a = await admins.findById(db, id); if (!a) return c.json({ error: "tidak ditemukan" }, 404);
  return c.json({ referralCode: a.referral_code, launchData: `ref_${a.referral_code}`, shareLinks: await shareLinks(db, a.referral_code) });
});
