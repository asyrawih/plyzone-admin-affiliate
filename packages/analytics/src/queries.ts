import type { Analytics, Row } from "./connection";

export interface Range { from?: string; to?: string }
export type Granularity = "day" | "week" | "month";

function rangeClause(r: Range, col = "occurred_at", params: unknown[] = []): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  if (r.from) { parts.push(`${col} >= CAST(? AS TIMESTAMPTZ)`); params.push(r.from); }
  if (r.to) { parts.push(`${col} < CAST(? AS TIMESTAMPTZ)`); params.push(r.to); }
  return { sql: parts.length ? " AND " + parts.join(" AND ") : "", params };
}

export interface Scope { adminId?: number; mapId?: number }
/** Klausa " AND admin_id = ? AND map_id = ?" + params, dipakai bersama rangeClause. Kolom bisa diganti untuk view lain. */
function scopeClause(sc: Scope, cols: { admin?: string; map?: string } = {}): { sql: string; params: unknown[] } {
  const parts: string[] = []; const params: unknown[] = [];
  if (sc.adminId) { parts.push(`${cols.admin ?? "admin_id"} = ?`); params.push(sc.adminId); }
  if (sc.mapId) { parts.push(`${cols.map ?? "map_id"} = ?`); params.push(sc.mapId); }
  return { sql: parts.length ? " AND " + parts.join(" AND ") : "", params };
}
function withRange(sc: { sql: string; params: unknown[] }, r: Range, col: string) {
  const rc = rangeClause(r, col, [...sc.params]);
  return { sql: sc.sql + rc.sql, params: rc.params };
}

function bucketExpr(g: Granularity): string {
  switch (g) {
    case "day": return "local_day";
    case "week": return "strftime(date_trunc('week', occurred_local), '%Y-%m-%d')";
    case "month": return "local_month";
  }
}

export interface Overview extends Row {
  events: number; gross_robux: number; net_idr: number; commission_idr: number;
  active_spenders: number; new_referrals: number; unmatched_count: number; unmatched_idr: number;
  outstanding_balance_idr: number; pending_payout_idr: number;
}

export async function overview(a: Analytics, r: Range, adminId?: number, mapId?: number): Promise<Overview> {
  const sc: Scope = { adminId, mapId };
  const p1 = withRange(scopeClause(sc), r, "occurred_at");
  const p2 = withRange(scopeClause(sc, { admin: "referrer_admin_id", map: "referred_map_id" }), r, "referred_ts");
  const p3 = withRange(scopeClause({ mapId }), r, "occurred_at");
  // Empat query independen, jalan paralel di thread DuckDB.
  const [spend, refs, unmatched, bal] = await Promise.all([a.one(`
    SELECT COUNT(*) AS events,
      COALESCE(SUM(CASE WHEN gross_currency = 'ROBUX' THEN gross_amount END)::DOUBLE, 0) AS gross_robux,
      COALESCE(SUM(net_idr)::DOUBLE, 0) AS net_idr,
      COALESCE(SUM(commission_idr)::DOUBLE, 0) AS commission_idr,
      COUNT(DISTINCT spender_id) AS active_spenders
    FROM v_spend WHERE status = 'attributed'${p1.sql}`, p1.params),
  a.one(`SELECT COUNT(*) AS n FROM v_spender WHERE referrer_admin_id IS NOT NULL${p2.sql}`, p2.params),
  adminId ? Promise.resolve({ n: 0, idr: 0 } as Row) : a.one(`SELECT COUNT(*) AS n, COALESCE(SUM(net_idr)::DOUBLE,0) AS idr FROM v_spend WHERE status = 'unmatched'${p3.sql}`, p3.params),
  a.one(`
    SELECT COALESCE((SELECT SUM(amount_idr)::DOUBLE FROM app.commission_ledger${adminId ? " WHERE admin_id = ?" : ""}), 0) AS balance,
           COALESCE((SELECT SUM(amount_idr)::DOUBLE FROM app.payouts WHERE status = 'pending'${adminId ? " AND admin_id = ?" : ""}), 0) AS pending`,
    adminId ? [adminId, adminId] : []),
  ]);
  return {
    events: Number(spend?.events ?? 0), gross_robux: Number(spend?.gross_robux ?? 0), net_idr: Number(spend?.net_idr ?? 0),
    commission_idr: Number(spend?.commission_idr ?? 0), active_spenders: Number(spend?.active_spenders ?? 0),
    new_referrals: Number(refs?.n ?? 0), unmatched_count: Number(unmatched?.n ?? 0), unmatched_idr: Number(unmatched?.idr ?? 0),
    outstanding_balance_idr: Number(bal?.balance ?? 0), pending_payout_idr: Number(bal?.pending ?? 0),
  };
}

