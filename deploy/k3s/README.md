# Deploy ke k3s

Postgres di dalam k3s + app stateless 2 replica (`RollingUpdate`, deploy tanpa downtime). Domain publik HTTPS wajib karena Roblox `HttpService` hanya mau HTTPS.

Migrasi dari versi SQLite: urutan lengkap ada di `deploy/postgres-migration-plan.md` §5. Ringkasnya ada di §7 di bawah.

## 0. Prasyarat di server

```bash
# k3s sudah jalan, kubectl bisa akses. Pasang cert-manager untuk TLS otomatis:
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml
kubectl apply -f - <<'YAML'
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata: { name: letsencrypt-prod }
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: GANTI@email.com
    privateKeySecretRef: { name: letsencrypt-prod-key }
    solvers: [{ http01: { ingress: { class: traefik } } }]
YAML
```

DNS: arahkan `affiliate.GANTI-DOMAIN.com` (A record) ke IP server.

## 1. Build image

Image berisi API + dashboard + ekstensi `postgres` DuckDB (di-INSTALL saat build, pod tidak mengunduh apa pun saat start).

**a. Registry (ghcr.io / Docker Hub)**
```bash
docker build -t ghcr.io/USER/klsm-affiliate:$(git rev-parse --short HEAD) -t ghcr.io/USER/klsm-affiliate:latest .
docker push ghcr.io/USER/klsm-affiliate --all-tags
```

**b. Tanpa registry (build di server, import ke containerd k3s)** — ini yang dipakai `deploy.sh`:
```bash
docker build -t klsm-affiliate:$TAG . && docker save klsm-affiliate:$TAG | k3s ctr images import -
# overlay kustomization: newName: klsm-affiliate, newTag: $TAG; deployment: imagePullPolicy: IfNotPresent
```

## 2. Konfigurasi & secret

- `configmap.yaml`: ganti `GANTI-DOMAIN.com` (APP_URL & DASHBOARD_ORIGIN = host ingress).
- `ingress.yaml`: ganti host. `kustomization.yaml`: ganti image.
- `.env` di server dapat dua baris baru, lalu `deploy.sh` membuat dua secret dari situ:

```bash
POSTGRES_PASSWORD=$(openssl rand -hex 24)
DATABASE_URL=postgres://klsm:<POSTGRES_PASSWORD>@klsm-postgres:5432/klsm
```
```bash
kubectl get ns klsm-affiliate >/dev/null 2>&1 || kubectl create ns klsm-affiliate
kubectl -n klsm-affiliate create secret generic klsm-postgres \
  --from-literal=POSTGRES_USER=klsm --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" --from-literal=POSTGRES_DB=klsm \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n klsm-affiliate create secret generic klsm-affiliate-secrets \
  --from-literal=DATABASE_URL="$DATABASE_URL" \
  --from-literal=WEBHOOK_SHARED_SECRET="$WEBHOOK_SHARED_SECRET" --from-literal=WEBHOOK_HMAC_SECRET="${WEBHOOK_HMAC_SECRET:-}" \
  --dry-run=client -o yaml | kubectl apply -f -
```

## 3. Deploy

```bash
kubectl apply -k deploy/k3s            # atau overlay: kubectl apply -k /root/klsm-deploy
kubectl -n klsm-affiliate rollout status deploy/klsm-postgres --timeout=120s
kubectl -n klsm-affiliate rollout status deploy/klsm-affiliate --timeout=180s
kubectl -n klsm-affiliate logs deploy/klsm-affiliate --tail=50   # "[db] migrasi dijalankan" & "listening"
```

**WAJIB setelah PVC Postgres bound** (StorageClass `local-path` di k3s reclaim-nya `Delete`: hapus PVC = data hilang):
```bash
for pvc in klsm-postgres-data klsm-backups; do
  PV=$(kubectl -n klsm-affiliate get pvc $pvc -o jsonpath='{.spec.volumeName}')
  kubectl patch pv "$PV" -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}'
done
kubectl get pv   # kolom RECLAIM POLICY harus Retain
```

Buat owner (sekali, kalau database baru):
```bash
kubectl -n klsm-affiliate exec -it deploy/klsm-affiliate -- bun run apps/api/src/cli/seed-owner.ts owner 'PASSWORD-KUAT'
```

