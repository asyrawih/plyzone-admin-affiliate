import { SQL } from "bun";

/**
 * Koneksi Postgres lewat Bun.sql (bawaan Bun, tanpa dependency).
 * `Db` dipakai untuk pool maupun transaksi: `withTx(db, tx => ...)` memberi `tx` yang bentuknya sama,
 * jadi setiap fungsi repo cukup menerima `Db` sebagai argumen pertama seperti sebelumnya.
 */
export type Db = SQL;

export interface DbOptions {
  /** Ukuran pool per proses. Default 10. */
  max?: number;
}

export function openDb(url: string, opts: DbOptions = {}): Db {
  return new SQL(url, {
    max: opts.max ?? 10,
    // int8 (COUNT, SUM(int), BIGSERIAL) → BigInt, lalu dinormalkan ke number di bawah. Tanpa ini datang sebagai string.
    bigint: true,
    idleTimeout: 60,
    connectionTimeout: 10,
  });
}

/** Tunggu Postgres siap (dipakai saat start pod: Postgres bisa naik belakangan setelah reboot node). */
export async function waitForDb(db: Db, opts: { attempts?: number; delayMs?: number; log?: (m: string) => void } = {}): Promise<void> {
  const attempts = opts.attempts ?? 30, delayMs = opts.delayMs ?? 2000;
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try { await db.unsafe("select 1"); return; } catch (e) { lastErr = e; }
    opts.log?.(`[db] postgres belum siap (percobaan ${i}/${attempts}): ${(lastErr as Error)?.message ?? lastErr}`);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw lastErr;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** `?` → `$1..$n`. SQL di repo tidak memakai `?` di dalam literal, jadi penggantian polos aman. */
export function toPg(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

/** BigInt → number, Date → ISO string (format sama persis dengan yang dulu disimpan SQLite), undefined → null. */
export function normalizeRow<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === "bigint" ? Number(v) : v instanceof Date ? v.toISOString() : v === undefined ? null : v;
  }
  return out as T;
}

const bind = (params: unknown[]) => params.map((p) => (p === undefined ? null : typeof p === "bigint" ? Number(p) : p));

export async function all<T = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const rows = (await db.unsafe(toPg(sql), bind(params) as any[])) as unknown as Record<string, unknown>[];
  return rows.map((r) => normalizeRow<T>(r));
}

export async function one<T = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await all<T>(db, sql, params);
  return rows[0] ?? null;
}

export async function run(db: Db, sql: string, params: unknown[] = []): Promise<void> {
  await db.unsafe(toPg(sql), bind(params) as any[]);
}

/** Nilai skalar kolom pertama baris pertama (COUNT, SUM, dll), sudah dinormalkan ke number. */
export async function scalar<T = number>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const row = await one<Record<string, T>>(db, sql, params);
  return (row ? (Object.values(row)[0] as T) : null) as T;
}

/**
 * Transaksi. `fn` menerima koneksi transaksi yang bentuknya sama dengan `Db`; semua repo di dalamnya
 * harus dipanggil dengan `tx`, bukan `db` pool, supaya benar-benar satu transaksi.
 */
export async function withTx<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.begin((tx) => fn(tx as unknown as Db)) as Promise<T>;
}
