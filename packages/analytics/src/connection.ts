import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";

export interface AnalyticsOptions {
  /** URL Postgres yang sama dengan `packages/db`. DuckDB membacanya lewat ekstensi `postgres`, READ_ONLY. */
  databaseUrl: string;
  /** IANA tz untuk bucketing hari/bulan, default Asia/Jakarta */
  tz?: string;
  /**
   * Folder ekstensi DuckDB. Di image produksi ekstensi `postgres` sudah di-INSTALL saat build ke folder ini
   * (lihat Dockerfile), jadi start pod tidak mengunduh apa pun. Kosong = default DuckDB (~/.duckdb).
   */
  extensionDir?: string;
}

/**
 * DuckDB in-memory per proses, ATTACH ke Postgres lewat jaringan.
 * Tidak ada file yang dibagi dengan library lain (dulu: bun:sqlite + sqlite DuckDB di file yang sama → SIGBUS),
 * tidak ada snapshot, angka selalu live. Setiap pod punya instance sendiri; tidak ada state yang dibagi.
 */
export type Row = Record<string, unknown>;

function normalize(v: unknown): unknown {
  if (typeof v === "bigint") return Number(v);
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && v !== null && typeof (v as { toString?: unknown }).toString === "function" && !(v instanceof Date)) {
    return (v as { toString(): string }).toString();
  }
  return v;
}

function sqlLit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export class Analytics {
  private constructor(
    private readonly instance: DuckDBInstance,
    private readonly conn: DuckDBConnection,
    readonly tz: string,
  ) {}

  static async open(opts: AnalyticsOptions): Promise<Analytics> {
    const tz = opts.tz ?? "Asia/Jakarta";
    const extDir = opts.extensionDir || process.env.DUCKDB_EXTENSION_DIR || "";
    const instance = await DuckDBInstance.create(":memory:", extDir ? { extension_directory: extDir } : {});
    const conn = await instance.connect();
    if (extDir) await conn.run(`SET extension_directory = ${sqlLit(extDir)}`);
    // LOAD dulu (ekstensi sudah ada di image, dipasang packages/analytics/scripts/install-ext.ts saat build);
    // INSTALL hanya kalau belum ada (dev/test, butuh internet sekali).
    try { await conn.run("LOAD postgres"); } catch { await conn.run("INSTALL postgres; LOAD postgres;"); }
    await conn.run(`SET TimeZone = ${sqlLit(tz)}`);
    await conn.run(`ATTACH ${sqlLit(opts.databaseUrl)} AS app (TYPE postgres, READ_ONLY)`);
    const a = new Analytics(instance, conn, tz);
    await a.createViews();
    return a;
  }

  async query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const stmt = await this.conn.prepare(sql);
    if (params.length) stmt.bind(params as any);
    const result = await stmt.runAndReadAll();
    return result.getRowObjects().map((r) => {
      const out: Row = {};
      for (const [k, v] of Object.entries(r)) out[k] = normalize(v);
      return out as T;
    });
  }

  async one<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async close() {
    this.conn.closeSync();
    this.instance.closeSync();
  }

  private async createViews() {
    const tz = sqlLit(this.tz);
    // Kolom waktu sudah TIMESTAMPTZ di Postgres; timezone() DuckDB menggeser ke jam lokal (Jakarta) untuk bucketing.
    await this.conn.run(`
      CREATE OR REPLACE VIEW v_spend AS
      SELECT
        e.id, e.source, e.external_id, e.map_id, e.spender_id, e.admin_id, e.status, e.matched_by,
        e.occurred_at,
        timezone(${tz}, e.occurred_at) AS occurred_local,
        strftime(timezone(${tz}, e.occurred_at), '%Y-%m-%d') AS local_day,
        strftime(timezone(${tz}, e.occurred_at), '%Y-%m') AS local_month,
        e.gross_amount, e.gross_currency, e.roblox_fee_bps, e.net_robux, e.idr_per_robux, e.net_idr,
        e.commission_bps, e.commission_idr, e.donor_name, e.message, e.product_id,
        s.roblox_username AS spender_username, s.roblox_user_id AS spender_roblox_user_id,
        a.display_name AS admin_name, m.name AS map_name
      FROM app.spend_events e
      LEFT JOIN app.spenders s ON s.id = e.spender_id
      LEFT JOIN app.admins a ON a.id = e.admin_id
      LEFT JOIN app.maps m ON m.id = e.map_id
    `);
    await this.conn.run(`
      CREATE OR REPLACE VIEW v_spender AS
      SELECT s.*, s.referred_at AS referred_ts,
        strftime(timezone(${tz}, s.referred_at), '%Y-%m') AS referred_month,
        a.display_name AS referrer_name
      FROM app.spenders s LEFT JOIN app.admins a ON a.id = s.referrer_admin_id
    `);
    await this.conn.run(`
      CREATE OR REPLACE VIEW v_ledger AS
      SELECT l.*, l.created_at AS created_ts FROM app.commission_ledger l
    `);
    await this.conn.run(`
      CREATE OR REPLACE VIEW v_admin_summary AS
      SELECT
        a.id AS admin_id, a.display_name, a.referral_code, a.status,
        (SELECT COUNT(*) FROM app.spenders s WHERE s.referrer_admin_id = a.id) AS referrals,
        (SELECT COUNT(DISTINCT e.spender_id) FROM app.spend_events e WHERE e.admin_id = a.id AND e.status = 'attributed') AS spenders_with_spend,
        COALESCE((SELECT SUM(e.net_idr)::DOUBLE FROM app.spend_events e WHERE e.admin_id = a.id AND e.status = 'attributed'), 0) AS net_idr,
        COALESCE((SELECT SUM(e.commission_idr)::DOUBLE FROM app.spend_events e WHERE e.admin_id = a.id AND e.status = 'attributed'), 0) AS commission_idr,
        COALESCE((SELECT SUM(p.amount_idr)::DOUBLE FROM app.payouts p WHERE p.admin_id = a.id AND p.status = 'paid'), 0) AS paid_idr,
        COALESCE((SELECT SUM(p.amount_idr)::DOUBLE FROM app.payouts p WHERE p.admin_id = a.id AND p.status = 'pending'), 0) AS pending_idr,
        COALESCE((SELECT SUM(l.amount_idr)::DOUBLE FROM app.commission_ledger l WHERE l.admin_id = a.id), 0) AS balance_idr,
        (SELECT MAX(e.occurred_at) FROM app.spend_events e WHERE e.admin_id = a.id AND e.status = 'attributed') AS last_spend_at
      FROM app.admins a
    `);
  }
}
