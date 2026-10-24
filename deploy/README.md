# Deploy VCworkspace lên máy ảo Google Cloud (phương án A)

Chốt ngày 2026-10-20: 1 máy ảo Compute Engine ở Singapore chạy Docker Compose, tên miền
`https://vcdocs.vcprosperous.com`.

```
Internet ──443──► caddy (HTTPS tự động)
                    ├─ /api/*  ──► api  (NestJS, 1 bản) ──► mongo
                    │                 └─ kho PDF đã chốt: DATA_DIR/vault
                    └─ còn lại ──► web  (Next.js)
Đĩa dữ liệu riêng /mnt/vcdocs-data: snapshot hằng ngày + backup.sh đẩy lên Cloud Storage
```

| File | Việc |
|------|------|
| `api.Dockerfile`, `web.Dockerfile` | Image cho `apps/api` và `apps/web` (build từ gốc repo) |
| `docker-compose.prod.yml` | 4 dịch vụ: caddy, web, api, mongo |
| `Caddyfile` | HTTPS, chia `/api/*` sang api |
| `.env.example` → `.env` | Tên miền, thư mục dữ liệu, mật khẩu Mongo, bucket sao lưu |
| `api.env.example` → `api.env` | Biến môi trường của api (Google thật, OAuth, cookie Secure) |
| `secrets/vcdocs-sa.json` | Khoá JSON service account `vcdocs-backend` (chỉ có trên máy chủ) |
| `backup.sh` | Sao lưu Mongo + kho PDF lên Cloud Storage |

`.env`, `api.env`, `secrets/` bị git bỏ qua — **không commit**.

Chi phí dự kiến khoảng 35–45 USD/tháng: máy e2-medium, đĩa 20 GB + 50 GB, IP tĩnh, snapshot và
bucket.

---

## Bước 1. Chuẩn bị (chạy trong Cloud Shell của project `vcdocs`)

Mở https://console.cloud.google.com → chọn project `vcdocs` → nút **Cloud Shell** (biểu tượng `>_`).

```bash
gcloud config set project vcdocs
gcloud config set compute/region asia-southeast1
gcloud config set compute/zone asia-southeast1-b
gcloud services enable compute.googleapis.com storage.googleapis.com monitoring.googleapis.com
```

## Bước 2. IP tĩnh và DNS

```bash
gcloud compute addresses create vcdocs-ip --region=asia-southeast1
gcloud compute addresses describe vcdocs-ip --region=asia-southeast1 --format='value(address)'
```

Ở nơi quản lý DNS của `vcprosperous.com`, thêm bản ghi **A**: tên `vcdocs`, giá trị là IP vừa in
ra, TTL 300. Phải làm **trước bước 7**, vì Caddy cần DNS đúng thì mới xin được chứng chỉ HTTPS.
Kiểm tra: `dig +short vcdocs.vcprosperous.com` ra đúng IP.

## Bước 3. Service account cho máy ảo, bucket sao lưu

Máy ảo dùng service account riêng `vcdocs-vm`, chỉ có quyền ghi bucket sao lưu.
`vcdocs-backend` vẫn là tài khoản gọi Google Workspace, khoá JSON của nó đặt ở bước 6.

```bash
gcloud iam service-accounts create vcdocs-vm --display-name="VCworkspace máy ảo"
VM_SA=vcdocs-vm@vcdocs.iam.gserviceaccount.com

# CSDL: giữ 90 ngày rồi tự xoá
gcloud storage buckets create gs://vcdocs-sao-luu-csdl --location=asia-southeast1 \
  --uniform-bucket-level-access --public-access-prevention
cat > /tmp/xoa-90-ngay.json <<'EOF'
{"rule": [{"action": {"type": "Delete"}, "condition": {"age": 90}}]}
EOF
gcloud storage buckets update gs://vcdocs-sao-luu-csdl --lifecycle-file=/tmp/xoa-90-ngay.json

# Kho PDF đã chốt: không cho xoá trong 10 năm kể từ lúc tải lên
gcloud storage buckets create gs://vcdocs-sao-luu-kho-pdf --location=asia-southeast1 \
  --uniform-bucket-level-access --public-access-prevention --retention-period=10y

for B in vcdocs-sao-luu-csdl vcdocs-sao-luu-kho-pdf; do
  gcloud storage buckets add-iam-policy-binding gs://$B \
    --member=serviceAccount:$VM_SA --role=roles/storage.objectUser
done
```

> Thời hạn giữ 10 năm là đề xuất. Chủ dự án chốt thời hạn lưu hồ sơ dài nhất rồi mới **khoá**
> chính sách. Khoá rồi thì không gỡ được:
> `gcloud storage buckets update gs://vcdocs-sao-luu-kho-pdf --lock-retention-period`

## Bước 4. Đĩa dữ liệu, máy ảo, tường lửa, snapshot

