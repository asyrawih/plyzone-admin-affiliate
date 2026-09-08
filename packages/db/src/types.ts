export interface UserRow { id: number; username: string; password_hash: string; created_at: string }
export interface SessionRow { id: string; user_id: number; expires_at: string; created_at: string }
export interface MapRow {
  id: number; name: string; universe_id: number | null; place_id: number | null;
  ingest_key_hash: string; is_active: number; created_at: string;
}
export type AdminStatus = "pending" | "active" | "inactive";
export interface AdminRow {
  id: number; display_name: string; username: string | null; password_hash: string | null;
  roblox_user_id: number | null; roblox_username: string | null;
  referral_code: string; public_token: string; status: AdminStatus; notes: string | null;
  approved_at: string | null; created_at: string; updated_at: string;
  /** Kode otomatis lama setelah admin memilih kodenya sendiri; tetap valid sebagai alias. */
  referral_code_prev: string | null;
  /** Terisi = kode sudah dipilih admin dan terkunci. */
  referral_code_set_at: string | null;
}
export interface AdminSessionRow { id: string; admin_id: number; expires_at: string; created_at: string }
export interface RateRow {
  id: number; commission_bps: number; roblox_fee_bps: number; idr_per_robux: number;
  min_payout_idr: number; effective_from: string; created_by: number | null; created_at: string;
  /** Masa tahan komisi sebelum bisa dibayar (jam). */
  hold_hours: number;
  /** >0: laporan bagi-bagi dari game masuk review sampai ada webhook proxy yang cocok dalam sekian jam. 0 = mati. */
  bagibagi_confirm_hours: number;
}
export interface MapProductRow {
  id: number; map_id: number; product_id: number; name: string | null; price_robux: number;
  is_active: number; locked: number; source: "owner" | "game"; created_at: string; updated_at: string;
}
export type RiskSeverity = "low" | "medium" | "high";
export type RiskStatus = "open" | "dismissed" | "confirmed";
export interface RiskFlagRow {
  id: number; kind: string; severity: RiskSeverity; status: RiskStatus;
  admin_id: number | null; map_id: number | null; spender_id: number | null; spend_event_id: number | null;
  title: string; details: string | null; note: string | null; resolved_by: number | null; resolved_at: string | null; created_at: string;
}
export interface SpenderRow {
  id: number; roblox_user_id: number; roblox_username: string | null;
  referrer_admin_id: number | null; referred_at: string | null; referred_map_id: number | null;
  first_seen_at: string; last_seen_at: string;
}
export type ReferralOutcome = "attributed" | "already_referred" | "self_referral" | "unknown_code" | "no_code" | "inactive_admin";
export interface ReferralEventRow {
  id: number; spender_id: number; map_id: number | null; admin_id: number | null;
  referral_code_raw: string | null; outcome: ReferralOutcome; joined_at: string; created_at: string;
  /** UserId pengundang kalau lewat undangan Roblox (ReferredByPlayerId), null kalau lewat link. */
  inviter_roblox_user_id: number | null;
}
export type SpendSource = "robux" | "bagibagi";
/** review = ditahan aturan risiko, belum ada ledger sampai owner menyetujui. */
export type SpendStatus = "attributed" | "unattributed" | "unmatched" | "void" | "review";
export interface SpendEventRow {
  id: number; source: SpendSource; external_id: string; map_id: number | null;
  spender_id: number | null; admin_id: number | null; occurred_at: string;
  gross_amount: number; gross_currency: "ROBUX" | "IDR"; roblox_fee_bps: number;
  net_robux: number | null; idr_per_robux: number | null; net_idr: number;
  commission_bps: number; commission_idr: number; rate_id: number | null;
  status: SpendStatus; matched_by: "auto" | "manual" | null;
  void_reason: string | null; voided_at: string | null; review_reason: string | null;
  donor_name: string | null; message: string | null; product_id: number | null;
  raw_payload: string | null; created_at: string;
}
export type LedgerType = "earn" | "reversal" | "payout" | "payout_cancel" | "adjustment";
export interface LedgerRow {
  id: number; admin_id: number; type: LedgerType; amount_idr: number;
  spend_event_id: number | null; payout_id: number | null; note: string | null;
  created_by: number | null; created_at: string;
  /** null = langsung tersedia; kalau diisi, baru dihitung ke saldo tersedia setelah waktu ini. */
  available_at: string | null;
}
export type PayoutStatus = "pending" | "paid" | "cancelled";
export interface PayoutRow {
  id: number; admin_id: number; amount_idr: number; kind: "monthly" | "adhoc";
  period_start: string | null; period_end: string | null; status: PayoutStatus;
  method: string | null; reference: string | null; proof_url: string | null; note: string | null;
  created_by: number | null; created_at: string; paid_at: string | null; cancelled_at: string | null;
}
export interface InboxRow {
  id: number; source: string; received_at: string; headers: string | null; body: string | null;
  auth_ok: number; status: "ok" | "rejected" | "error" | "duplicate" | "invalid"; error: string | null;
  spend_event_id: number | null;
}
export interface AuditRow {
  id: number; actor_user_id: number | null; action: string; entity: string; entity_id: string | null;
  before: string | null; after: string | null; created_at: string;
}
