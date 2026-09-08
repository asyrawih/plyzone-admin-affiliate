# Plan: migrasi SQLite → Postgres

Ditulis 2026-09-06 berdasarkan kode di `main` (`1a0c68a`) dan kondisi cluster saat itu.

## 0. Kenapa, dan apa yang sebenarnya terjadi

Keluhan: "aplikasi sering mati sendiri, mungkin pod-nya."

Bukti dari cluster (24 jam terakhir):

| Cek | Hasil |
|---|---|
| Restart container | 0 |
| OOM / SIGBUS / Bus error di journal & dmesg | tidak ada |
| Memori pod | 95 MiB dari limit 1 GiB |
| ReplicaSet baru dalam 13 jam | 4 (= 4 kali deploy) |

Kesimpulan: yang terlihat sebagai "mati sendiri" adalah **downtime tiap deploy**. Strategi `Recreate` wajib dipakai karena SQLite dan DuckDB adalah file lokal di satu PVC `ReadWriteOnce`, jadi pod lama harus mati dulu sebelum pod baru boleh pegang file. Tiap deploy = app hilang 30 detik sampai satu menit. Crash SIGBUS yang dulu (DuckDB ATTACH ke `app.db` live) sudah ditutup `99fd3b1` dengan snapshot.

Migrasi ke Postgres menyelesaikan akar masalahnya: app jadi **stateless**, bisa `RollingUpdate` dengan 2 replica, deploy tanpa downtime. Bonus: backup jadi `pg_dump`, tidak ada lagi dua library SQLite dalam satu proses, dan snapshot VACUUM tiap 2 detik hilang.

Kalau nanti "mati" terjadi lagi di luar jam deploy, tangkap buktinya sebelum menyimpulkan:

```bash
ssh root@31.97.220.179 'P=$(kubectl -n klsm-affiliate get pods -l app=klsm-affiliate -o jsonpath="{.items[0].metadata.name}"); kubectl -n klsm-affiliate get pod $P -o jsonpath="{.status.containerStatuses[0].lastState}"; echo; kubectl -n klsm-affiliate logs $P --previous --tail=50'
```

## 1. Keputusan desain

| Topik | Keputusan | Alasan |
|---|---|---|
| Driver | **`Bun.sql`** bawaan Bun 1.3 (tagged template, `sql.begin` untuk transaksi, pool) | nol dependency baru, sudah ada di runtime yang dipakai |
| Analitik | **DuckDB tetap dipakai** (keputusan owner), `:memory:` per pod, `ATTACH` ke Postgres lewat ekstensi `postgres` DuckDB | Tidak ada file yang dibagi antar library, jadi SIGBUS secara mekanis tidak mungkin. 12 fungsi query dan view di `packages/analytics` dipertahankan hampir apa adanya, hemat setengah hari penerjemahan. Tidak ada `analytics.duckdb` di disk lagi dan snapshot VACUUM dihapus |
| Schema | **Tulis ulang bersih** sebagai `0001_init.sql` versi Postgres (gabungan 0001–0003 SQLite) | data dipindah lewat copy, bukan migrasi in-place, jadi tidak perlu menerjemahkan `ALTER`/rebuild SQLite |
| Tipe | `TIMESTAMPTZ` untuk semua kolom waktu (dulu TEXT ISO), `BIGINT` untuk id, id Roblox & rupiah. **Flag 0/1 tetap `SMALLINT` dan kolom JSON tetap `TEXT`** (revisi saat implementasi) | API dan dashboard mengonsumsi `is_active` sebagai 0/1 dan `before/after/raw_payload` sebagai string; menjadikannya boolean/jsonb berarti menyentuh dashboard tanpa manfaat. Waktu keluar ke API tetap ISO string lewat normalisasi driver |
| Case-insensitive | **bukan `CITEXT`**, tapi kolom `TEXT` + unique index `lower(username)` dan query `WHERE lower(x) = lower($1)` | `citext` adalah tipe ekstensi yang tidak dikenal scanner DuckDB; `lower()` aman untuk keduanya |
| Id | `BIGSERIAL`, nilai lama dipertahankan saat copy, lalu `setval` | supaya link, token, dan referensi lama tetap valid |
| Postgres di k3s | `postgres:16` sebagai Deployment `Recreate` + PVC `local-path` 5Gi + Secret, di namespace yang sama | single node, cukup; operator (CloudNativePG) berlebihan untuk skala ini |
| Test | jalan ke Postgres asli lewat `TEST_DATABASE_URL`; tiap file test memakai schema sendiri (`CREATE SCHEMA test_xxx` → `search_path`) supaya paralel & bersih | in-memory SQLite tidak bisa lagi; `pglite` (WASM) belum diverifikasi di Bun |

