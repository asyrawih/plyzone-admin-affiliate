import { isAbsolute, resolve } from "node:path";

/** Root repo (apps/api/src -> ../../..). Path relatif di env di-resolve ke sini, bukan ke cwd. */
export const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");
const env = (k: string, d?: string) => process.env[k] ?? d;
const path = (k: string, d: string) => { const v = env(k, d)!; return isAbsolute(v) ? v : resolve(REPO_ROOT, v); };

export const config = {
  port: Number(env("PORT", "3000")),
  appUrl: env("APP_URL", "http://localhost:3000")!,
  dashboardOrigin: env("DASHBOARD_ORIGIN", "http://localhost:5173")!,
  /** Postgres, dipakai transaksional (Bun.sql) dan analitik (DuckDB ATTACH, read-only). */
  databaseUrl: env("DATABASE_URL", "postgres://klsm:klsm@localhost:5433/klsm")!,
  /** Ukuran pool Bun.sql per proses. DuckDB memakai koneksi sendiri di luar pool ini (±3). */
  dbPoolMax: Number(env("DB_POOL_MAX", "10")),
  /** Folder ekstensi DuckDB (di image sudah berisi `postgres`). Kosong = default DuckDB. */
  duckdbExtensionDir: env("DUCKDB_EXTENSION_DIR", "") || undefined,
  sessionSecure: env("SESSION_SECURE", "false") === "true",
  sessionTtlHours: Number(env("SESSION_TTL_HOURS", "168")),
  webhookSharedSecret: env("WEBHOOK_SHARED_SECRET", "") || null,
  webhookHmacSecret: env("WEBHOOK_HMAC_SECRET", "") || null,
  tz: env("TZ_BUCKET", "Asia/Jakarta")!,
  robloxUsersApi: env("ROBLOX_USERS_API", "https://users.roblox.com")!,
  publicRateLimit: Number(env("PUBLIC_RATE_LIMIT", "60")),
  /** Kalau diisi, API juga menyajikan dashboard (build Vite) dari folder ini. Produksi: satu container. */
  staticDir: env("STATIC_DIR", "") ? path("STATIC_DIR", "") : null,
};
export type Config = typeof config;
