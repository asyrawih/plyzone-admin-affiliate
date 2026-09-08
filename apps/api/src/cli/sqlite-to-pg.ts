/**
 * Copy data SQLite (app.db lama) → Postgres (schema baru yang sudah dimigrasi). Sekali jalan, idempoten.
 *
 *   bun run apps/api/src/cli/sqlite-to-pg.ts --source ./data/app.db [--database-url postgres://...] [--dry-run]
 *
 * - Urutan tabel mengikuti FK. Id dipertahankan, sequence disetel ulang di akhir.
 * - Menjalankan migrasi schema Postgres dulu kalau belum ada, lalu tiap tabel di-TRUNCATE (CASCADE): bisa diulang untuk gladi.
 * - Kolom dipetakan by nama lewat json_populate_recordset, jadi Postgres yang mengonversi tipe
 *   (TEXT ISO → timestamptz, INTEGER → bigint, 0/1 → smallint).
 * - Verifikasi di akhir: count per tabel, saldo per admin, sum per status. Exit code 1 kalau ada selisih.
 */
import { Database } from "bun:sqlite";
import { SQL } from "bun";
import { resolve } from "node:path";
import { migrate, openDb } from "@klsm/db";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]!;
  if (a.startsWith("--")) args.set(a.slice(2), process.argv[i + 1]?.startsWith("--") || process.argv[i + 1] === undefined ? "true" : process.argv[++i]!);
}
const sourcePath = args.get("source") ?? process.env.SQLITE_PATH ?? "./data/app.db";
const databaseUrl = args.get("database-url") ?? process.env.DATABASE_URL;
const dryRun = args.get("dry-run") === "true";
if (!databaseUrl) { console.error("DATABASE_URL / --database-url wajib"); process.exit(2); }

/** Urutan FK: parent dulu. */
const TABLES = [
  "users", "maps", "admins", "commission_rates", "spenders", "referral_events", "spend_events", "commission_ledger",
  "payouts", "webhook_inbox", "roblox_user_cache", "audit_log", "sessions", "admin_sessions", "map_products", "risk_flags",
] as const;
const NO_SEQUENCE = new Set(["sessions", "admin_sessions", "roblox_user_cache"]);
const BATCH = 1000;

const sqlite = new Database(resolve(sourcePath), { readonly: true, strict: true });
const pg = new SQL(databaseUrl, { max: 1, bigint: true });

// Schema dulu: Job ini bisa jalan sebelum app versi Postgres pernah start, jadi migrasi tidak boleh diandalkan dari sana.
{
  const mdb = openDb(databaseUrl, { max: 1 });
  const ran = await migrate(mdb);
  console.log(ran.length ? `schema : migrasi dijalankan ${ran.join(", ")}` : "schema : sudah ada");
  await mdb.end();
}