## 2. Peta perubahan kode

Semua akses DB sudah lewat `packages/db` (645 baris, 9 repo) plus **14 panggilan langsung** `db.query/run/transaction` di 5 file API. Ini yang membuat migrasi terkendali.

### Mekanis (dialek SQL)

| Pola SQLite | Jumlah | Pengganti Postgres |
|---|---|---|
| `strftime('%Y-%m-%dT%H:%M:%fZ','now')` default & `strftime(..., 'now', '-N hours')` | 40 | `now()`, `now() - interval 'N hours'` |
| `?` placeholder | semua | `$1..$n` (Bun.sql tagged template mengurus ini) |
| `RETURNING *` | 24 | sama, didukung |
| `INSERT OR IGNORE` | 1 | `ON CONFLICT (source, external_id) DO NOTHING` |
| `ON CONFLICT ... DO UPDATE SET x = excluded.x` | 3 | sama, didukung |
| `COLLATE NOCASE` (username, roblox_username) | 5 | unique index `lower(...)` + `WHERE lower(x) = lower($1)` (bukan `citext`, lihat §1) |
| `MAX(a, b)` skalar | 1 | `GREATEST(a, b)` |
| `PRAGMA ...` | 8 | hapus |
| `LIKE` pencarian username | 3 | `ILIKE` |
| SQL DuckDB di `packages/analytics` (`strftime(timezone(...))`, `::DOUBLE`, `GROUP BY ALL`, `FILTER`) | 19 | **tetap**, ini DuckDB yang menjalankannya. Hanya `CAST(occurred_at AS TIMESTAMPTZ)` di view yang jadi tidak perlu karena kolom sudah timestamptz |

### Struktural (async)

`bun:sqlite` sinkron; Postgres asinkron. Konsekuensinya:

- Setiap fungsi repo jadi `async` dan dipanggil dengan `await`. Ini menyentuh semua pemanggil di `apps/api/src/routes/**` dan `services/**`.
- `db.transaction(() => {...})()` sinkron → `await sql.begin(async (tx) => {...})`, dan repo di dalamnya harus menerima `tx`, bukan `db` global. Pola: setiap fungsi repo menerima `q: Sql` (koneksi atau transaksi) sebagai argumen pertama, persis seperti sekarang menerima `db`. Jadi tanda tangan tidak berubah bentuk, hanya tipenya.
- Titik transaksi yang ada: `handleJoin`, `recordRobuxSpend`, `recordBagiBagiSpend` (bagian tulis), `matchSpendManually`, `voidSpend`, `generateMonthly`, `createAdhoc`, `cancelPayout`, migrator. Semua di `apps/api/src/services/*` dan `packages/db/src/migrate.ts`.
- Idempotensi ingest: tetap lewat `UNIQUE (source, external_id)` + `ON CONFLICT DO NOTHING`, tidak berubah.

### File yang berubah

| Area | File | Perubahan |
|---|---|---|
| db | `packages/db/src/connection.ts` | `openDb(url)` → `Bun.sql` pool; export `Sql` type |
| db | `packages/db/src/migrate.ts` | baca `migrations-pg/*.sql`, `_migrations` table, tiap file dalam satu transaksi (DDL Postgres transaksional) |
| db | `packages/db/migrations-pg/0001_init.sql` | schema penuh versi Postgres |
| db | `packages/db/src/repos/*.ts` (9 file) | async + dialek |
| db | `packages/db/src/types.ts` | `is_active: boolean`, waktu tetap `string` ISO di tipe row (konversi di driver) |
| api | `apps/api/src/context.ts`, `config.ts` | `DATABASE_URL` menggantikan `SQLITE_PATH`/`DUCKDB_PATH`/`ANALYTICS_SNAPSHOT_INTERVAL_MS` |
| api | `services/spend.ts`, `payout.ts`, `attribution.ts` | transaksi async |
| api | `routes/publicInfo.ts`, `routes/owner/setup.ts`, semua route yang memanggil repo | `await` |
| api | `test/e2e.test.ts` | koneksi ke `TEST_DATABASE_URL`, schema per run |
| analytics | `packages/analytics/src/connection.ts` | `DuckDBInstance.create(":memory:")`, `INSTALL postgres; LOAD postgres;`, `ATTACH 'dbname=klsm user=… host=klsm-postgres password=…' AS app (TYPE postgres, READ_ONLY)`; hapus seluruh kode snapshot, `bun:sqlite`, `refreshSnapshot`, `ensureFresh`, `dataVersion`. Views dibuat ulang tiap start (sekarang pun begitu). `queries.ts` hampir tidak berubah |
| analytics | `packages/analytics/src/analytics.test.ts` | pakai `TEST_DATABASE_URL`, angka acuan tetap sama |
| scripts | `apps/api/src/cli/sqlite-to-pg.ts` | copy data sekali jalan + verifikasi |
| deploy | `deploy/k3s/postgres.yaml`, `deployment.yaml`, `configmap.yaml`, `backup-cronjob.yaml`, `kustomization.yaml` | lihat §4 |
| root | `Dockerfile` | tanpa `sqlite3`; **pre-install ekstensi `postgres` DuckDB saat build** (lihat §4.6) supaya pod tidak mengunduh dari internet saat start |
| root | `docker-compose.yml`, `README.md`, `.env.example` | tambah service postgres di compose, `DATABASE_URL` |

