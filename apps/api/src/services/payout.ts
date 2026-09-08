import { admins, audit, ledger, payouts, rates, withTx, type Db, type PayoutRow } from "@klsm/db";

/** Batas bulan kalender di timezone tertentu → [startIso, endIso) UTC. */
export function monthBounds(month: string, tz: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const localToUtc = (yy: number, mm: number) => {
    // cari offset tz pada tanggal tsb
    const guess = Date.UTC(yy, mm - 1, 1, 0, 0, 0);
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const parts = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
    const asIfUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
    const offset = asIfUtc - guess;
    return new Date(guess - offset).toISOString();
  };
  const start = localToUtc(y, m);
  const end = m === 12 ? localToUtc(y + 1, 1) : localToUtc(y, m + 1);
  return { start, end };
}

export interface MonthlyPreviewRow { adminId: number; displayName: string; balance: number; held: number; eligible: boolean; reason?: string }

export async function previewMonthly(db: Db, month: string, tz: string): Promise<{ period: { start: string; end: string }; minPayout: number; rows: MonthlyPreviewRow[] }> {
  const period = monthBounds(month, tz);
  const minPayout = (await rates.current(db))?.min_payout_idr ?? 0;
  // Hanya saldo yang sudah lewat masa tahan (available_at) yang bisa dibayar; sisanya tampil sebagai "tertahan".
  const bal = new Map((await admins.availableBalances(db)).map((b) => [b.admin_id, b]));
  const rows: MonthlyPreviewRow[] = [];
  for (const a of await admins.list(db)) {
    const balance = bal.get(a.id)?.available ?? 0;
    const held = bal.get(a.id)?.held ?? 0;
    let reason: string | undefined;
    if (a.status !== "active") reason = "admin nonaktif";
    else if (balance <= 0) reason = held > 0 ? `saldo 0 (tertahan ${held})` : "saldo 0";
    else if (balance < minPayout) reason = `di bawah minimum ${minPayout}`;
    else if (await payouts.existsForPeriod(db, a.id, period.start, period.end)) reason = "sudah ada payout bulan ini";
    rows.push({ adminId: a.id, displayName: a.display_name, balance, held, eligible: !reason, reason });
  }
  return { period, minPayout, rows };
}

export async function generateMonthly(db: Db, month: string, tz: string, actorUserId: number): Promise<PayoutRow[]> {
  const { period, rows } = await previewMonthly(db, month, tz);
  return withTx(db, async (tx) => {
    const created: PayoutRow[] = [];
    for (const r of rows.filter((x) => x.eligible)) {
      const p = await payouts.create(tx, { adminId: r.adminId, amountIdr: r.balance, kind: "monthly", periodStart: period.start, periodEnd: period.end, createdBy: actorUserId, note: `Payout bulanan ${month}` });
      await ledger.add(tx, { adminId: r.adminId, type: "payout", amountIdr: -r.balance, payoutId: p.id, createdBy: actorUserId, note: `payout #${p.id}` });
      await audit.log(tx, { actorUserId, action: "payout.create", entity: "payout", entityId: p.id, after: p });
      created.push(p);
    }
    return created;
  });
}

export function createAdhoc(db: Db, v: { adminId: number; amountIdr: number; method?: string; reference?: string; note?: string }, actorUserId: number): Promise<PayoutRow> {
  return withTx(db, async (tx) => {
    const admin = await admins.findById(tx, v.adminId);
    if (!admin) throw new Error("admin tidak ditemukan");
    const { available, held } = await admins.availableBalance(tx, v.adminId);
    if (v.amountIdr > available) throw new Error(`nominal melebihi saldo tersedia (${available}${held ? `, tertahan ${held}` : ""})`);
    const p = await payouts.create(tx, { adminId: v.adminId, amountIdr: v.amountIdr, kind: "adhoc", method: v.method, reference: v.reference, note: v.note, createdBy: actorUserId });
    await ledger.add(tx, { adminId: v.adminId, type: "payout", amountIdr: -v.amountIdr, payoutId: p.id, createdBy: actorUserId, note: `payout #${p.id}` });
    await audit.log(tx, { actorUserId, action: "payout.create", entity: "payout", entityId: p.id, after: p });
    return p;
  });
}

export async function markPaid(db: Db, id: number, v: { method?: string; reference?: string; proofUrl?: string }, actorUserId: number): Promise<PayoutRow> {
  const before = await payouts.findById(db, id);
  if (!before) throw new Error("payout tidak ditemukan");
  const p = await payouts.markPaid(db, id, v);
  if (!p) throw new Error("payout bukan pending");
  await audit.log(db, { actorUserId, action: "payout.paid", entity: "payout", entityId: id, before, after: p });
  return p;
}

export function cancelPayout(db: Db, id: number, actorUserId: number): Promise<PayoutRow> {
  return withTx(db, async (tx) => {
    const before = await payouts.findById(tx, id);
    if (!before) throw new Error("payout tidak ditemukan");
    const p = await payouts.cancel(tx, id);
    if (!p) throw new Error("payout bukan pending");
    await ledger.add(tx, { adminId: p.admin_id, type: "payout_cancel", amountIdr: p.amount_idr, payoutId: p.id, createdBy: actorUserId, note: `batal payout #${p.id}` });
    await audit.log(tx, { actorUserId, action: "payout.cancel", entity: "payout", entityId: id, before, after: p });
    return p;
  });
}
