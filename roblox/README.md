# Integrasi sisi Roblox (JAKSEL SPACE / Bulungan)

Dipasang langsung di place lewat Studio pada 2026-09-05. File di folder ini adalah **salinan referensi**; sumber kebenarannya ada di game.

## Yang ada di game

| Lokasi di game | Isi |
|---|---|
| `ServerScriptService.Server.ApiAuth` | ditambah `affiliateKey()`: baca Roblox Secret **`AF`** (ingest key map) sekali, cache, nil = fitur mati |
| `ServerScriptService.Server.AffiliateReport` (baru) | HTTP client ke `https://affiliate.kelasmalam.app`: `Join`, `Robux`, `Donation`, `FlushPending`. Fire-and-forget, retry 3×, receipt Robux yang gagal diparkir di DataStore `AffiliatePending_v1` |
| `ServerScriptService.Server.Services.AffiliateService` (baru) | Knit service: `PlayerAdded` → `GetJoinData().LaunchData` + `ReferredByPlayerId` → `AffiliateReport.Join`; meneruskan jawaban backend ke client lewat signal `InviteReady` (pemain ini admin) dan `Notify` (hasil undangan ke pengundang). Timer `FlushPending` tiap 5 menit |
| `StarterPlayer.StarterPlayerScripts.Client.Controllers.AffiliateController` (baru) | Knit controller: tombol **"Undang teman"** untuk admin (`SocialService:PromptGameInvite` dengan `ExperienceInviteOptions.LaunchData = ref_KODE`) dan notifikasi hasil undangan (`SetCore SendNotification`) |
| `ServerScriptService.Server.Services.ReceiptService` | satu baris di cabang `result == true` → `AffiliateReport.Robux(info)` |
| `ServerScriptService.Server.Services.DonationBoardService` | di `_OnDonation`: jalur `ok` (satu server pemenang, userId ter-resolve) → `AffiliateReport.Donation(event, userId, name)`; jalur `userId == nil` → `Donation(event, nil, username)` supaya masuk Unmatched |

## Alur di game

- **Join lewat link**: `https://www.roblox.com/games/start?placeId=82391043752226&launchData=ref_KODE`. `LaunchData` hanya terisi saat masuk lewat link. Join biasa tetap dilaporkan (launchData nil) supaya spender organik tercatat.
- **Undang teman dari dalam game** (jalur yang disarankan): pemain yang admin aktif melihat tombol "Undang teman" (kiri bawah). Klik → prompt undangan Roblox ke teman, membawa `LaunchData = ref_KODE`, jadi teman yang masuk lewat undangan itu diproses persis seperti link. Undangan dari menu sistem Roblox (tanpa LaunchData) juga ditangkap lewat `ReferredByPlayerId` dan dicocokkan ke admin yang punya akun Roblox itu. Batasan Roblox: undangan hanya ke **teman**.
- **Notifikasi ke pengundang**: kalau teman yang diundang ternyata sudah terikat ke admin lain, pengundang (jika ada di server yang sama) dapat notifikasi "X sudah terikat ke admin lain", tanpa menyebut siapa. Riwayat lengkap ada di portal admin → "Undangan terbaru".
- **Kode referral** dipilih admin sekali di portal lalu terkunci; kode otomatis lama tetap berlaku sebagai alias, jadi link lama tidak mati.
- **Robux**: `ReceiptService` adalah pemilik tunggal `ProcessReceipt`. Laporan dikirim hanya setelah handler produk mengembalikan `true` (tersimpan permanen). Transfer Robux antar pemain (`RobuxTransferService`, `BindReceiptHandler`) **sengaja tidak dihitung**.
- **Bagi-bagi**: worker Vercel → MessagingService topic `Donation` → `DonationService` (dedupe per server, tebak username, `Received`) → `DonationBoardService._OnDonation` → `Record()` lewat `UpdateAsync` (dedupe lintas server, satu pemenang) → laporan. Donasi `Simulate()` (`src = "simulate"`) dilewati.

## Studio

`AffiliateReport.ALLOW_STUDIO = false`: di Studio laporan dimatikan dengan satu warn, supaya data tes tidak jadi komisi produksi. Untuk tes end-to-end dari Studio: set `true` sementara, pastikan secret `AF` menunjuk ke map tes, dan Studio diberi akses secret.

## Tes undangan (harus di server live, bukan Studio)

1. Publish place. Akun admin (yang `roblox_user_id`-nya tercatat di dashboard) masuk ke game → tombol "Undang teman" muncul.
2. Klik, pilih teman, teman masuk lewat notifikasi undangan → di dashboard Spenders teman itu terikat ke admin; portal admin menampilkan "berhasil".
3. Ulangi dari akun admin lain ke teman yang sama → pengundang kedua dapat notifikasi "sudah terikat ke admin lain".

## Cek setelah publish

1. Output server: `[ApiAuth]` tidak boleh ada warn secret `AF`; `[AffiliateReport]` tidak boleh ada warn `ditolak HTTP 401` (key salah) atau `503` (rate belum diset).
2. Dashboard → Alur → checklist "Game mengirim join" harus hijau setelah ada pemain masuk.
3. Dashboard → Spend Events setelah ada pembelian produk / donasi.
