-- Admin memilih kode referralnya sendiri SEKALI (lalu terkunci). Kode otomatis lama disimpan sebagai alias
-- supaya share link yang sudah disebar tetap hidup. Undangan via Roblox (ReferredByPlayerId) dicatat inviter-nya.
ALTER TABLE admins ADD COLUMN referral_code_prev TEXT;
ALTER TABLE admins ADD COLUMN referral_code_set_at TIMESTAMPTZ;
CREATE UNIQUE INDEX idx_admins_referral_code_prev ON admins(referral_code_prev) WHERE referral_code_prev IS NOT NULL;
ALTER TABLE referral_events ADD COLUMN inviter_roblox_user_id BIGINT;