Perkiraan: 2–3 hari kerja untuk kode + test, setengah hari untuk infra + cutover.

**Status 2026-09-06:** fase A selesai di branch `postgres` (worktree `../klsm-admin-affliate-postgres`): 40 test lulus di Postgres asli, typecheck bersih, image ter-build dengan ekstensi DuckDB dan terbukti start tanpa internet, `apps/api/src/cli/sqlite-to-pg.ts` diverifikasi terhadap salinan `app.db` produksi (semua count & sum sama). Sisa: fase B–D di server.

## 3. Script copy data (`apps/api/src/cli/sqlite-to-pg.ts`)

Sumber: `app.db` (bun:sqlite, read-only). Tujuan: Postgres kosong yang sudah dimigrasi schema.

Urutan tabel mengikuti FK: `users` → `maps` → `admins` → `commission_rates` → `spenders` → `referral_events` → `spend_events` → `commission_ledger` → `payouts` → `webhook_inbox` → `roblox_user_cache` → `audit_log` → `sessions`, `admin_sessions` → `map_products` → `risk_flags`.

Aturan konversi per kolom:
- TEXT ISO → `timestamptz` (`'2026-09-05T04:48:57.750Z'` di-parse langsung oleh Postgres).
- INTEGER 0/1 → boolean.
- `raw_payload`/`headers`/`before`/`after` TEXT JSON → `jsonb` (kalau bukan JSON valid, simpan sebagai `jsonb` string).
- Id dipertahankan; setelah selesai: `SELECT setval(pg_get_serial_sequence('t','id'), max(id))` per tabel.

Verifikasi otomatis di akhir script, harus sama persis antara SQLite dan Postgres:
- `COUNT(*)` per tabel.
- `SUM(amount_idr)` per `admin_id` di `commission_ledger` (saldo admin).
- `SUM(net_idr)`, `SUM(commission_idr)` per `status` di `spend_events`.
- `SUM(amount_idr)` per `status` di `payouts`.

Script idempoten: `TRUNCATE ... CASCADE` dulu, jadi bisa diulang untuk gladi.

## 4. Infra k3s (direvisi setelah melihat cluster & deploy.sh)

Kondisi nyata: k3s v1.36 single node (`srv1791208`, 8 GB RAM), StorageClass `local-path` **reclaimPolicy `Delete`**, `WaitForFirstConsumer`. Image dibangun lokal lalu `k3s ctr images import`, secret dibuat `deploy.sh` dari `.env`, overlay kustomize di `/root/klsm-deploy` menimpa base `deploy/k3s` dari repo.

### 4.1 Postgres: di dalam k3s, bukan systemd di host

Dipertimbangkan Postgres sebagai service host (apt). Ditolak: semua yang lain sudah di k3s, `deploy.sh` dan overlay sudah jadi satu alur, dan data di `local-path` toh tetap file biasa di disk yang sama (`/var/lib/rancher/k3s/storage/pvc-…`). Yang harus dijaga adalah reclaim policy dan backup, bukan tempat prosesnya.