export async function timeseries(a: Analytics, r: Range, g: Granularity, adminId?: number, mapId?: number) {
  const p = withRange(scopeClause({ adminId, mapId }), r, "occurred_at");
  return a.query(`
    SELECT ${bucketExpr(g)} AS bucket,
      COUNT(*) AS events,
      COALESCE(SUM(net_idr)::DOUBLE, 0) AS net_idr,
      COALESCE(SUM(commission_idr)::DOUBLE, 0) AS commission_idr,
      COALESCE(SUM(CASE WHEN source = 'robux' THEN net_idr END)::DOUBLE, 0) AS robux_net_idr,
      COALESCE(SUM(CASE WHEN source = 'bagibagi' THEN net_idr END)::DOUBLE, 0) AS bagibagi_net_idr,
      COUNT(DISTINCT spender_id) AS spenders
    FROM v_spend WHERE status = 'attributed'${p.sql}
    GROUP BY 1 ORDER BY 1`, p.params);
}

export async function leaderboard(a: Analytics, r: Range, limit = 20, mapId?: number) {
  const p = withRange(scopeClause({ mapId }, { map: "e.map_id" }), r, "e.occurred_at");
  const p2 = withRange(scopeClause({ mapId }, { map: "s.referred_map_id" }), r, "s.referred_ts");
  return a.query(`
    SELECT ad.id AS admin_id, ad.display_name, ad.referral_code, ad.status,
      COALESCE(x.events, 0) AS events, COALESCE(x.net_idr, 0) AS net_idr, COALESCE(x.commission_idr, 0) AS commission_idr,
      COALESCE(x.spenders, 0) AS spenders, COALESCE(y.referrals, 0) AS referrals
    FROM app.admins ad
    LEFT JOIN (
      SELECT e.admin_id, COUNT(*) AS events, SUM(e.net_idr)::DOUBLE AS net_idr, SUM(e.commission_idr)::DOUBLE AS commission_idr,
             COUNT(DISTINCT e.spender_id) AS spenders
      FROM v_spend e WHERE e.status = 'attributed'${p.sql} GROUP BY e.admin_id
    ) x ON x.admin_id = ad.id
    LEFT JOIN (
      SELECT s.referrer_admin_id AS admin_id, COUNT(*) AS referrals FROM v_spender s WHERE s.referrer_admin_id IS NOT NULL${p2.sql} GROUP BY 1
    ) y ON y.admin_id = ad.id
    ORDER BY commission_idr DESC, referrals DESC LIMIT ?`, [...p.params, ...p2.params, limit]);
}

export async function adminsSummary(a: Analytics) {
  return a.query(`SELECT * FROM v_admin_summary ORDER BY commission_idr DESC`);
}

export async function adminSummary(a: Analytics, adminId: number) {
  return a.one(`SELECT * FROM v_admin_summary WHERE admin_id = ?`, [adminId]);
}

export async function adminMonthly(a: Analytics, adminId: number, months = 12) {
  return a.query(`
    SELECT local_month AS month, COUNT(*) AS events, SUM(net_idr)::DOUBLE AS net_idr, SUM(commission_idr)::DOUBLE AS commission_idr,
           COUNT(DISTINCT spender_id) AS spenders
    FROM v_spend WHERE status = 'attributed' AND admin_id = ?
    GROUP BY 1 ORDER BY 1 DESC LIMIT ?`, [adminId, months]);
}

export async function sourceMix(a: Analytics, r: Range, adminId?: number, mapId?: number) {
  const p = withRange(scopeClause({ adminId, mapId }), r, "occurred_at");
  return a.query(`
    SELECT source, COUNT(*) AS events, SUM(gross_amount)::DOUBLE AS gross_amount, SUM(net_idr)::DOUBLE AS net_idr, SUM(commission_idr)::DOUBLE AS commission_idr
    FROM v_spend WHERE status = 'attributed'${p.sql} GROUP BY 1 ORDER BY 1`, p.params);
}

