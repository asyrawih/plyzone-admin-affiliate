# Postman

- `klsm-affiliate.postman_collection.json` — semua endpoint, 16 folder, bisa dijalankan sekali jalan dari atas ke bawah (Runner).
- `klsm-affiliate.local.postman_environment.json` — variabel untuk lokal (`baseUrl`, login owner, `webhookSecret`).

Import keduanya, pilih environment "PLYZONE AFFILIATOR · local", lalu jalankan folder berurutan:
Owner Auth → Config (buat map, `mapKey` tersimpan otomatis) → Admins (buat admin, `referralCode` & `publicToken` tersimpan) → Ingest → Spend Events → Payouts → Analytics.

Untuk produksi, duplikat environment dan ganti `baseUrl` ke `https://affiliate.DOMAIN` dan secret-nya.