```
deploy/k3s/postgres.yaml
  Secret      klsm-postgres        POSTGRES_USER=klsm, POSTGRES_PASSWORD, POSTGRES_DB=klsm
                                   (dibuat deploy.sh dari .env, sama seperti secret app)
  PVC         klsm-postgres-data   local-path, 5Gi
  Deployment  klsm-postgres        postgres:16.4-alpine (pin minor), replicas 1, strategy Recreate,
                                   PGDATA=/var/lib/postgresql/data/pgdata  (subdir, bukan root mount),
                                   securityContext.fsGroup 70 (uid postgres di image alpine),
                                   args: -c shared_buffers=128MB -c max_connections=50 -c timezone=UTC,
                                   readiness & liveness: pg_isready -U klsm,
                                   resources requests 128Mi / limits 1Gi,
                                   terminationGracePeriodSeconds 60
  Service     klsm-postgres        ClusterIP 5432 (tidak pernah lewat Ingress)
```

DNS di dalam namespace: `postgres://klsm:<pw>@klsm-postgres:5432/klsm`.

### 4.2 Reclaim policy: WAJIB Retain (ini yang paling gampang bikin data hilang di k3s)

`local-path` membuat PV dengan `Delete`. `kubectl delete pvc` atau `kubectl delete -k` yang tidak sengaja menyertakan PVC = direktori data dihapus provisioner. Segera setelah PVC bound:

```bash
PV=$(kubectl -n klsm-affiliate get pvc klsm-postgres-data -o jsonpath='{.spec.volumeName}')
kubectl patch pv "$PV" -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}'
```

Hal yang sama berlaku untuk PVC `klsm-affiliate-data` (SQLite) sebelum fase D. Jangan hapus PVC itu sebelum PV-nya `Retain` dan backup terakhir tersalin ke luar server.

### 4.3 Perubahan pada app

- `deployment.yaml`: `replicas: 2`, `strategy: RollingUpdate {maxUnavailable: 0, maxSurge: 1}` (single node, tiga pod app sesaat saat rollout, masing-masing ±100 MiB, aman). Hapus volume `/data`. Env `DATABASE_URL` dari secret `klsm-affiliate-secrets`.
- `initContainer` `wait-db` (image `postgres:16.4-alpine`, `until pg_isready -h klsm-postgres -U klsm; do sleep 2; done`). Penting di k3s single node: saat node reboot semua pod naik bersamaan dan app biasanya siap sebelum Postgres. Ditambah retry koneksi di `createContext` supaya liveness tidak membunuh pod yang sedang menunggu.
- `PodDisruptionBudget` `minAvailable: 1` untuk app, supaya `kubectl drain` saat upgrade k3s tidak mematikan dua-duanya sekaligus.
- Rate limit halaman publik in-memory per pod → efektif 2× dengan 2 replica. Diterima.
- Pool `Bun.sql` `max: 10` per pod → 20 koneksi, di bawah `max_connections=50`.

### 4.4 deploy.sh dan overlay

`deploy.sh` (di server, di luar repo) perlu tiga tambahan, semuanya membaca `.env`:

```bash
# secret app: tambah DATABASE_URL
--from-literal=DATABASE_URL="${DATABASE_URL}"
# secret postgres (sekali; apply ulang dengan nilai sama tidak apa-apa)
kubectl -n klsm-affiliate create secret generic klsm-postgres \
  --from-literal=POSTGRES_USER=klsm --from-literal=POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
  --from-literal=POSTGRES_DB=klsm --dry-run=client -o yaml | kubectl apply -f -
# rollout dua deployment
kubectl -n klsm-affiliate rollout status deploy/klsm-postgres --timeout=120s
```

`.env` di server dapat dua baris baru: `POSTGRES_PASSWORD=$(openssl rand -hex 24)` dan `DATABASE_URL=postgres://klsm:<pw>@klsm-postgres:5432/klsm`. Overlay tidak berubah kecuali kalau mau menimpa resources.

Image `postgres:16.4-alpine` ditarik dari Docker Hub oleh containerd k3s (node punya akses internet, cert-manager juga ditarik begitu). Kalau mau konsisten dengan pola "tanpa registry", `docker pull` lalu `docker save | k3s ctr images import -` sekali di `setup.sh`.

### 4.5 Backup di k3s