```bash
gcloud compute disks create vcdocs-data --size=50GB --type=pd-balanced

gcloud compute instances create vcdocs-prod \
  --machine-type=e2-medium \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=20GB --boot-disk-type=pd-balanced \
  --disk=name=vcdocs-data,device-name=vcdocs-data,mode=rw,auto-delete=no \
  --address=vcdocs-ip \
  --tags=vcdocs-web \
  --service-account=vcdocs-vm@vcdocs.iam.gserviceaccount.com --scopes=cloud-platform \
  --shielded-secure-boot

# Web: 80 (Caddy chuyển sang HTTPS + xin chứng chỉ), 443 TCP/UDP
gcloud compute firewall-rules create vcdocs-allow-web --network=default \
  --allow=tcp:80,tcp:443,udp:443 --target-tags=vcdocs-web
# SSH chỉ qua IAP (không mở cổng 22 ra Internet)
gcloud compute firewall-rules create vcdocs-allow-iap-ssh --network=default \
  --allow=tcp:22 --source-ranges=35.235.240.0/20 --target-tags=vcdocs-web

# Snapshot đĩa dữ liệu mỗi ngày lúc 02:00 giờ VN (19:00 UTC), giữ 14 ngày
gcloud compute resource-policies create snapshot-schedule vcdocs-hang-ngay \
  --region=asia-southeast1 --daily-schedule --start-time=19:00 \
  --max-retention-days=14 --storage-location=asia-southeast1
gcloud compute disks add-resource-policies vcdocs-data --resource-policies=vcdocs-hang-ngay
```

> Nếu project có sẵn rule mở cổng 22 cho mọi IP (`default-allow-ssh`), nên xoá rule đó đi.

## Bước 5. Cài máy ảo

```bash
gcloud compute ssh vcdocs-prod --tunnel-through-iap
```

Các lệnh dưới đây chạy **trên máy ảo**:

```bash
sudo timedatectl set-timezone Asia/Ho_Chi_Minh
sudo apt-get update && sudo apt-get install -y git unattended-upgrades

# Gắn đĩa dữ liệu vào /mnt/vcdocs-data (chỉ format lần đầu!)
DISK=/dev/disk/by-id/google-vcdocs-data
sudo mkfs.ext4 -m 0 -E lazy_itable_init=0,lazy_journal_init=0,discard $DISK
sudo mkdir -p /mnt/vcdocs-data
echo "UUID=$(sudo blkid -s UUID -o value $DISK) /mnt/vcdocs-data ext4 discard,defaults,nofail 0 2" | sudo tee -a /etc/fstab
sudo mount -a && df -h /mnt/vcdocs-data

# Thư mục dữ liệu; api chạy bằng user node (uid 1000) nên phải ghi được vault/ và uploads/
sudo mkdir -p /mnt/vcdocs-data/{mongo,vault,uploads,caddy,backup}
sudo chown 1000:1000 /mnt/vcdocs-data/vault /mnt/vcdocs-data/uploads
sudo chown $USER /mnt/vcdocs-data/backup

# Swap 2 GB để máy 4 GB RAM build được Next.js
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Docker (kho apt chính thức)
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER
```

Thoát SSH rồi vào lại để quyền nhóm `docker` có hiệu lực.

## Bước 6. Lấy mã và đặt cấu hình

Repo private nên dùng **deploy key** (chỉ đọc):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/vcdocs_deploy -N "" -C vcdocs-prod
cat ~/.ssh/vcdocs_deploy.pub
```

Trên GitHub: repo `buithoanh/VCdocs` → Settings → Deploy keys → Add deploy key, dán khoá, **không**
tick "Allow write access".

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/vcdocs_deploy
EOF
sudo mkdir -p /srv/vcdocs && sudo chown $USER /srv/vcdocs
git clone git@github.com:buithoanh/VCdocs.git /srv/vcdocs
cd /srv/vcdocs/deploy
cp .env.example .env
cp api.env.example api.env
sed -i "s/^MONGO_PASSWORD=.*/MONGO_PASSWORD=$(openssl rand -hex 24)/" .env
chmod 600 .env api.env
mkdir -p secrets
```

**Khoá service account:** chép từ máy của chủ dự án lên máy ảo (lệnh chạy ở máy Mac, không phải
trên máy ảo):

```bash
gcloud compute scp --tunnel-through-iap --zone=asia-southeast1-b /đường/dẫn/khoa-vcdocs-backend.json vcdocs-prod:/srv/vcdocs/deploy/secrets/vcdocs-sa.json
```

Trên máy ảo, cho user `node` trong container đọc được khoá:

```bash
sudo chown 1000:1000 /srv/vcdocs/deploy/secrets/vcdocs-sa.json
sudo chmod 400 /srv/vcdocs/deploy/secrets/vcdocs-sa.json
```

