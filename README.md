# PLYZONE AFFILIATOR

Sistem afiliasi admin: admin mengundang spender lewat share link Roblox, setiap spend (Robux dari `ProcessReceipt`, Rupiah dari donasi bagi-bagi) menghasilkan komisi untuk admin sesuai rate di config. Robux dipotong fee Roblox 30% dulu, lalu dikonversi ke Rupiah.

- **Postgres** (`Bun.sql` bawaan Bun): transaksional. Sumber kebenaran: spender, referral, spend event, ledger, payout. App stateless, bisa 2 replica.
- **DuckDB** (`@duckdb/node-api`): analitik, `:memory:` per proses, `ATTACH` ke Postgres yang sama lewat ekstensi `postgres` (READ_ONLY). Views + query agregasi, bucketing Asia/Jakarta, angka selalu live. Ekstensi di-pre-install saat build image (`DUCKDB_EXTENSION_DIR`).
- **Bun workspaces**: `apps/api` (Hono), `apps/dashboard` (Vite + React + Tailwind + Recharts), `packages/shared|db|analytics`, `roblox/` (Luau referensi).

## Jalanin

```bash
bun install
docker compose up -d postgres   # Postgres lokal di :5433 (dipakai dev & test)
cp .env.example .env            # DATABASE_URL sudah menunjuk ke :5433; isi WEBHOOK_SHARED_SECRET dsb.
bun run seed:owner owner rahasia  # migrasi schema + user owner + rate default (10%, fee 30%, 145 IDR/R$)
bun run dev:api                 # http://localhost:3000
bun run dev:dashboard           # http://localhost:5173  (proxy /api dan /a ke :3000)
bun test                        # 40 test ke Postgres asli (database sekali pakai per run): rumus komisi, db, analytics, e2e API
```

Docker: `docker compose up --build` (postgres + satu container API/dashboard). Produksi di k3s: lihat **`deploy/k3s/README.md`**. Migrasi dari SQLite lama: `deploy/postgres-migration-plan.md` dan `apps/api/src/cli/sqlite-to-pg.ts`.

## Docs integrasi Roblox

Panduan interaktif (bahasa sederhana) untuk memasang script di map: buka `docs/index.html` di browser. Isinya alur, checklist persiapan, langkah pasang, generator share link, kalkulator komisi, pembuat payload/curl, referensi endpoint, dan masalah umum. Kode Luau di dalamnya diambil langsung dari `roblox/`; setelah mengubah file di `roblox/`, jalankan `bun run docs:build`.

## Alur

1. **Config → Maps**: tambah map + Place ID → dapat `ingest key` (tampil sekali). Pasang di `roblox/AffiliateClient.luau`.
2. **Admins**: buat admin → kode referral + share link `https://www.roblox.com/games/start?placeId=…&launchData=ref_KODE` + link publik `/a/<token>`.
3. Game: `AffiliateService` kirim `POST /ingest/join` (spender + first-touch attribution). `ReceiptService` kirim `POST /ingest/robux` di jalur granted (idempoten by `purchaseId`). Lihat `roblox/README.md`.
4. Donasi bagi-bagi masuk ke game (proxy → MessagingService topic `Donation`), lalu `DonationBoardService` kirim `POST /ingest/bagibagi` dari server yang menang mencatat. Kalau game tahu player-nya, kirim `robloxUserId` → match pasti; kalau tidak, backend menebak dari username/pesan; gagal → antrian **Unmatched** di dashboard. `POST /webhook/bagibagi` langsung dari proxy tetap ada sebagai cadangan.
5. Komisi masuk `commission_ledger`. Saldo admin = SUM ledger. **Payouts**: generate bulanan (preview → buat) atau ad-hoc, tandai dibayar dengan referensi.
6. Halaman depan `/` adalah landing page publik yang menjelaskan model bisnis (cara kerja, rate & kalkulator komisi live dari `GET /api/public/info`, aturan, FAQ) dengan CTA daftar admin. Dashboard owner ada di `/dashboard/*`.
7. Admin lihat pendapatannya lewat dua jalur: **portal admin `/admin`** (daftar sendiri di `/admin/register`, status `pending` sampai owner approve di halaman Admins, lalu login untuk lihat saldo, komisi, mutasi, riwayat payout, share link, ganti password) atau **link publik `/a/<token>`** tanpa login. Owner juga bisa memberi login ke admin yang dibuat manual ("Beri login" di detail admin).

## Rumus

```
Robux : net_robux = floor(gross × (1 − fee))   → net_idr = net_robux × idr_per_robux
IDR   : net_idr   = gross
komisi = floor(net_idr × rate)
```
Persen disimpan basis point (1000 = 10%). Rate punya history; event memakai rate yang berlaku saat `occurred_at`, perubahan rate tidak mengubah event lama.