function readAll(table: string): Record<string, unknown>[] {
  return sqlite.query(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
}

function num(v: unknown): number { return typeof v === "bigint" ? Number(v) : Number(v ?? 0); }

async function copyTable(table: string): Promise<number> {
  const rows = readAll(table);
  if (dryRun) return rows.length;
  await pg.unsafe(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`);
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    // Bun.sql menyerialkan array/objek sebagai JSON; kalau dikirim string hasil JSON.stringify, Postgres menerimanya sebagai skalar.
    await pg.unsafe(`INSERT INTO ${table} SELECT * FROM json_populate_recordset(NULL::${table}, $1::json)`, [chunk as unknown as string]);
  }
  if (!NO_SEQUENCE.has(table) && rows.length) {
    await pg.unsafe(`SELECT setval(pg_get_serial_sequence('${table}','id'), (SELECT MAX(id) FROM ${table}))`);
  }
  return rows.length;
}

interface Check { name: string; sqlite: unknown; pg: unknown }
async function verify(): Promise<Check[]> {
  const checks: Check[] = [];
  const cmp = async (name: string, sqliteSql: string, pgSql: string) => {
    const a = sqlite.query(sqliteSql).all() as Record<string, unknown>[];
    const b = (await pg.unsafe(pgSql)) as unknown as Record<string, unknown>[];
    const norm = (rows: Record<string, unknown>[]) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "bigint" || typeof v === "number" ? num(v) : v == null ? null : String(v)])));
    checks.push({ name, sqlite: norm(a), pg: norm(b) });
  };
  for (const t of TABLES) await cmp(`count ${t}`, `SELECT COUNT(*) AS n FROM ${t}`, `SELECT COUNT(*) AS n FROM ${t}`);
  await cmp("saldo per admin",
    "SELECT admin_id, SUM(amount_idr) AS s FROM commission_ledger GROUP BY admin_id ORDER BY admin_id",
    "SELECT admin_id, SUM(amount_idr)::bigint AS s FROM commission_ledger GROUP BY admin_id ORDER BY admin_id");
  await cmp("spend per status",
    "SELECT status, SUM(net_idr) AS n, SUM(commission_idr) AS c, COUNT(*) AS k FROM spend_events GROUP BY status ORDER BY status",
    "SELECT status, SUM(net_idr)::bigint AS n, SUM(commission_idr)::bigint AS c, COUNT(*) AS k FROM spend_events GROUP BY status ORDER BY status");
  await cmp("payout per status",
    "SELECT status, SUM(amount_idr) AS s, COUNT(*) AS k FROM payouts GROUP BY status ORDER BY status",
    "SELECT status, SUM(amount_idr)::bigint AS s, COUNT(*) AS k FROM payouts GROUP BY status ORDER BY status");
  await cmp("max id spend_events", "SELECT MAX(id) AS m FROM spend_events", "SELECT MAX(id) AS m FROM spend_events");
  await cmp("spender referrer", "SELECT COUNT(*) AS n FROM spenders WHERE referrer_admin_id IS NOT NULL", "SELECT COUNT(*) AS n FROM spenders WHERE referrer_admin_id IS NOT NULL");
  return checks;
}

console.log(`sumber : ${resolve(sourcePath)}`);
console.log(`tujuan : ${new URL(databaseUrl).host}${new URL(databaseUrl).pathname}${dryRun ? "  (DRY RUN, tidak menulis)" : ""}`);
const t0 = Date.now();
for (const t of TABLES) {
  const n = await copyTable(t);
  console.log(`  ${t.padEnd(20)} ${String(n).padStart(7)} baris`);
}
console.log(`copy selesai dalam ${((Date.now() - t0) / 1000).toFixed(1)}s`);

if (!dryRun) {
  const checks = await verify();
  let bad = 0;
  for (const c of checks) {
    const ok = JSON.stringify(c.sqlite) === JSON.stringify(c.pg);
    if (!ok) { bad++; console.log(`  ✗ ${c.name}\n      sqlite: ${JSON.stringify(c.sqlite)}\n      pg    : ${JSON.stringify(c.pg)}`); }
    else console.log(`  ✓ ${c.name}`);
  }
  // sequence harus di atas max id
  for (const t of TABLES) {
    if (NO_SEQUENCE.has(t)) continue;
    const r = (await pg.unsafe(`SELECT last_value, (SELECT COALESCE(MAX(id),0) FROM ${t}) AS max_id FROM ${t}_id_seq`)) as unknown as { last_value: bigint; max_id: bigint }[];
    if (r[0] && num(r[0].last_value) < num(r[0].max_id)) { bad++; console.log(`  ✗ sequence ${t}: last_value ${r[0].last_value} < max id ${r[0].max_id}`); }
  }
  console.log(bad ? `VERIFIKASI GAGAL: ${bad} selisih` : "VERIFIKASI OK: semua angka sama");
  await pg.end();
  process.exit(bad ? 1 : 0);
}
await pg.end();