## 4. Update versi (tanpa downtime)

`deploy.sh` (build → import → apply → rollout). `RollingUpdate maxUnavailable=0`: pod baru siap dulu (initContainer menunggu Postgres, migrasi schema jalan saat start dengan advisory lock, jadi dua pod tidak bentrok), baru pod lama dimatikan. Uji: `while true; do curl -fsS https://affiliate.GANTI-DOMAIN.com/health >/dev/null || echo GAGAL; sleep 1; done` selama rollout.

## 5. Backup & restore

- CronJob `klsm-pg-backup`: `pg_dump -Fc` harian 03:00 WIB ke PVC `klsm-backups`, retensi 14 hari.
- Satu disk untuk semuanya: **salin ke luar server**. Dari laptop:
```bash
ssh SERVER 'kubectl -n klsm-affiliate exec deploy/klsm-postgres -- sh -c "PGPASSWORD=\$POSTGRES_PASSWORD pg_dump -U \$POSTGRES_USER -d \$POSTGRES_DB -Fc"' > klsm-$(date +%F).dump
```
- Restore (ke database yang sama, isi lama ditimpa):
```bash
kubectl -n klsm-affiliate cp klsm-YYYY-MM-DD.dump $(kubectl -n klsm-affiliate get pod -l app=klsm-postgres -o name | cut -d/ -f2):/tmp/r.dump
kubectl -n klsm-affiliate exec deploy/klsm-postgres -- sh -c 'PGPASSWORD=$POSTGRES_PASSWORD pg_restore -U $POSTGRES_USER -d $POSTGRES_DB -c --if-exists /tmp/r.dump'
```

## 6. Cek kesehatan

| Apa | Perintah |
|---|---|
| API hidup | `curl -fsS https://affiliate.GANTI-DOMAIN.com/health` |
| Pod | `kubectl -n klsm-affiliate get pods` → 2× app Running, 1× postgres Running |
| Join masuk dari game | dashboard → Alur → checklist |
| Disk Postgres | `kubectl -n klsm-affiliate exec deploy/klsm-postgres -- df -h /var/lib/postgresql/data` |
| Log | `kubectl -n klsm-affiliate logs -f deploy/klsm-affiliate` |
| Query lambat | Postgres log `log_min_duration_statement=500` (`kubectl logs deploy/klsm-postgres`) |

## 7. Migrasi dari SQLite (sekali)

1. Fase B: tambah `POSTGRES_PASSWORD` + `DATABASE_URL` ke `.env`, update `deploy.sh` (§2), `kubectl apply -k` → Postgres naik, app lama tetap jalan. Patch PV ke Retain (§3).
2. Gladi selagi app lama hidup: `kubectl -n klsm-affiliate apply -f deploy/k3s/migrate-job.yaml` (set image tag = tag terbaru), `kubectl -n klsm-affiliate logs job/klsm-sqlite-to-pg` harus berakhir `VERIFIKASI OK`. `kubectl delete job klsm-sqlite-to-pg` sebelum ulang.
3. Cutover (jam sepi, ±2 menit): `kubectl -n klsm-affiliate scale deploy/klsm-affiliate --replicas=0` → jalankan Job lagi (copy final + verifikasi) → `deploy.sh` dengan commit versi Postgres → smoke test (login, Overview, `/a/<token>`, satu join dari game).
4. Rollback (sebelum fase D): `newTag` overlay ke sha lama, `kubectl apply -k`; PVC `klsm-affiliate-data` masih utuh.
5. Fase D (1–2 minggu kemudian): patch PV `klsm-affiliate-data` ke Retain, salin `app.db` terakhir ke luar server, baru hapus PVC + `pvc.yaml` + `migrate-job.yaml`.

## Batasan yang harus diingat

- Postgres satu replica di `local-path`: terikat ke node ini. Multi-node k3s butuh Longhorn/NFS atau Postgres di luar cluster.
- Rate limit halaman publik in-memory per pod (2 replica = efektif 2×). Cukup untuk skala ini.
- Upgrade `@duckdb/node-api` = ekstensi `postgres` harus di-install ulang saat build (otomatis lewat Dockerfile). Jangan upgrade DuckDB tanpa build image baru.