## API

| Endpoint | Auth |
|---|---|
| `POST /ingest/join`, `POST /ingest/robux`, `POST /ingest/bagibagi` | `x-map-key` |
| `POST /webhook/bagibagi` (cadangan) | `x-webhook-secret` / HMAC / tanpa auth kalau env kosong (dev) |
| `POST /api/auth/login|logout`, `GET /api/auth/me` | cookie session owner |
| `POST /api/admin-auth/register|login|logout|change-password`, `GET /api/admin-auth/me` | cookie session admin (terpisah) |
| `GET /api/admin-portal/summary` | session admin berstatus `active` |
| `/api/admins` (+ `/:id/approve`, `/:id/reject`, `/:id/set-login`), `/api/config/{rates,maps}`, `/api/spend-events`, `/api/spenders`, `/api/payouts`, `/api/analytics/*`, `/api/audit`, `/api/setup` | session owner |
| `GET /a/:token` | token (rate limited) |

Kontrak payload ada di `packages/shared/src/contracts.ts` (zod).

Semua endpoint daftar berhalaman dengan `?limit=` (default 50, maks 200) dan `?offset=`, dan mengembalikan `{ rows, total, limit, offset }`: `/api/spend-events`, `/api/spenders` (`q`, `adminId`), `/api/payouts` (`status`, `adminId`), `/api/audit`, `/api/admins/:id/ledger`, `/api/admin-portal/{events,spenders,ledger,payouts}`, `/a/:token/{events,payouts}`. Di dashboard pakai `usePaged` + `<Pager>` (`apps/dashboard/src/components/Pager.tsx`).

Tema: terang/gelap/ikuti sistem, tombol di sidebar owner, login, portal admin, halaman publik, dan landing. Pilihan disimpan di `localStorage` (`klsm-theme`); kelas `.dark` di `<html>` dipasang oleh script inline di `index.html` sebelum render supaya tidak berkedip. Semua warna lewat token CSS di `index.css` (`--surface`, `--ink`, `--good-bg`, …), jangan pakai warna Tailwind langsung.

Performa: aset dashboard di-precompress (brotli/gzip) saat build dan di-cache setahun (nama file ber-hash, `index.html` selalu `no-cache`); JSON API di-gzip on-the-fly; recharts dimuat lazy. Snapshot analitik hanya dibuat ulang kalau ada commit baru (`PRAGMA data_version`).

## Anti-fraud (Fase 1) & multi-map

- **Map** ditentukan dari `x-map-key`; `placeId` di payload harus cocok dengan `maps.place_id`, kalau tidak 403 + flag R7. Dashboard punya pemilih map global (sidebar, tersimpan di localStorage) yang diteruskan sebagai `mapId` ke semua endpoint analitik & daftar; Overview punya tabel per map (`GET /api/analytics/maps`).
- **Katalog produk** per map (`map_products`, Config → Maps → Produk, atau `POST /ingest/products` dari game; harga yang dikunci owner tidak ditimpa). Kalau map punya katalog, event Robux yang productId/harganya tidak cocok masuk status `review` (aturan R1) tanpa ledger, sampai owner menyetujui (`POST /api/spend-events/:id/approve`) atau void.
- **Masa tahan**: `commission_rates.hold_hours` (default 72). Ledger `earn` membawa `available_at`; payout bulanan & ad-hoc hanya memakai saldo tersedia. Portal/detail admin menampilkan saldo tersedia vs tertahan.
- **Konfirmasi bagi-bagi** (`bagibagi_confirm_hours`, default 0 = mati): laporan dari game ditahan (R4) sampai webhook proxy dengan id sama datang, lalu disetujui otomatis.
- **Halaman Risiko** (`/dashboard/risk`, `GET /api/risk`): flag R1 (produk/harga), R4 (donasi belum dikonfirmasi), R6 (self-referral), R7 (payload ditolak) dengan aksi setujui / void / abaikan / konfirmasi. Semua aksi masuk audit. Kesehatan map (join/spend terakhir, event 24 jam) ada di Config.

## Status admin

`pending` (daftar sendiri, kode referral belum aktif) · `active` · `inactive` (ditolak / dinonaktifkan, session dilogout).

## Status event

`attributed` (spender punya referrer, komisi masuk) · `unattributed` (organik, hanya analitik) · `unmatched` (bagi-bagi belum ketemu spender) · `review` (ditahan aturan risiko, tanpa ledger sampai disetujui) · `void` (dibatalkan, ledger dibalik).

## Yang belum

- Game pass sengaja tidak dihitung, hanya developer product.
- Refund Robux tidak ada event dari Roblox → void manual.
- Backup: `pg_dump -Fc` (CronJob di k3s), lihat `deploy/k3s/README.md`.
