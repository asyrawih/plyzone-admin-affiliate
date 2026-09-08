-- Schema Postgres, gabungan migrasi SQLite 0001–0003. Data dipindah lewat scripts/sqlite-to-pg.ts.
-- Konvensi (sengaja sama dengan versi SQLite supaya API & dashboard tidak berubah):
--  * uang integer: IDR rupiah bulat, Robux bulat, persen basis point (1000 = 10%)
--  * flag 0/1 tetap SMALLINT, kolom JSON tetap TEXT
--  * waktu TIMESTAMPTZ (keluar ke API sebagai ISO UTC, sama seperti dulu)
--  * id BIGSERIAL; id lama dipertahankan saat copy, sequence disetel ulang oleh script copy

CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE maps (
  id              BIGSERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  universe_id     BIGINT,
  place_id        BIGINT,
  ingest_key_hash TEXT NOT NULL UNIQUE,
  is_active       SMALLINT NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admins (
  id              BIGSERIAL PRIMARY KEY,
  display_name    TEXT NOT NULL,
  username        TEXT,
  password_hash   TEXT,
  roblox_user_id  BIGINT,
  roblox_username TEXT,
  referral_code   TEXT NOT NULL UNIQUE,
  public_token    TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','inactive')),
  notes           TEXT,
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- username tidak peka huruf besar-kecil (pengganti COLLATE NOCASE), termasuk keunikannya
CREATE UNIQUE INDEX idx_admins_username_lower ON admins (lower(username)) WHERE username IS NOT NULL;
CREATE INDEX idx_admins_roblox_user ON admins(roblox_user_id);
CREATE INDEX idx_admins_status ON admins(status);

CREATE TABLE admin_sessions (
  id         TEXT PRIMARY KEY,
  admin_id   BIGINT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_admin_sessions_expires ON admin_sessions(expires_at);

CREATE TABLE commission_rates (
  id                     BIGSERIAL PRIMARY KEY,
  commission_bps         INTEGER NOT NULL CHECK (commission_bps BETWEEN 0 AND 10000),
  roblox_fee_bps         INTEGER NOT NULL DEFAULT 3000 CHECK (roblox_fee_bps BETWEEN 0 AND 10000),
  idr_per_robux          BIGINT NOT NULL CHECK (idr_per_robux >= 0),
  min_payout_idr         BIGINT NOT NULL DEFAULT 0,
  effective_from         TIMESTAMPTZ NOT NULL,
  created_by             BIGINT REFERENCES users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  hold_hours             INTEGER NOT NULL DEFAULT 72,
  bagibagi_confirm_hours INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_rates_effective ON commission_rates(effective_from);

CREATE TABLE spenders (
  id                BIGSERIAL PRIMARY KEY,
  roblox_user_id    BIGINT NOT NULL UNIQUE,
  roblox_username   TEXT,
  referrer_admin_id BIGINT REFERENCES admins(id),
  referred_at       TIMESTAMPTZ,
  referred_map_id   BIGINT REFERENCES maps(id),
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_spenders_referrer ON spenders(referrer_admin_id);
CREATE INDEX idx_spenders_username_lower ON spenders (lower(roblox_username));

CREATE TABLE referral_events (
  id                BIGSERIAL PRIMARY KEY,
  spender_id        BIGINT NOT NULL REFERENCES spenders(id),
  map_id            BIGINT REFERENCES maps(id),
  admin_id          BIGINT REFERENCES admins(id),
  referral_code_raw TEXT,
  outcome           TEXT NOT NULL CHECK (outcome IN ('attributed','already_referred','self_referral','unknown_code','no_code','inactive_admin')),
  joined_at         TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_referral_events_spender ON referral_events(spender_id);
CREATE INDEX idx_referral_events_admin ON referral_events(admin_id, joined_at);
CREATE INDEX idx_referral_map ON referral_events(map_id, joined_at);

CREATE TABLE spend_events (
  id             BIGSERIAL PRIMARY KEY,
  source         TEXT NOT NULL CHECK (source IN ('robux','bagibagi')),
  external_id    TEXT NOT NULL,
  map_id         BIGINT REFERENCES maps(id),
  spender_id     BIGINT REFERENCES spenders(id),
  admin_id       BIGINT REFERENCES admins(id),
  occurred_at    TIMESTAMPTZ NOT NULL,
  gross_amount   BIGINT NOT NULL CHECK (gross_amount >= 0),
  gross_currency TEXT NOT NULL CHECK (gross_currency IN ('ROBUX','IDR')),
  roblox_fee_bps INTEGER NOT NULL DEFAULT 0,
  net_robux      BIGINT,
  idr_per_robux  BIGINT,
  net_idr        BIGINT NOT NULL,
  commission_bps INTEGER NOT NULL,
  commission_idr BIGINT NOT NULL,
  rate_id        BIGINT REFERENCES commission_rates(id),
  status         TEXT NOT NULL CHECK (status IN ('attributed','unattributed','unmatched','void','review')),
  matched_by     TEXT CHECK (matched_by IN ('auto','manual')),
  void_reason    TEXT,
  voided_at      TIMESTAMPTZ,
  review_reason  TEXT,
  donor_name     TEXT,
  message        TEXT,
  product_id     BIGINT,
  raw_payload    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);
CREATE INDEX idx_spend_admin_time ON spend_events(admin_id, occurred_at);
CREATE INDEX idx_spend_spender ON spend_events(spender_id);
CREATE INDEX idx_spend_status ON spend_events(status);
CREATE INDEX idx_spend_time ON spend_events(occurred_at);
CREATE INDEX idx_spend_map_time ON spend_events(map_id, occurred_at);

CREATE TABLE commission_ledger (
  id             BIGSERIAL PRIMARY KEY,
  admin_id       BIGINT NOT NULL REFERENCES admins(id),
  type           TEXT NOT NULL CHECK (type IN ('earn','reversal','payout','payout_cancel','adjustment')),
  amount_idr     BIGINT NOT NULL,
  spend_event_id BIGINT REFERENCES spend_events(id),
  payout_id      BIGINT,
  note           TEXT,
  created_by     BIGINT REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  available_at   TIMESTAMPTZ
);
CREATE INDEX idx_ledger_admin ON commission_ledger(admin_id, created_at);
CREATE INDEX idx_ledger_spend ON commission_ledger(spend_event_id);
CREATE INDEX idx_ledger_available ON commission_ledger(admin_id, available_at);

CREATE TABLE payouts (
  id           BIGSERIAL PRIMARY KEY,
  admin_id     BIGINT NOT NULL REFERENCES admins(id),
  amount_idr   BIGINT NOT NULL CHECK (amount_idr > 0),
  kind         TEXT NOT NULL CHECK (kind IN ('monthly','adhoc')),
  period_start TIMESTAMPTZ,
  period_end   TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','cancelled')),
  method       TEXT,
  reference    TEXT,
  proof_url    TEXT,
  note         TEXT,
  created_by   BIGINT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at      TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);
CREATE INDEX idx_payouts_admin ON payouts(admin_id, created_at);
CREATE INDEX idx_payouts_status ON payouts(status);

CREATE TABLE webhook_inbox (
  id             BIGSERIAL PRIMARY KEY,
  source         TEXT NOT NULL,
  received_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  headers        TEXT,
  body           TEXT,
  auth_ok        SMALLINT NOT NULL DEFAULT 0 CHECK (auth_ok IN (0,1)),
  status         TEXT NOT NULL CHECK (status IN ('ok','rejected','error','duplicate','invalid')),
  error          TEXT,
  spend_event_id BIGINT REFERENCES spend_events(id)
);
CREATE INDEX idx_inbox_received ON webhook_inbox(received_at);

CREATE TABLE roblox_user_cache (
  username_lower TEXT PRIMARY KEY,
  roblox_user_id BIGINT,
  username       TEXT,
  display_name   TEXT,
  resolved_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id            BIGSERIAL PRIMARY KEY,
  actor_user_id BIGINT REFERENCES users(id),
  action        TEXT NOT NULL,
  entity        TEXT NOT NULL,
  entity_id     TEXT,
  before        TEXT,
  after         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_time ON audit_log(created_at);

CREATE TABLE map_products (
  id           BIGSERIAL PRIMARY KEY,
  map_id       BIGINT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  product_id   BIGINT NOT NULL,
  name         TEXT,
  price_robux  BIGINT NOT NULL CHECK (price_robux >= 0),
  is_active    SMALLINT NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  locked       SMALLINT NOT NULL DEFAULT 0 CHECK (locked IN (0,1)),   -- 1 = harga dikunci owner, sinkron dari game tidak menimpa
  source       TEXT NOT NULL DEFAULT 'owner' CHECK (source IN ('owner','game')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (map_id, product_id)
);

CREATE TABLE risk_flags (
  id             BIGSERIAL PRIMARY KEY,
  kind           TEXT NOT NULL,                  -- R1..R7
  severity       TEXT NOT NULL CHECK (severity IN ('low','medium','high')),
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','confirmed')),
  admin_id       BIGINT REFERENCES admins(id),
  map_id         BIGINT REFERENCES maps(id),
  spender_id     BIGINT REFERENCES spenders(id),
  spend_event_id BIGINT REFERENCES spend_events(id),
  title          TEXT NOT NULL,
  details        TEXT,                           -- JSON
  note           TEXT,
  resolved_by    BIGINT REFERENCES users(id),
  resolved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_risk_status ON risk_flags(status, severity, created_at);
CREATE INDEX idx_risk_event ON risk_flags(spend_event_id);