- CronJob `klsm-pg-backup` harian 03:00 WIB, image `postgres:16.4-alpine`, `pg_dump -Fc -h klsm-postgres -U klsm klsm > /backups/klsm-YYYYmmdd.dump`, `PGPASSWORD` dari secret, ke PVC `klsm-backups` (patch PV ke Retain juga), retensi 14 hari.
- Satu disk untuk semuanya (`/dev/sda1`). Backup di PVC hanya melindungi dari salah data, bukan dari disk mati. Salin ke luar server: langkah `rclone copy /backups r2:klsm/pg` di CronJob yang sama, atau `scp` harian dari laptop. Ini bukan opsional lagi begitu Postgres jadi satu-satunya sumber data.
- Restore: `pg_restore -c -h klsm-postgres -U klsm -d klsm file.dump` dari pod sementara (`kubectl run -it --image=postgres:16.4-alpine`).

### 4.6 DuckDB di pod: ekstensi `postgres` harus ada di image

`INSTALL postgres` mengunduh dari `extensions.duckdb.org` saat pertama dipanggil. Kalau itu terjadi saat pod start, start jadi bergantung internet dan lebih lambat, dan dengan 2 replica terjadi dua kali. Solusinya di Dockerfile:

```dockerfile
ENV DUCKDB_EXTENSION_DIR=/app/.duckdb/extensions
RUN bun -e "const {DuckDBInstance}=require('@duckdb/node-api');(async()=>{const i=await DuckDBInstance.create(':memory:',{extension_directory:'/app/.duckdb/extensions'});const c=await i.connect();await c.run('INSTALL postgres');})()"
```

Lalu di `connection.ts`: `DuckDBInstance.create(":memory:", { extension_directory: process.env.DUCKDB_EXTENSION_DIR })` dan hanya `LOAD postgres` (tanpa `INSTALL`) saat start. Versi `@duckdb/node-api` di-pin persis, karena ekstensi terikat ke versi DuckDB.

Perilaku lain yang perlu diketahui:
- Tiap pod punya DuckDB `:memory:` sendiri. Tidak ada state yang dibagi, jadi 2 replica aman.
- Query DuckDB ke Postgres membaca lewat koneksi terpisah dari pool `Bun.sql`. Hitung ±3 koneksi per pod untuk DuckDB, total masih di bawah `max_connections=50`.
- `READ_ONLY` pada ATTACH: DuckDB tidak pernah menulis ke Postgres. Semua tulisan tetap lewat `packages/db`.
- Tanpa snapshot, angka analitik selalu live. Cache 15 detik di TanStack Query dashboard sudah cukup sebagai rem.

### 4.7 Copy data sebagai Job, bukan kubectl cp

PVC SQLite `ReadWriteOnce` dan terikat ke node. Cara yang cocok di k3s: `deploy/k3s/migrate-job.yaml`, Job satu kali memakai **image app** (sudah berisi Bun + `apps/api/src/cli/sqlite-to-pg.ts`), mount PVC `klsm-affiliate-data` di `/data`, env `DATABASE_URL`, `command: bun run apps/api/src/cli/sqlite-to-pg.ts --source /data/app.db`. Karena RWO di node yang sama boleh dipakai dua pod sekaligus, Job ini bisa jalan **selagi app lama masih hidup** untuk gladi (baca saja), lalu dijalankan lagi saat cutover setelah app di-scale ke 0.

## 5. Urutan eksekusi

**Fase A, kode (di branch `postgres`, tidak menyentuh produksi)**
1. `packages/db`: connection, migrator, schema PG, repo async. Jalankan `bun test` terhadap Postgres lokal (`docker compose up postgres`).
2. `packages/analytics`: ganti koneksi ke `:memory:` + `ATTACH … (TYPE postgres)`, buang kode snapshot. 12 query dan views dijalankan ulang terhadap Postgres lokal; test yang ada (`analytics.test.ts`) dipakai sebagai acuan angka. Perhatikan pemetaan tipe scanner: `timestamptz` → `TIMESTAMP WITH TIME ZONE`, `jsonb` → `JSON`, `boolean` → `BOOLEAN`.
3. `apps/api`: `await` di semua pemanggil, transaksi async, e2e test lulus (33 test sekarang).
4. `apps/api/src/cli/sqlite-to-pg.ts` + gladi memakai salinan `app.db` produksi (`kubectl cp`), verifikasi §3 lulus.
5. Dockerfile tanpa sqlite3, ekstensi `postgres` DuckDB di-pre-install (§4.6); image baru dibangun dan diuji di compose bersama postgres, termasuk start **tanpa akses internet** (`docker run --network none`) untuk membuktikan ekstensi tidak diunduh saat start.

