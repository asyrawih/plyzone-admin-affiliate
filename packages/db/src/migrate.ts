import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { all, run, withTx, type Db } from "./connection";

const MIGRATIONS_DIR = join(import.meta.dir, "..", "migrations-pg");

/**
 * Jalankan migrasi SQL yang belum diterapkan, urut nama file. Tiap file satu transaksi
 * (DDL Postgres transaksional, jadi gagal di tengah = tidak ada yang berubah).
 * Aman dipanggil oleh dua pod bersamaan: lock advisory memastikan hanya satu yang jalan.
 */
export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  await run(db, `CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  return withTx(db, async (tx) => {
    await run(tx, "SELECT pg_advisory_xact_lock(7241001)");
    const applied = new Set((await all<{ name: string }>(tx, "SELECT name FROM _migrations")).map((r) => r.name));
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const ran: string[] = [];
    for (const f of files) {
      if (applied.has(f)) continue;
      await tx.unsafe(readFileSync(join(dir, f), "utf8"));
      await run(tx, "INSERT INTO _migrations(name) VALUES (?)", [f]);
      ran.push(f);
    }
    return ran;
  });
}