**OAuth client:** Google Cloud Console → APIs & Services → Credentials → Create credentials → OAuth
client ID → Web application, tên `VCworkspace web (production)`:
- Authorized JavaScript origins: `https://vcdocs.vcprosperous.com`
- Authorized redirect URIs: `https://vcdocs.vcprosperous.com/api/v1/auth/google/callback`

Sửa `api.env` (`nano api.env`): điền `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` của client mới, và
`GOOGLE_ADMIN_SUBJECT` (email quản trị Workspace, giống `apps/api/.env` ở máy local).
`MAIL_FROM` để `vcdocs@vcprosperous.com` khi đã có hộp thư đó. Trước đó tạm dùng mail chủ dự án,
như ở local.

## Bước 7. Chạy

```bash
cd /srv/vcdocs/deploy
docker compose -f docker-compose.prod.yml up -d --build      # lần đầu build mất ~5–10 phút
docker compose -f docker-compose.prod.yml ps                  # 4 dịch vụ Up, api/mongo (healthy)
docker compose -f docker-compose.prod.yml logs -f api caddy   # Ctrl+C để thoát
```

Log api phải có dòng `API chạy ở https://vcdocs.vcprosperous.com/api/v1 (Google: real)`. Log caddy
phải có dòng `certificate obtained successfully`.

**Khởi tạo công ty** (CSDL mới, chạy một lần; chạy lại cũng không tạo trùng):

```bash
docker compose -f docker-compose.prod.yml run --rm api node dist/khoi-tao.js --ten "Công ty TNHH VC Phồn Vinh"
```

Mở https://vcdocs.vcprosperous.com → đăng nhập bằng tài khoản `@vcprosperous.com`.

## Bước 8. Sao lưu tự động

```bash
/srv/vcdocs/deploy/backup.sh          # chạy thử, rồi xem bucket trên Console
crontab -e
```

Thêm dòng sau (02:30 mỗi đêm, sau snapshot):

```
30 2 * * * /srv/vcdocs/deploy/backup.sh >> /mnt/vcdocs-data/backup/backup.log 2>&1
```

## Bước 9. Theo dõi

Console → Monitoring → Uptime checks → Create:
- HTTPS, host `vcdocs.vcprosperous.com`, path `/dang-nhap`, kiểm tra mỗi 5 phút
- Cảnh báo gửi email cho chủ dự án khi trang không truy cập được

---

## Cập nhật phiên bản mới

```bash
cd /srv/vcdocs && git pull
cd deploy && docker compose -f docker-compose.prod.yml up -d --build
docker image prune -f
```

Lúc đổi container, api/web gián đoạn vài giây. Nên cập nhật ngoài giờ làm việc. Việc nền dở dang
không mất: hàng đợi nằm trong Mongo và tự chạy tiếp.

## Khôi phục (nên diễn tập ít nhất 1 lần)

**CSDL** từ bản dump trên bucket (`--drop` ghi đè dữ liệu hiện có):

```bash
cd /srv/vcdocs/deploy && set -a && source .env && set +a
gcloud storage ls $BACKUP_BUCKET_DB/mongo/ | tail -3
gcloud storage cp $BACKUP_BUCKET_DB/mongo/<tên-file>.archive.gz /tmp/
docker compose -f docker-compose.prod.yml exec -T mongo mongorestore --archive --gzip --drop \
  --username "$MONGO_USER" --password "$MONGO_PASSWORD" --authenticationDatabase admin < /tmp/<tên-file>.archive.gz
```

**Kho PDF:**

```bash
gcloud storage rsync --recursive $BACKUP_BUCKET_VAULT/vault $DATA_DIR/vault && sudo chown -R 1000:1000 $DATA_DIR/vault
```

**Mất cả máy ảo:** tạo đĩa mới từ snapshot gần nhất của `vcdocs-data` (Console → Snapshots → Create
disk). Tạo lại máy ảo theo bước 4 và gắn đĩa đó vào. Làm lại bước 5, trừ lệnh `mkfs`, rồi bước 6–7.

## Lưu ý vận hành

- **Chỉ chạy 1 bản api.** Các việc theo lịch chạy ngay trong tiến trình api và không có khoá chống
  chạy trùng.
- Mongo không mở cổng ra ngoài. Muốn xem dữ liệu thì dùng
  `docker compose -f docker-compose.prod.yml exec mongo mongosh -u vcdocs -p`.
- Thêm quyền Google mới ở BE thì phải thêm cả ở domain-wide delegation (admin.google.com). Xem mục
  5 của sổ tay dự án.
- Đổi khoá service account: chép file mới đè lên `secrets/vcdocs-sa.json`, rồi chạy
  `docker compose -f docker-compose.prod.yml restart api`.

> Tên dự án hiện tại là VCworkspace (từ 2026-10-23). Các định danh `vcdocs`,
> package `@vcdocs/*` và cấu hình hạ tầng trong ví dụ vẫn đang dùng tên kỹ thuật cũ.
> Phiên code AI: xem [quy tắc chung](../AGENTS.md) trước khi khởi động dịch vụ thật.