**Fase B, infra (produksi, tanpa downtime)**
6. Tambah `POSTGRES_PASSWORD` dan `DATABASE_URL` ke `.env` server, update `deploy.sh` (§4.4). `kubectl apply` postgres.yaml lewat overlay. App lama tetap jalan di SQLite.
7. **Patch PV Postgres ke `Retain`** (§4.2). Cek `kubectl get pv` sebelum lanjut.
8. Gladi: jalankan `migrate-job.yaml` (§4.7) selagi app lama hidup, verifikasi §3 lulus. Ulangi sampai bersih. `kubectl delete job` sebelum jalan lagi.

**Fase C, cutover (downtime ±2 menit, pilih jam sepi)**
9. `kubectl -n klsm-affiliate scale deploy/klsm-affiliate --replicas=0` (SQLite berhenti ditulis).
10. Jalankan `migrate-job.yaml` untuk copy final, tunggu `Completed`, baca log verifikasi.
11. `deploy.sh` dengan commit yang sudah memuat image Postgres, `DATABASE_URL`, 2 replica, RollingUpdate. Migrator schema jalan otomatis saat start; `initContainer` menunggu Postgres siap.
12. Smoke test: login owner, Overview, Spend Events, `GET /a/<token>`, satu `POST /ingest/join` dari game (cek Alur checklist). Cek `kubectl get pods`: dua pod app `Running`, satu Postgres.
13. Roblox: tidak ada perubahan; `AffiliateReport` hanya tahu URL.
14. Uji yang jadi tujuan utama: jalankan `deploy.sh` sekali lagi tanpa perubahan kode dan pantau `curl https://affiliate.kelasmalam.app/health` tiap detik selama rollout. Harus tidak ada satu pun kegagalan.

**Rollback** (kapan pun sebelum fase D): set `newTag` overlay ke sha lama, `kubectl apply -k`, PVC `/data` masih utuh dan belum dilepas dari manifest lama. Data yang masuk setelah cutover ke Postgres akan hilang dari SQLite, jadi rollback hanya untuk kegagalan di menit-menit pertama.

**Fase D, bersih-bersih (setelah 1–2 minggu stabil)**
15. Patch PV `klsm-affiliate-data` ke `Retain`, salin `app.db` terakhir ke luar server, baru hapus PVC dan CronJob backup SQLite.
16. Hapus `bun:sqlite` di analytics dan `apps/api/src/cli/sqlite-to-pg.ts`, `SQLITE_PATH`/`DUCKDB_PATH`/`ANALYTICS_SNAPSHOT_INTERVAL_MS` dari config, Dockerfile tanpa `sqlite3`, docs. `@duckdb/node-api` tetap.

## 6. Yang tidak berubah

- Kontrak API, dashboard, Postman collection, halaman publik, dan kode di Roblox Studio. Semua tetap sama.
- Aturan bisnis: first-touch, basis point, rate history, idempotensi by `(source, external_id)`, ledger.

## 7. Risiko yang perlu diwaspadai

- **Timezone**: DuckDB tetap yang menggeser ke Jakarta lewat `timezone('Asia/Jakarta', …)`, tapi sumbernya sekarang `timestamptz` asli, bukan TEXT yang di-CAST. Test "timeseries pakai hari Jakarta" di `analytics.test.ts` harus tetap lulus sebelum cutover.
- **Case-insensitive username**: `COLLATE NOCASE` di SQLite juga berlaku di `UNIQUE`. Di Postgres pakai unique index `lower(username)` supaya registrasi "CITRA" vs "citra" tetap ditolak (ada di e2e test). Bukan `citext`, karena scanner DuckDB tidak mengenalnya.
- **Versi DuckDB dan ekstensi terikat**: upgrade `@duckdb/node-api` = ekstensi `postgres` harus di-install ulang saat build (otomatis lewat Dockerfile). Jangan upgrade DuckDB tanpa membangun image baru.
- **Reboot node / upgrade k3s**: semua pod naik bersamaan; tanpa `initContainer` + retry, app bisa crash-loop beberapa menit sampai Postgres siap. Uji dengan `sudo systemctl restart k3s` di jam sepi setelah cutover.
- **Satu disk**: Postgres, backup, dan k3s di `/dev/sda1`. Backup offsite (§4.5) harus jalan sebelum fase D, karena setelah itu SQLite tidak ada lagi sebagai cadangan.
- **Dua agent mengedit repo bersamaan**: fase A dikerjakan di branch terpisah dan di-rebase ke `main` sebelum fase C.