/** Ringkasan per map: event, net, komisi, spender, referral, dan event yang ditahan review. */
export async function perMap(a: Analytics, r: Range, adminId?: number) {
  const p = withRange(scopeClause({ adminId }), r, "occurred_at");
  const p2 = withRange(scopeClause({ adminId }, { admin: "referrer_admin_id" }), r, "referred_ts");
  return a.query(`
    SELECT m.id AS map_id, m.name AS map_name, m.is_active,
      COALESCE(x.events, 0) AS events, COALESCE(x.net_idr, 0) AS net_idr, COALESCE(x.commission_idr, 0) AS commission_idr,
      COALESCE(x.spenders, 0) AS spenders, COALESCE(y.referrals, 0) AS referrals, COALESCE(z.review, 0) AS review
    FROM app.maps m
    LEFT JOIN (
      SELECT map_id, COUNT(*) AS events, SUM(net_idr)::DOUBLE AS net_idr, SUM(commission_idr)::DOUBLE AS commission_idr, COUNT(DISTINCT spender_id) AS spenders
      FROM v_spend WHERE status = 'attributed'${p.sql} GROUP BY map_id
    ) x ON x.map_id = m.id
    LEFT JOIN (
      SELECT referred_map_id AS map_id, COUNT(*) AS referrals FROM v_spender WHERE referrer_admin_id IS NOT NULL${p2.sql} GROUP BY 1
    ) y ON y.map_id = m.id
    LEFT JOIN (SELECT map_id, COUNT(*) AS review FROM app.spend_events WHERE status = 'review' GROUP BY map_id) z ON z.map_id = m.id
    ORDER BY net_idr DESC, m.id`, [...p.params, ...p2.params]);
}

/** Funnel: join bawa kode -> spender ter-atribusi -> spender yang spend. */
export async function funnel(a: Analytics, r: Range, mapId?: number) {
  const p = withRange(scopeClause({ mapId }), r, "joined_at");
  const joins = await a.one(`
    SELECT COUNT(*) AS joins_with_code,
      SUM(CASE WHEN outcome = 'attributed' THEN 1 ELSE 0 END) AS attributed,
      SUM(CASE WHEN outcome = 'already_referred' THEN 1 ELSE 0 END) AS already_referred,
      SUM(CASE WHEN outcome = 'unknown_code' THEN 1 ELSE 0 END) AS unknown_code,
      SUM(CASE WHEN outcome = 'self_referral' THEN 1 ELSE 0 END) AS self_referral
    FROM app.referral_events WHERE outcome != 'no_code'${p.sql}`, p.params);
  const p2 = withRange(scopeClause({ mapId }, { map: "referred_map_id" }), r, "referred_ts");
  const conv = await a.one(`
    SELECT COUNT(*) AS referred,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM app.spend_events e WHERE e.spender_id = s.id AND e.status = 'attributed')) AS converted
    FROM v_spender s WHERE s.referrer_admin_id IS NOT NULL${p2.sql}`, p2.params);
  const referred = Number(conv?.referred ?? 0), converted = Number(conv?.converted ?? 0);
  return { ...joins, referred, converted, conversion_rate: referred ? converted / referred : 0 };
}

export async function topSpenders(a: Analytics, r: Range, adminId?: number, limit = 20, mapId?: number) {
  const p = withRange(scopeClause({ adminId, mapId }), r, "occurred_at");
  return a.query(`
    SELECT spender_id, spender_username, spender_roblox_user_id, admin_id, admin_name,
      COUNT(*) AS events, SUM(net_idr)::DOUBLE AS net_idr, SUM(commission_idr)::DOUBLE AS commission_idr, MAX(occurred_at) AS last_spend_at
    FROM v_spend WHERE status IN ('attributed','unattributed') AND spender_id IS NOT NULL${p.sql}
    GROUP BY ALL ORDER BY net_idr DESC LIMIT ?`, [...p.params, limit]);
}

/** Cohort: spender per bulan referral, dan net spend mereka per bulan sejak referral. */
export async function referralCohort(a: Analytics, months = 6) {
  return a.query(`
    WITH c AS (
      SELECT s.id, s.referred_month FROM v_spender s WHERE s.referrer_admin_id IS NOT NULL AND s.referred_month IS NOT NULL
    )
    SELECT c.referred_month AS cohort, COUNT(DISTINCT c.id) AS size,
      COUNT(DISTINCT e.spender_id) AS converted,
      COALESCE(SUM(e.net_idr)::DOUBLE, 0) AS net_idr
    FROM c LEFT JOIN v_spend e ON e.spender_id = c.id AND e.status = 'attributed'
    GROUP BY 1 ORDER BY 1 DESC LIMIT ?`, [months]);
}

export async function exportSpendRows(a: Analytics, r: Range, adminId?: number, mapId?: number) {
  const p = withRange(scopeClause({ adminId, mapId }), r, "occurred_at");
  return a.query(`
    SELECT id, occurred_at, local_day, source, status, external_id, map_name, admin_name, spender_username, spender_roblox_user_id,
      gross_amount, gross_currency, net_robux, idr_per_robux, net_idr, commission_bps, commission_idr
    FROM v_spend WHERE 1=1${p.sql} ORDER BY occurred_at`, p.params);
}
